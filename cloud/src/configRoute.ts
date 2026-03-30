/**
 * Config & Services Status API
 *
 * Replaces the Python backend's /api/config (GET/PUT) and
 * /api/services/status endpoints so the PPE-UI settings panel works
 * against the Node.js cloud service directly.
 *
 * Config file layout:
 *   <repo>/app.config.json          — authoritative source of truth
 *   <repo>/python/app.config.json   — mirror (best-effort)
 *   <repo>/ppe-ui/public/app.config.json — mirror (best-effort)
 *   <repo>/ppe-ui/build/app.config.json  — mirror (best-effort)
 */

import { Router, type Request, type Response } from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GO2RTC_PORT, isGo2RTCAvailable } from './go2rtcManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Paths ────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..', '..');

function rootConfigPath(): string {
  return resolve(REPO_ROOT, 'app.config.json');
}

function mirrorPaths(): string[] {
  return [
    resolve(REPO_ROOT, 'python', 'app.config.json'),
    resolve(REPO_ROOT, 'ppe-ui', 'public', 'app.config.json'),
    resolve(REPO_ROOT, 'ppe-ui', 'build', 'app.config.json'),
  ];
}

// ── Load / Save ──────────────────────────────────────────────────────

export function loadConfig(): Record<string, unknown> {
  const p = rootConfigPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn('[config] Failed to read app.config.json:', (err as Error).message);
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  const json = JSON.stringify(config, null, 2);

  const root = rootConfigPath();
  mkdirSync(dirname(root), { recursive: true });
  writeFileSync(root, json, 'utf-8');

  for (const mirror of mirrorPaths()) {
    try {
      mkdirSync(dirname(mirror), { recursive: true });
      writeFileSync(mirror, json, 'utf-8');
    } catch (err) {
      console.warn(`[config] Mirror sync failed for ${mirror}:`, (err as Error).message);
    }
  }
  console.log('[config] app.config.json updated');
}

// ── Merge Helpers ────────────────────────────────────────────────────

function mergeSection(existing: unknown, incoming: unknown): unknown {
  if (
    existing && typeof existing === 'object' && !Array.isArray(existing) &&
    incoming && typeof incoming === 'object' && !Array.isArray(incoming)
  ) {
    return { ...existing as object, ...incoming as object };
  }
  return incoming;
}

function mergeRtspCameras(existing: unknown, incoming: unknown): unknown[] {
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(existing)) {
    for (const c of existing) {
      if (c && typeof c === 'object' && typeof (c as Record<string, unknown>).id === 'string') {
        byId.set((c as Record<string, unknown>).id as string, c as Record<string, unknown>);
      }
    }
  }
  const merged: Record<string, unknown>[] = [];
  if (!Array.isArray(incoming)) return merged;
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const cam = item as Record<string, unknown>;
    const id = cam.id as string;
    if (id && byId.has(id)) {
      merged.push({ ...byId.get(id)!, ...cam });
    } else {
      merged.push(cam);
    }
  }
  return merged;
}

function sanitiseForFrontend(config: Record<string, unknown>): Record<string, unknown> {
  const safe = JSON.parse(JSON.stringify(config));
  const cs = safe.centralServer;
  if (cs && typeof cs === 'object') {
    delete cs.apiKey;
    delete cs.vercelBypassToken;
  }
  return safe;
}

// ── Systemctl helpers ────────────────────────────────────────────────

function applyVpn(enabled: boolean): void {
  try {
    const action = enabled ? 'start' : 'stop';
    execFileSync('sudo', ['-n', 'systemctl', action, 'wg-mullvad'], { timeout: 30_000 });
  } catch { /* non-fatal */ }
}

function applyTailscale(enabled: boolean): void {
  try {
    if (enabled) {
      execFileSync('sudo', ['-n', 'systemctl', 'start', 'tailscaled'], { timeout: 15_000 });
      execFileSync('sudo', ['-n', 'tailscale', 'up', '--accept-dns=false', '--netfilter-mode=off', '--shields-up=false', '--ssh=true'], { timeout: 30_000 });
    } else {
      execFileSync('sudo', ['-n', 'tailscale', 'down'], { timeout: 15_000 });
      execFileSync('sudo', ['-n', 'systemctl', 'stop', 'tailscaled'], { timeout: 15_000 });
    }
  } catch { /* non-fatal */ }
}

