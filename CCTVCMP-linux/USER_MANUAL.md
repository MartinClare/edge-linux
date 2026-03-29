# AXON Vision CMP — User Manual

**Application:** AXON Vision Central Monitoring Platform  
**Version:** 1.0.0  
**Audience:** All platform users — Admins, Project Managers, Safety Officers, Viewers

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Access](#2-getting-access)
3. [Signing In & Out](#3-signing-in--out)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Navigation](#5-navigation)
6. [Dashboard](#6-dashboard)
7. [Live Monitoring](#7-live-monitoring)
8. [Incidents](#8-incidents)
9. [Analytics](#9-analytics)
10. [Reports](#10-reports)
11. [Settings](#11-settings)
12. [Incident Types & Risk Levels Reference](#12-incident-types--risk-levels-reference)
13. [Incident Workflow Reference](#13-incident-workflow-reference)
14. [Frequently Asked Questions](#14-frequently-asked-questions)  
15. [Connecting edge devices (PPE-UI)](#15-connecting-edge-devices-ppe-ui)

---

## 1. Overview

AXON Vision CMP is a web-based centralized monitoring platform for construction site AI safety. It aggregates incident data from AI-powered cameras deployed across job sites, enables safety teams to track and respond to hazards in real time, and provides analytics to support compliance reporting.

**Core capabilities:**

- Real-time incident tracking with role-based assignment
- Live camera feed overview across all zones
- KPI dashboard with response time and PPE compliance metrics
- Analytics charts for trend analysis and risk distribution
- Full audit trail on every incident action

---

## 2. Getting Access

Access is provisioned by your system administrator.

1. Contact your admin and provide your full name and work email address
2. Your admin creates your account via the platform and assigns your role
3. You will receive your temporary password from your admin
4. Sign in at the platform URL and change your password immediately

> Only **Admins** can create new user accounts via the API (`POST /api/users`) while signed in.  
> Self-registration is **disabled**; `/signup` redirects to sign-in.

---

## 3. Signing In & Out

### Signing In

1. Open the platform URL in your browser
2. You are redirected to the **Sign In** page at `/signin`
3. Enter your **Email** and **Password**
4. Click **Sign in**
5. On success you are taken directly to the **Dashboard**

### Signing Out

1. Click the **Sign out** button in the top-right corner of any page
2. Your session is cleared and you are returned to the Sign In page

> Sessions last **7 days**. You will be signed out automatically after that period.

---

## 4. User Roles & Permissions

The platform has four roles. Each role determines which pages and actions you can access.

| Role | Description |
|---|---|
| `admin` | Full access. Manages users, projects, and all system configuration |
| `project_manager` | Manages projects and cameras. Can view all data and settings |
| `safety_officer` | Responds to and resolves incidents. Access to reports |
| `viewer` | Read-only access to dashboard, live feed, incidents, and analytics |

### Page Access by Role

| Page | admin | project_manager | safety_officer | viewer |
|---|:---:|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Live Monitoring | ✅ | ✅ | ✅ | ✅ |
| Incidents | ✅ | ✅ | ✅ | ✅ |
| Analytics | ✅ | ✅ | ✅ | ✅ |
| Reports | ✅ | ✅ | ✅ | ❌ |
| Settings | ✅ | ✅ | ❌ | ❌ |

> If you navigate to a page you do not have access to, you are redirected to the Dashboard automatically.

---

## 5. Navigation

### Sidebar (left panel)

The sidebar is visible on all pages after signing in. It contains links to every section:

| Menu Item | Route | Purpose |
|---|---|---|
| Dashboard | `/dashboard` | KPI overview |
| Live Monitoring | `/live` | Camera feed grid |
| Incidents | `/incidents` | Incident table and actions |
| Analytics | `/analytics` | Charts and trend data |
| Reports | `/reports` | Export and compliance |
| Settings | `/settings` | System configuration |

### Top Navbar (right panel)

The top bar displays:
- **Platform name** — AXON Vision
- **Your name and email** — shown top right
- **Your role** — displayed next to your email
- **Sign out button** — ends your session

---

## 6. Dashboard

**Route:** `/dashboard`  
**Access:** All roles

The dashboard is the first page you see after signing in. It shows a high-level summary of site safety performance across all projects.

### KPI Cards

Four metric cards are displayed at the top:

| Card | What it shows |
|---|---|
| **Total Incidents** | Total number of incidents recorded across all projects |
| **High Risk Incidents** | Count of incidents with risk level `high` or `critical` |
| **Avg Response Time** | Average time (in minutes) to acknowledge incidents, based on the last 14 days of metrics |
| **PPE Compliance** | Average PPE compliance rate (%) based on the last 14 days of metrics |

> Data refreshes on every page load. The dashboard pulls live data from the database.

---

## 7. Live Monitoring

**Route:** `/live`  
**Access:** All roles

The Live Monitoring page shows a grid of all cameras registered in the system.

### Camera Cards

Each card displays:
- **Camera name** — e.g. "Gate North Cam"
- **Live feed area** — mock video feed placeholder (replaced with real RTSP/HLS stream in production)
- **Project name and zone** — where the camera is located
- **Status** — `online`, `offline`, or `maintenance`

### Camera Statuses

| Status | Meaning |
|---|---|
| `online` | Camera is active and streaming |
| `offline` | Camera is not reachable |
| `maintenance` | Camera is temporarily taken down for servicing |

### Layout

Cameras are arranged in a responsive grid:
- 1 column on mobile
- 2 columns on tablet
- 3 columns on desktop

---

## 8. Incidents

**Route:** `/incidents`  
**Access:** All roles (actions limited by role)

The Incidents page is the core operational view of the platform. It lists all recorded safety incidents in reverse chronological order.

### Incident Table Columns

| Column | Description |
|---|---|
| **ID** | Unique system-generated incident identifier |
| **Type** | Category of the incident (see reference below) |
| **Risk** | Risk severity badge — `low`, `medium`, `high`, `critical` |
| **Status** | Current lifecycle status — `open`, `acknowledged`, `resolved` |
| **Project** | Project the incident belongs to |
| **Zone** | Zone within the project where it was detected |
| **Camera** | Camera that detected the incident |
| **Assigned To** | User responsible for handling this incident |
| **Detected** | Date and time the incident was first detected |
| **Action** | Button to advance the incident to the next status |

### Risk Level Badges

| Badge colour | Risk level |
|---|---|
| Red (destructive) | `critical` |
| Blue (default) | `high` |
| Grey (secondary) | `medium` / `low` |

### Taking Action on an Incident

Each incident row has an **Action button** on the right:

| Current status | Button label | Next status |
|---|---|---|
| `open` | Mark as acknowledged | `acknowledged` |
| `acknowledged` | Mark as resolved | `resolved` |
| `resolved` | No actions | — |

**To advance an incident:**
1. Find the incident row in the table
2. Click the action button (e.g. **Mark as acknowledged**)
3. The page reloads and the status updates immediately
4. The action is recorded in the incident's audit log

> Every status change is timestamped and attributed to the user who performed it.

---

## 9. Analytics

**Route:** `/analytics`  
**Access:** All roles

The Analytics page contains three charts built from the last 30 days of daily metrics data.

### Chart 1 — Daily Incident Trend (Line Chart)

- **X-axis:** Date
- **Y-axis:** Count / minutes
- **Cyan line:** Total incidents per day
- **Purple line:** Average response time (minutes) per day

Use this chart to spot patterns — spikes in incidents on specific days or weeks, and whether response times are improving or degrading over time.

### Chart 2 — Risk Distribution (Pie Chart)

- **Red segment:** High and critical incidents
- **Green segment:** Low and medium incidents

Shows the overall risk profile of your incidents. A large red segment indicates a site with elevated danger levels.

### Chart 3 — PPE Compliance (Bar Chart)

- Shows the current average PPE compliance rate as a single bar out of 100%
- A value below 80% typically indicates a compliance concern requiring intervention

---

## 10. Reports

**Route:** `/reports`  
**Access:** admin, project_manager, safety_officer

The Reports page is the compliance and export hub. Use it to generate weekly and monthly reports covering:

- Incident counts and timelines
- Response time performance
- PPE compliance rates by project

> This section is currently a placeholder. Export functionality (PDF/CSV) is planned for a future release.

---

## 11. Settings

**Route:** `/settings`  
**Access:** admin, project_manager only

The Settings page has three areas:

| Tab | Purpose |
|---|---|
| **Alarm Rules** | Thresholds and behaviour for incident-type alarms |
| **Notification Channels** | Where alerts are delivered (email, webhook, etc.) |
| **Edge connection (PPE-UI)** | Instructions and the exact **CMP webhook URL** for this deployment, so field staff can configure on-site **PPE-UI** (AXON Vision edge) to post analysis here |

For full edge setup steps (PPE-UI + `app.config.json` + troubleshooting), see **§15** below.

---

## 12. Incident Types & Risk Levels Reference

### Incident Types

| Type | Category | Description |
|---|---|---|
| `ppe_violation` | Safety | Worker detected without required personal protective equipment (helmet, vest, etc.) |
| `fall_risk` | Safety | Worker detected in a position or area with elevated fall hazard |
| `restricted_zone_entry` | Safety | Unauthorised entry into a restricted or exclusion zone |
| `machinery_hazard` | Safety | Worker detected too close to operating heavy machinery |
| `near_miss` | Safety | A close call event that did not result in injury but required logging |
| `smoking` | Fire & Smoke | Person detected smoking on site — immediate fire risk and site policy violation |
| `fire_detected` | Fire & Smoke | Active fire detected by camera AI — highest priority, evacuate and contact emergency services |
| `smoke_detected` | Fire & Smoke | Smoke detected without visible flame — may indicate an early-stage or concealed fire |

> **Fire & Smoke incidents** (`smoking`, `fire_detected`, `smoke_detected`) should always be assigned a risk level of `high` or `critical` and acknowledged immediately.

### Risk Levels

| Level | Meaning | Typical response time |
|---|---|---|
| `low` | Minor risk, no immediate danger | Within 24 hours |
| `medium` | Moderate risk, attention required | Within 4 hours |
| `high` | Significant risk, prompt action needed | Within 1 hour |
| `critical` | Immediate danger to life or safety | Immediately |

---

## 13. Incident Workflow Reference

Every incident follows a strict one-directional workflow:

```
open  →  acknowledged  →  resolved
```

| Status | Meaning |
|---|---|
| `open` | Incident has been detected and logged. No one has responded yet |
| `acknowledged` | A team member has seen the incident and is taking action |
| `resolved` | The hazard has been addressed and the incident is closed |

### Timestamps recorded automatically

| Event | Timestamp field |
|---|---|
| Incident detected | `detected_at` |
| Status changed to acknowledged | `acknowledged_at` |
| Status changed to resolved | `resolved_at` |

### Audit Log

Every action on an incident — creation, assignment, status change — is recorded in the incident log with:
- The **user** who performed the action
- The **action type** (`created`, `assigned`, `acknowledged`, `resolved`, `updated`)
- The **exact timestamp**

This log is stored in the `incident_logs` table and is available via the API at `GET /api/incidents/[id]`.

---

## 14. Frequently Asked Questions

**Q: I can see the dashboard but the Settings link is missing from my sidebar.**  
A: The Settings page is only accessible to `admin` and `project_manager` roles. If you need access, ask your administrator to update your role.

**Q: I clicked "Mark as acknowledged" but nothing happened.**  
A: Make sure you are signed in and your session has not expired. If the problem persists, refresh the page and try again.

**Q: I cannot access Reports.**  
A: Accounts with the `viewer` role cannot open Reports. Ask your admin to assign `safety_officer`, `project_manager`, or `admin`. (Self-registration is disabled; accounts are created by an administrator.)

**Q: Can I skip the "acknowledged" step and resolve an incident directly?**  
A: No. The workflow enforces `open → acknowledged → resolved` in order. This ensures accountability and accurate response time tracking.

**Q: The camera grid shows "LIVE FEED (MOCK)". Is this normal?**  
A: Yes. The current version displays placeholder cards. Real-time RTSP/HLS video integration is planned for a future release.

**Q: How is "Average Response Time" calculated?**  
A: It is pulled from the `daily_metrics` table which stores a pre-aggregated `avg_response_time` value (in minutes) per project per day. In a production deployment this would be computed from the difference between `detected_at` and `acknowledged_at` on each incident.

**Q: My session expired. Do I lose any data?**  
A: No. Sessions are authentication tokens only. All incident data and records are stored in the database and are unaffected by session expiry.

**Q: How do I add a new project or camera?**  
A: **Projects** can be created via the API (`POST /api/projects`) with admin or project_manager role. **Cameras / edge devices** are usually **created automatically** when the edge first successfully POSTs to `/api/webhook/edge-report` with a new `edgeCameraId`. You can also pre-register via `POST /api/edge-devices` if your workflow requires it. See §15 for PPE-UI connection steps.

**Q: Edge Devices is empty — what should I check on site?**  
A: Confirm PPE-UI (or `app.config.json`) has CMP enabled, the webhook URL matches this CMP, and `apiKey` matches `EDGE_API_KEY`. Ensure the edge is sending (Deep Vision + RTSP + analysis). On Vercel, disable deployment protection for the webhook URL if POSTs return HTML instead of JSON.

---

## 15. Connecting edge devices (PPE-UI)

Edge sites run the **AXON Vision edge-linux** stack: a **Python/FastAPI** service (RTSP, Deep Vision, CMP forwarding) and **PPE-UI** (browser UI). This CMP receives safety analysis on a single **webhook** endpoint. After the first successful delivery, each camera appears under **Edge Devices** (and on the dashboard).

### Webhook URL

Use your CMP’s public origin (same host as this site in the browser) with this path:

```text
https://<your-cmp-host>/api/webhook/edge-report
```

Example: if you open CMP at `https://my-cmp.vercel.app`, the webhook URL is:

```text
https://my-cmp.vercel.app/api/webhook/edge-report
```

> **In-app shortcut:** go to **Settings** → tab **Edge connection (PPE-UI)** — the page shows the exact URL for the deployment you are viewing.

### API key (`EDGE_API_KEY`)

Every request must include header **`X-API-Key`** with a secret shared by the edge and this CMP.

1. In **Vercel** (or your host), set environment variable **`EDGE_API_KEY`** for this CMP project to a strong random string.
2. On the edge, set the **same value** as **CMP API Key** in PPE-UI (or as `centralServer.apiKey` in config — see below).

If the key does not match, the webhook returns **401** and **no edge device** is created.

### Option A — PPE-UI Settings (recommended)

1. On the edge appliance, open **PPE-UI** in a browser.
2. Open **Settings** from the sidebar.
3. Turn on **Enable CMP reporting**.
4. **CMP Webhook URL:** paste the full webhook URL (see above).
5. **CMP API Key:** paste the same value as **`EDGE_API_KEY`** on this CMP.
6. Click **Save**.  
   The edge API merges this into the **repository root** `app.config.json` under `centralServer` and refreshes the forwarding service without a full redeploy.

### Option B — `app.config.json` on the edge (headless)

The Python service reads **`app.config.json` at the edge-linux repository root** (not only copies under `python/`). Set:

```json
"centralServer": {
  "enabled": true,
  "url": "https://<your-cmp-host>/api/webhook/edge-report",
  "apiKey": "<same as EDGE_API_KEY on CMP>"
}
```

Restart or wait for the config refresh cycle if you edit the file while the API is running.

### When data actually arrives

- The edge sends a payload **after each successful Deep Vision analysis** (RTSP frame → cloud/Gemini analysis → CMP).  
- You need at least one **enabled** RTSP camera in config, working **cloud** analysis, and **`ui.deepVisionEnabled`** not disabled in `app.config.json`.  
- **Vercel Deployment Protection** (login wall) blocks machine `POST`s — use a **public** production URL for the webhook, or disable protection for that deployment.

Technical payload and fields: **`WEBHOOK_API.md`** in the `CCTVCMP-linux` folder of the edge-linux repository.

---

*AXON Vision CMP — User Manual v1.0*
