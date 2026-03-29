# AXON Vision Central Monitoring Platform (CMP) — **CCTVCMP-linux**

**`CCTVCMP-linux`** is a **standalone copy** of the CMP application kept inside the **edge-linux** repository for Linux and on-prem workflows. It is **not** a git submodule, symlink, or automatic mirror of another GitHub project — treat this folder as its own app (own `package.json`, migrations, deploy root). You may connect it to a separate remote or ship it only as part of edge-linux.

A production-ready full-stack application for centralized construction AI safety monitoring. Edge devices stream live AI analysis to the CMP via webhook; the platform classifies reports, triggers alarms, tracks incidents through their full lifecycle, and surfaces real-time analytics dashboards for project safety teams.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript) |
| Database | PostgreSQL via [Neon](https://neon.tech) |
| ORM | Prisma 5 |
| Auth | JWT (HS256) in HTTP-only cookies |
| Styling | TailwindCSS 3 + shadcn/ui |
| Charts | Recharts |
| LLM | OpenRouter → Google Gemini (incident classification) |
| Deployment | Vercel |

---

## Features

- **Authentication** — Email/password with bcrypt hashing and secure HTTP-only JWT cookies
- **RBAC** — Four roles: `admin`, `project_manager`, `safety_officer`, `viewer` — enforced at the middleware and API level
- **Edge Device Webhook** — Edge cameras auto-register and stream AI analysis reports via `POST /api/webhook/edge-report` authenticated by `X-API-Key`
- **LLM Incident Classification** — CMP uses OpenRouter/Gemini to classify edge reports into 8 incident types (PPE violation, fire, fall risk, etc.)
- **Alarm Engine** — Configurable alarm rules with per-type thresholds, deduplication window, consecutive-hit requirements, and record-only mode
- **Incidents** — Full lifecycle: `open → acknowledged → resolved / dismissed` with per-action audit log
- **Edge Device Management** — Register, monitor, and toggle maintenance mode for all edge cameras; auto-refreshes every 10 s
- **Analytics** — All charts are computed from real `edge_reports` data: daily report volume by risk level, risk distribution pie, and per-day PPE compliance trend
- **KPI Dashboard** — Total open incidents, high-risk count, online devices, recent alert feed
- **Hong Kong Time** — All timestamps displayed in HKT (UTC+8)

---

## Project Structure

```
app/
  (protected)/
    dashboard/          # KPI overview + alert feed
    incidents/          # Incident table, detail page, status actions
    edge-devices/       # Device list + per-device detail & report history
    analytics/          # Real-data charts from edge_reports
    settings/           # Alarm rule configuration
  api/
    auth/signin         # POST
    auth/signup         # POST — disabled (403); admins create users via /api/users or DB
    auth/signout        # POST
    incidents/          # GET, POST
    incidents/[id]/     # GET, PATCH
    edge-devices/       # GET
    edge-devices/[id]/  # GET, PATCH, DELETE
    projects/           # GET, POST
    users/              # GET, POST
    analytics/          # GET
    webhook/edge-report # POST — edge device ingest endpoint
  signin/
components/
  ui/                   # Button, Card, Input, Badge, Table, …
  layout/               # AppShell, Sidebar, TopNavbar
  auth/                 # AuthForm
  incidents/            # IncidentTable, IncidentActions, IncidentNotes
  edge-devices/         # EdgeDeviceList, RegisterDeviceForm
  analytics/            # AnalyticsCharts
  dashboard/            # AlertFeed, EdgeStatusPanel
  auto-refresh.tsx      # Client component — calls router.refresh() on interval
lib/
  auth.ts               # JWT sign/verify, bcrypt helpers, cookie helpers
  prisma.ts             # Prisma singleton
  rbac.ts               # Role access checks
  analytics.ts          # Snapshot builder (from EdgeReport[])
  llm-classifier.ts     # OpenRouter/Gemini incident type classification
  alarm-engine.ts       # Alarm rule evaluation + dedup + incident creation
  utils.ts              # formatHKT() and cn() helpers
  validations/
    webhook.ts          # Zod schema for edge-report payload
    auth.ts
    incidents.ts
prisma/
  schema.prisma
middleware.ts           # Edge RBAC + auth guard
```

---

## Database Schema

| Table | Description |
|---|---|
| `users` | Authenticated users with role |
| `projects` | Construction site projects |
| `zones` | Risk zones within a project |
| `cameras` | Edge cameras; auto-created on first report by `edgeCameraId` |
| `edge_reports` | Raw AI analysis reports received from edge devices |
| `incidents` | Safety incidents with lifecycle status and audit trail |
| `incident_logs` | Per-action audit log for every incident transition |
| `alarm_rules` | Configurable rules mapping incident types to thresholds |
| `notification_channels` | Email / webhook / dashboard notification targets |
| `notification_logs` | Log of every notification sent |

---

## Environment Variables

```env
# Neon pooled connection string (hostname must contain -pooler)
DATABASE_URL="postgresql://user:password@host-pooler.region.aws.neon.tech/dbname?sslmode=require"

# Strong random secret for signing JWTs (32+ chars)
JWT_SECRET="replace-with-a-long-random-secret"

# Must match centralServer.apiKey in the edge device app.config.json
EDGE_API_KEY="axonedge852852"

# OpenRouter API key — used by CMP to classify incident types via Gemini
OPENROUTER_API_KEY="sk-or-v1-..."
```

> **Neon tip:** Use the **pooled** connection string (hostname contains `-pooler`). Remove `&channel_binding=require` from the URL — Prisma does not support it.  
> **Vercel:** Set only `DATABASE_URL` (and the other three vars below). `DIRECT_URL` is not required unless you re-enable a separate `directUrl` in `prisma/schema.prisma` for Neon direct connections.

---

## Local Setup

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/dashboard`.

---

## Deploying to Vercel

1. Push the repository to GitHub.
2. In [Vercel](https://vercel.com), import the **edge-linux** monorepo and set **Root Directory** to `CCTVCMP-linux` (this folder only).
3. Add the four **Environment Variables** listed above under *Project Settings → Environment Variables* for Production.
4. Deploy. Each deploy runs `prisma migrate deploy` then `next build`.

### After first deploy — create your admin user

Run the following locally (with your production `DATABASE_URL`) or via the Neon console to insert your first admin account:

```bash
# Hash the password locally
node -e "require('bcryptjs').hash('YourPassword', 12).then(console.log)"

# Then INSERT into users via Neon SQL editor or psql:
# INSERT INTO users (id, name, email, hashed_password, role, created_at, updated_at)
# VALUES (gen_random_uuid()::text, 'Name', 'email@example.com', '<hash>', 'admin', NOW(), NOW());
```

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint checks |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Apply DB migrations (dev) |
| `npm run db:push` | Push schema without migration (dev only) |

---

## API Reference

### Auth

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | — | **Disabled** (403). Admins create users: `POST /api/users` (admin session) or SQL |
| POST | `/api/auth/signin` | `{ email, password }` | Sign in, sets cookie |
| POST | `/api/auth/signout` | — | Clears auth cookie |

### Incidents

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/incidents` | List all incidents |
| POST | `/api/incidents` | Create incident |
| GET | `/api/incidents/[id]` | Get single incident with logs |
| PATCH | `/api/incidents/[id]` | Update status, notes, or assignee |

### Edge Devices

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/edge-devices` | List all registered cameras |
| GET | `/api/edge-devices/[id]` | Get camera + recent reports |
| PATCH | `/api/edge-devices/[id]` | Update status / name |
| DELETE | `/api/edge-devices/[id]` | Remove camera + all its data |

### Edge Webhook (machine-to-machine)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/webhook/edge-report` | `X-API-Key` header | Ingest AI analysis from edge device. Auto-creates the camera record on first call. Runs LLM classification and alarm evaluation in the background. |

See `WEBHOOK_API.md` for full payload schema and examples.

### Other

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/projects` | List or create projects |
| GET/POST | `/api/users` | List or create users (admin only) |
| GET | `/api/analytics` | Trend + KPI snapshot from real edge_reports |

---

## Edge Device Integration

The CMP pairs with the **edge-linux** stack in the parent repository (Python + `cloud/` Node service), which runs:

- **Python backend** (`python/`) — captures RTSP frames, calls the local Node.js service, and forwards analysis to this CMP webhook via `alarm_observer.py` / `cmp_webhook.py`
- **Node.js cloud service** (`cloud/`) — calls OpenRouter/Gemini Vision with the raw JPEG frame and returns structured safety analysis

### Data flow

```
RTSP Camera
    ↓ JPEG frame (every N seconds)
Python backend (port 8000)
    ↓ POST /api/analyze-image
Node.js cloud service (port 3001) — uses edge's own OPENROUTER_API_KEY
    ↓ Gemini Vision → structured JSON (people count, PPE, issues)
Python alarm_observer._send_to_central_server()
    ↓ POST https://cctvcmp.vercel.app/api/webhook/edge-report
    ↓   Header: X-API-Key: <EDGE_API_KEY>
CMP Webhook — saves EdgeReport, responds 202 immediately
    ↓ background: LLM classifies issues into incident types
    ↓ Alarm engine evaluates rules, deduplicates, creates Incidents
Incidents page — live results, auto-refreshes every 10 s
```

### Edge device `app.config.json` (relevant section)

```json
"centralServer": {
  "enabled": true,
  "url": "https://cctvcmp.vercel.app/api/webhook/edge-report",
  "apiKey": "axonedge852852"
}
```

`apiKey` here must match `EDGE_API_KEY` in Vercel.

---

## Incident Types

| Type | Trigger |
|---|---|
| `ppe_violation` | Missing hardhats or vests detected |
| `fall_risk` | Fall hazard reported in analysis |
| `restricted_zone_entry` | Unauthorised area breach |
| `machinery_hazard` | Equipment safety issue |
| `near_miss` | Near-miss event detected |
| `smoking` | Smoking detected on site |
| `fire_detected` | Fire identified in frame |
| `smoke_detected` | Smoke identified in frame |

---

## Role Permissions

| Route / Action | admin | project_manager | safety_officer | viewer |
|---|:---:|:---:|:---:|:---:|
| Dashboard, Incidents, Analytics, Edge Devices | ✅ | ✅ | ✅ | ✅ |
| Settings (alarm rules) | ✅ | ✅ | ❌ | ❌ |
| `/api/users` | ✅ | ❌ | ❌ | ❌ |
| `/api/projects` | ✅ | ✅ | ❌ | ❌ |

---

## Security Notes

- Passwords are hashed with bcrypt (12 rounds)
- JWTs are signed HS256, stored in HTTP-only `SameSite=Strict` cookies, expire after 7 days
- All API routes verify the auth cookie before any DB access
- Role checks are enforced in both middleware (edge runtime) and API route handlers
- Webhook authenticated by `X-API-Key`; no user JWT required or accepted
- Never commit `.env` — excluded via `.gitignore`
