#!/usr/bin/env python3
"""
Edge-Linux System Health Check
Runs a suite of checks against all local services.
If any check fails, sends an alert email to the configured recipient.

Schedules (in /etc/cron.d/edge-healthcheck):
  - Every hour  → alert only on failure
  - 08:00 daily → always send a morning status report

Config: /home/iris/Documents/development/edge-linux/scripts/healthcheck.conf
"""

import argparse
import configparser
import json
import os
import smtplib
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CONF_PATH = Path(__file__).parent / "healthcheck.conf"

conf = configparser.ConfigParser()
conf.read(CONF_PATH)

SMTP_HOST = conf.get("smtp", "host", fallback="smtp.gmail.com")
SMTP_PORT = conf.getint("smtp", "port", fallback=587)
SMTP_USER = conf.get("smtp", "user", fallback="")
SMTP_PASS = conf.get("smtp", "pass", fallback="")
ALERT_FROM = conf.get("smtp", "from", fallback=SMTP_USER)
ALERT_TO   = conf.get("smtp", "to",   fallback="")

HOSTNAME = socket.gethostname()
NOW      = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# ---------------------------------------------------------------------------
# Check helpers
# ---------------------------------------------------------------------------
class Check:
    def __init__(self, name: str, ok: bool, detail: str = ""):
        self.name   = name
        self.ok     = ok
        self.detail = detail

    def __str__(self):
        status = "✅ OK" if self.ok else "❌ FAIL"
        return f"  {status}  {self.name}" + (f"\n         {self.detail}" if self.detail else "")


def check_port(name: str, host: str, port: int, timeout: float = 3.0) -> Check:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return Check(name, True)
    except Exception as e:
        return Check(name, False, str(e))


def check_http(name: str, url: str, timeout: float = 5.0, expect_status: int = 200) -> Check:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "healthcheck/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status == expect_status:
                return Check(name, True)
            return Check(name, False, f"HTTP {r.status}")
    except urllib.error.HTTPError as e:
        return Check(name, False, f"HTTP {e.code}")
    except Exception as e:
        return Check(name, False, str(e))


def check_systemd(service: str) -> Check:
    result = subprocess.run(
        ["systemctl", "is-active", service],
        capture_output=True, text=True
    )
    active = result.stdout.strip() == "active"
    return Check(f"systemd:{service}", active,
                 "" if active else f"state={result.stdout.strip()}")


def check_process(name: str, pattern: str) -> Check:
    result = subprocess.run(
        ["pgrep", "-f", pattern],
        capture_output=True, text=True
    )
    found = result.returncode == 0
    return Check(name, found, "" if found else "process not found")