const SERVICE_UNITS: Array<[string[], string]> = [
  [['edge-cloud-local', 'edge-cloud'], 'Cloud Vision API'],
  [['edge-ui-local', 'edge-ui'], 'PPE UI'],
  [['wg-mullvad'], 'VPN (Mullvad)'],
  [['tailscaled'], 'Tailscale'],
];

function getServiceStatus(units: string[]): string {
  const states: string[] = [];
  for (const unit of units) {
    try {
      const out = execFileSync('systemctl', ['is-active', unit], { timeout: 5_000, encoding: 'utf-8' }).trim();
      states.push(out || 'inactive');
    } catch {
      states.push('unknown');
    }
  }
  for (const preferred of ['active', 'failed', 'activating', 'reloading', 'inactive']) {
    if (states.includes(preferred)) return preferred;
  }
  return states[0] || 'unknown';
}

// ── Routes ───────────────────────────────────────────────────────────

const router = Router();

router.get('/config', (_req: Request, res: Response) => {
  try {
    const config = loadConfig();
    const sanitised = sanitiseForFrontend(config);
    // Inject go2rtc info so the PPE-UI knows how to connect for WebRTC
    (sanitised as Record<string, unknown>)._go2rtc = {
      available: isGo2RTCAvailable(),
      port: GO2RTC_PORT,
      apiBase: `http://${_req.hostname}:${GO2RTC_PORT}`,
    };
    res.json(sanitised);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.options('/config', (_req: Request, res: Response) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '3600',
  }).json({});
});

router.put('/config', (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const config = loadConfig();

    const rtsp = body.rtsp as Record<string, unknown> | undefined;
    if (rtsp) {
      if (!rtsp.cameras) {
        res.status(400).json({ error: 'rtsp.cameras is required when rtsp is provided' });
        return;
      }
      if (!config.rtsp || typeof config.rtsp !== 'object') config.rtsp = {};
      const r = config.rtsp as Record<string, unknown>;
      r.cameras = mergeRtspCameras(r.cameras, rtsp.cameras);
      if ('fpsLimit' in rtsp) r.fpsLimit = rtsp.fpsLimit;
      if ('geminiInterval' in rtsp) r.geminiInterval = rtsp.geminiInterval;
      if ('autoStart' in rtsp) r.autoStart = rtsp.autoStart;
    }

    if ('centralServer' in body) config.centralServer = mergeSection(config.centralServer, body.centralServer);
    if ('vpn' in body) {
      config.vpn = mergeSection(config.vpn, body.vpn || {});
      if (config.vpn && typeof config.vpn === 'object') {
        (config.vpn as Record<string, unknown>).enabled = !!(config.vpn as Record<string, unknown>).enabled;
      }
    }
    if ('tailscale' in body) config.tailscale = mergeSection(config.tailscale, body.tailscale);
    if ('network' in body) config.network = mergeSection(config.network, body.network);
    if ('ui' in body) {
      if (!config.ui || typeof config.ui !== 'object') config.ui = {};
      if (body.ui && typeof body.ui === 'object') {
        Object.assign(config.ui as object, body.ui as object);
      } else {
        config.ui = body.ui;
      }
    }

    if (!rtsp && !('centralServer' in body) && !('vpn' in body) && !('tailscale' in body) && !('network' in body) && !('ui' in body)) {
      res.status(400).json({ error: 'Request must include at least one of: rtsp, centralServer, vpn, tailscale, network, ui' });
      return;
    }

    saveConfig(config);

    if ('vpn' in body) applyVpn(!!((config.vpn as Record<string, unknown>)?.enabled));
    if ('tailscale' in body) {
      applyTailscale(
        !!((config.tailscale as Record<string, unknown>)?.enabled),
      );
    }

    res.json({ success: true, message: 'Config saved to app.config.json' });
  } catch (err) {
    console.error('[config] PUT failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/services/status', (_req: Request, res: Response) => {
  const result: Record<string, { label: string; status: string }> = {};
  for (const [units, label] of SERVICE_UNITS) {
    result[units[0]] = { label, status: getServiceStatus(units) };
  }
  res.json(result);
});

export default router;