def check_go2rtc_streams() -> list[Check]:
    checks = []
    try:
        req = urllib.request.Request("http://localhost:1984/api/streams",
                                     headers={"User-Agent": "healthcheck/1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        if not data:
            checks.append(Check("go2rtc:streams", False, "No streams configured"))
        else:
            for cam, info in data.items():
                has_producer = bool(info.get("producers"))
                checks.append(Check(f"go2rtc:stream:{cam}", has_producer,
                                    "" if has_producer else "no producer configured"))
    except Exception as e:
        checks.append(Check("go2rtc:streams", False, str(e)))
    return checks


def check_cmp_api() -> Check:
    """Check CMP is serving its API (unauthenticated health probe)."""
    try:
        req = urllib.request.Request("http://localhost:3002/api/auth/signin",
                                     headers={"User-Agent": "healthcheck/1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            # 405 Method Not Allowed means the route exists (GET on a POST endpoint)
            return Check("CMP:api", True)
    except urllib.error.HTTPError as e:
        if e.code in (400, 405):
            return Check("CMP:api", True)
        return Check("CMP:api", False, f"HTTP {e.code}")
    except Exception as e:
        return Check("CMP:api", False, str(e))


def check_edge_cloud_api() -> Check:
    return check_http("edge-cloud:api", "http://localhost:3001/health", expect_status=200)


# ---------------------------------------------------------------------------
# Self-healing
# ---------------------------------------------------------------------------
BASE = Path("/home/iris/Documents/development/edge-linux")

# Maps a failing check name to a heal action.
# Each action is a callable that attempts a restart and returns a description.
def _start_bg(cmd: list[str], cwd: str, env_extra: dict | None = None) -> str:
    """Launch a process in the background (detached), return a status string."""
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    subprocess.Popen(
        cmd, cwd=cwd, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return f"started: {' '.join(cmd)}"


def _systemctl_restart(service: str) -> str:
    r = subprocess.run(["sudo", "systemctl", "restart", service],
                       capture_output=True, text=True)
    if r.returncode == 0:
        return f"systemctl restart {service} → OK"
    return f"systemctl restart {service} → FAILED ({r.stderr.strip()})"


HEAL_ACTIONS: dict[str, callable] = {
    # Systemd services (tries sudo; may not need a password if configured)
    "systemd:edge-cloud-local": lambda: _systemctl_restart("edge-cloud-local"),
    "systemd:edge-ui-local":    lambda: _systemctl_restart("edge-ui-local"),

    # Manually-started processes — start them directly as the current user
    "process:go2rtc": lambda: _start_bg(
        ["/usr/local/bin/go2rtc", "-config", str(BASE / "go2rtc.yaml")],
        cwd=str(BASE),
    ),
    "process:CMP": lambda: _start_bg(
        ["/usr/bin/node", "/home/iris/.nvm/versions/node/v22.14.0/bin/next",
         "start", "-p", "3002"],
        cwd=str(BASE / "CCTVCMP-linux"),
        env_extra={"NODE_ENV": "production"},
    ),
}

# Port / API / stream checks heal by fixing the underlying process —
# map them to the canonical process check name so we don't double-heal.
CHECK_ALIAS: dict[str, str] = {
    "port:3000 (PPE-UI)":    "systemd:edge-ui-local",
    "port:3001 (edge-cloud)":"systemd:edge-cloud-local",
    "port:3002 (CMP)":       "process:CMP",
    "port:1984 (go2rtc)":    "process:go2rtc",
    "CMP:api":               "process:CMP",
}


class HealResult:
    def __init__(self, check_name: str, action_taken: str, recovered: bool):
        self.check_name   = check_name
        self.action_taken = action_taken
        self.recovered    = recovered

    def __str__(self):
        icon = "✅" if self.recovered else "⚠️"
        return f"  {icon}  {self.check_name}  →  {self.action_taken}"


def heal_failures(failures: list[Check]) -> tuple[list[HealResult], list[Check]]:
    """
    Attempt to fix each failed check.
    Returns (heal_results, re_checked_failures).
    """
    healed_targets: set[str] = set()
    heal_results:   list[HealResult] = []

    for f in failures:
        target = CHECK_ALIAS.get(f.name, f.name)
        if target in healed_targets:
            continue  # already attempted for this underlying service
        healed_targets.add(target)

        action_fn = HEAL_ACTIONS.get(target)
        if not action_fn:
            heal_results.append(HealResult(f.name, "no auto-heal available", False))
            continue

        print(f"[healthcheck] Attempting heal: {target}")
        try:
            desc = action_fn()
        except Exception as e:
            desc = f"error: {e}"
        heal_results.append(HealResult(f.name, desc, False))  # recovered updated below

    # Wait for services to come up, then re-verify
    if healed_targets & set(HEAL_ACTIONS.keys()):
        print("[healthcheck] Waiting 15 s for services to start…")
        time.sleep(15)

    # Re-run only the originally failing checks
    re_failures: list[Check] = []
    for f in failures:
        # Re-run the same type of check by name pattern
        if f.name.startswith("systemd:"):
            svc = f.name.split("systemd:")[1]
            new_check = check_systemd(svc)
        elif f.name.startswith("port:"):
            import re as _re
            m = _re.search(r":(\d+)", f.name)
            host_val = "localhost"
            port_val = int(m.group(1)) if m else 0
            new_check = check_port(f.name, host_val, port_val)
        elif f.name.startswith("process:"):
            patterns = {
                "process:go2rtc":    "go2rtc",
                "process:CMP":       "next start -p 3002",
            }
            new_check = check_process(f.name, patterns.get(f.name, f.name))
        elif f.name == "CMP:api":
            new_check = check_cmp_api()
        elif f.name.startswith("go2rtc:stream:"):
            cam = f.name.split("go2rtc:stream:")[1]
            stream_checks = check_go2rtc_streams()
            new_check = next((c for c in stream_checks if c.name == f.name),
                             Check(f.name, False, "stream still missing"))
        else:
            new_check = Check(f.name, False, "re-check not implemented")

        # Update the heal result with recovery status
        for hr in heal_results:
            if hr.check_name == f.name:
                hr.recovered = new_check.ok
                break

        if not new_check.ok:
            re_failures.append(new_check)

    return heal_results, re_failures


# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------
def run_checks() -> list[Check]:
    results: list[Check] = []

    # Systemd services
    results.append(check_systemd("edge-cloud-local"))
    results.append(check_systemd("edge-ui-local"))

    # Ports
    results.append(check_port("port:3000 (PPE-UI)",    "localhost", 3000))
    results.append(check_port("port:3001 (edge-cloud)", "localhost", 3001))
    results.append(check_port("port:3002 (CMP)",        "localhost", 3002))
    results.append(check_port("port:1984 (go2rtc)",     "localhost", 1984))

    # Process checks (covers manually started services)
    results.append(check_process("process:go2rtc",    "go2rtc"))
    results.append(check_process("process:CMP",       "next start -p 3002"))

    # Application-level checks
    results.append(check_cmp_api())
    results += check_go2rtc_streams()

    return results


# ---------------------------------------------------------------------------
# Email via Gmail SMTP
# ---------------------------------------------------------------------------
def _send_email(subject: str, body_text: str, body_html: str) -> None:
    if not SMTP_USER or not SMTP_PASS or SMTP_PASS.startswith("YOUR_"):
        print("[healthcheck] Gmail not configured — skipping email")
        print("[healthcheck] Edit scripts/healthcheck.conf with your Gmail App Password")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = ALERT_FROM
    msg["To"]      = ALERT_TO
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.ehlo()
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(ALERT_FROM, [ALERT_TO], msg.as_string())
        print(f"[healthcheck] Email sent to {ALERT_TO}")
    except Exception as e:
        print(f"[healthcheck] Failed to send email: {e}", file=sys.stderr)


def _build_email(
    initial_failures: list[Check],
    all_checks: list[Check],
    tag: str,
    heal_results: list[HealResult] | None = None,
    remaining_failures: list[Check] | None = None,
) -> tuple[str, str, str]:
    """Return (subject, body_text, body_html)."""
    healed     = heal_results or []
    still_bad  = remaining_failures if remaining_failures is not None else initial_failures
    all_ok     = len(still_bad) == 0
    auto_fixed = [h for h in healed if h.recovered]
    still_fail = [h for h in healed if not h.recovered]

    if all_ok and not initial_failures:
        subject       = f"[{tag}] Edge-Linux — All Systems OK — {NOW}"
        heading_color = "#27ae60"
        heading_text  = "&#10003; Edge-Linux — All Systems OK"
    elif all_ok and initial_failures:
        subject       = f"[{tag}] Edge-Linux — Issue(s) Auto-Fixed on {HOSTNAME} — {NOW}"
        heading_color = "#e67e22"
        heading_text  = "&#9889; Edge-Linux — Auto-Healed"
    else:
        subject       = f"[{tag}] Edge-Linux — {len(still_bad)} failure(s) on {HOSTNAME} — {NOW}"
        heading_color = "#c0392b"
        heading_text  = "&#9888; Edge-Linux Health Alert"

    ok_lines = "\n".join(str(c) for c in all_checks if c.ok)

    # --- plain text ---
    heal_text = ""
    if healed:
        heal_text = "\nAUTO-HEAL ACTIONS:\n"
        heal_text += "\n".join(str(h) for h in healed)
        heal_text += "\n"

    body_text = f"""Edge-Linux Health Check
Host:  {HOSTNAME}
Time:  {NOW}
{heal_text}
{"All " + str(len(all_checks)) + " checks PASSED (after auto-heal)." if all_ok and initial_failures else ("All " + str(len(all_checks)) + " checks PASSED." if all_ok else "")}
{"STILL FAILING (" + str(len(still_bad)) + "):" if still_bad else ""}
{"".join(chr(10) + str(c) for c in still_bad)}

PASSING CHECKS ({len(all_checks) - len(initial_failures)}):
{ok_lines}

---
Sent automatically by the Edge-Linux healthcheck.
"""

    # --- HTML helpers ---
    heal_html = ""
    if healed:
        heal_html = f"""
<h3 style="color:#e67e22;margin-top:20px">&#9889; Auto-Heal Actions</h3>
<ul style="margin:0;padding:0 0 0 20px">
{"".join(f'<li style="margin:4px 0">{"<b style=color:#27ae60>&#10003;</b>" if h.recovered else "<b style=color:#c0392b>&#10060;</b>"} <b>{h.check_name}</b> &mdash; <span style="color:#888">{h.action_taken}</span></li>' for h in healed)}
</ul>"""

    fail_html = ""
    if still_bad:
        fail_html = f"""
<h3 style="color:#c0392b">&#10060; Still Failing</h3>
<ul style="margin:0;padding:0 0 0 20px">
{"".join(f'<li style="margin:4px 0"><b>{c.name}</b>' + (f' &mdash; <span style="color:#888">{c.detail}</span>' if c.detail else '') + '</li>' for c in still_bad)}
</ul>"""

    body_html = f"""<html><body style="font-family:sans-serif;color:#222;max-width:600px">
<h2 style="color:{heading_color}">{heading_text}</h2>
<table style="border-collapse:collapse;margin-bottom:16px">
  <tr><td style="color:#888;padding:2px 12px 2px 0">Host</td><td><b>{HOSTNAME}</b></td></tr>
  <tr><td style="color:#888;padding:2px 12px 2px 0">Time</td><td>{NOW}</td></tr>
  <tr><td style="color:#888;padding:2px 12px 2px 0">Status</td>
      <td><b style="color:{heading_color}">{"All " + str(len(all_checks)) + " checks passed" if all_ok else str(len(still_bad)) + " still failing after auto-heal"}</b></td></tr>
  {"<tr><td style='color:#888;padding:2px 12px 2px 0'>Auto-fixed</td><td><b style='color:#27ae60'>" + str(len(auto_fixed)) + " service(s)</b></td></tr>" if auto_fixed else ""}
</table>
{heal_html}
{fail_html}
<h3 style="color:#27ae60;margin-top:20px">&#10003; Passing Checks</h3>
<ul style="margin:0;padding:0 0 0 20px;color:#555">
{"".join(f'<li style="margin:2px 0">{c.name}</li>' for c in all_checks if c.ok)}
</ul>
<p style="color:#aaa;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:8px">
Sent automatically by the hourly healthcheck on {HOSTNAME}
</p>
</body></html>"""

    return subject, body_text, body_html


def send_alert(
    initial_failures: list[Check],
    all_checks: list[Check],
    heal_results: list[HealResult] | None = None,
    remaining_failures: list[Check] | None = None,
) -> None:
    subject, body_text, body_html = _build_email(
        initial_failures, all_checks, "ALERT", heal_results, remaining_failures)
    _send_email(subject, body_text, body_html)


def send_daily_report(checks: list[Check]) -> None:
    failures = [c for c in checks if not c.ok]
    subject, body_text, body_html = _build_email(failures, checks, "Daily Report")
    _send_email(subject, body_text, body_html)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Edge-Linux health check")
    parser.add_argument("--daily-report", action="store_true",
                        help="Always send an email regardless of pass/fail (used by 08:00 cron)")
    args = parser.parse_args()

    checks   = run_checks()
    failures = [c for c in checks if not c.ok]

    print(f"[healthcheck] {NOW}  host={HOSTNAME}")
    for c in checks:
        print(str(c))

    if args.daily_report:
        # For the daily report, still attempt healing but always email
        if failures:
            print(f"\n[healthcheck] Daily report — {len(failures)} failure(s), attempting auto-heal…")
            heal_results, remaining = heal_failures(failures)
            for hr in heal_results:
                print(str(hr))
            send_daily_report(checks)  # send full picture
        else:
            print(f"\n[healthcheck] Daily report — All {len(checks)} checks passed.")
            send_daily_report(checks)
        sys.exit(1 if failures else 0)

    elif failures:
        print(f"\n[healthcheck] {len(failures)} failure(s) — attempting auto-heal…")
        heal_results, remaining = heal_failures(failures)
        for hr in heal_results:
            print(str(hr))

        if remaining:
            print(f"[healthcheck] {len(remaining)} still failing — sending alert email")
        else:
            print("[healthcheck] All issues auto-healed — sending notification email")

        send_alert(failures, checks, heal_results, remaining)
        sys.exit(1 if remaining else 0)

    else:
        print(f"\n[healthcheck] All {len(checks)} checks passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
