# Edge AI – PPE / Safety Inspection

Edge application for camera streams, object detection (YOLO), and cloud AI analysis (OpenRouter/Gemini). Runs on Rockchip RK3576 (ARM64) and similar boards.

## Structure

| Path | Description |
|------|-------------|
| **python/** | FastAPI backend: RTSP streaming, detection (YOLO stub on RK3576), alarms, WebSocket feeds |
| **cloud/** | Node.js middleware (axon-vision-api): image analysis via OpenRouter/Gemini |
| **ppe-ui/** | React frontend (build output in `build/`) |
| **deploy/** | Systemd unit files and device install scripts |
| **app.config.json** | Cameras, central server URL, and runtime config |

## Prerequisites

- Python 3.10+ with venv
- Node.js 18+ (for cloud middleware)
- Cameras reachable via RTSP
- OpenRouter API key (for Gemini) – may require VPN in some regions

## Quick start

### 1. Python backend (port 8000)

```bash
cd python
python -m venv ../venv
source ../venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 2. Cloud middleware (port 3001)

```bash
cd cloud
npm install
npm run build
cp .env.example .env   # set OPENROUTER_API_KEY
npm start
```

### 3. UI

Serve the pre-built static files (e.g. with the Python backend or nginx). The UI expects the backend at port 8000 and the cloud API at 3001.

## Configuration

- **python/app.config.json** and root **app.config.json**: camera RTSP URLs and `centralServer.url`.
- **cloud/.env**: `OPENROUTER_API_KEY` (and optional vars). Do not commit `.env`.

## Deployment (systemd)

From the repo root:

```bash
sudo cp deploy/edge-python.service deploy/edge-ui.service deploy/edge-cloud.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable edge-python edge-ui edge-cloud
sudo systemctl start edge-python edge-ui edge-cloud
```

Adjust paths and `User`/`Group` in the service files to match your install.

## Notes

- **RK3576**: The app uses a YOLO *stub* (no torch/ultralytics) so the backend runs without NPU/GPU; detection endpoints return empty results unless you deploy an RKNN-compatible stack.
- **Gemini / OpenRouter**: If the API is geo-blocked, use a VPN (e.g. Mullvad WireGuard) so traffic from the device exits in a supported region.
- **LAN access**: The built UI rewrites `localhost` to the current hostname so it works when opened from another machine on the network.

## Current deployed behavior (Mar 2026)

- **Backend is ground truth for incident reporting**:
  - Deep Vision analysis runs in the Python backend background loop.
  - Backend sends analysis/incident reports to CMP via `alarm_observer`.
  - PPE-UI is display/configuration only (UI no longer forwards incident reports to CMP directly).
- **CMP payload includes full safety fields**:
  - `overallDescription`, `overallRiskLevel`
  - `constructionSafety`, `fireSafety`, `propertySecurity`
  - `peopleCount`, `missingHardhats`, `missingVests`
- **Config source of truth**:
  - `app.config.json` controls cameras, CMP, VPN/network roles, and UI defaults.
  - `ui.deepVisionEnabled` defaults to enabled unless explicitly set to `false`.
- **Dual-LAN deployment model**:
  - `eth2`: camera LAN (example static `192.168.100.254/24`, no gateway)
  - `eth1`: internet/4G-5G uplink (default route, DHCP)
  - Camera subnet route is pinned to `eth2` while internet/cloud traffic uses uplink/VPN.
- **VPN + cloud dependency**:
  - `wg-mullvad` is used for OpenRouter region access where required.
  - `edge-cloud.service` depends on `wg-mullvad.service` so cloud analysis starts with VPN path ready.
- **Boot persistence**:
  - `wg-mullvad`, `edge-python`, `edge-cloud`, `edge-ui`, and `tailscaled` are expected to be enabled at boot.
  - System should recover analysis + CMP forwarding automatically after reboot.

## Remote access (Tailscale)

Tailscale gives stable remote access even when the 5G public IP changes after reboot.

- Install Tailscale on both this edge device and your Windows PC.
- Log both devices into the same Tailscale account/tailnet.
- Keep `tailscaled` enabled on boot:

```bash
sudo systemctl enable --now tailscaled
sudo tailscale up --ssh
```

Once connected, access by Tailscale IP or DNS name (from Windows):

```bash
ssh admin@<tailscale-ip>
ssh admin@<device-name>.<tailnet-name>.ts.net
```

Web access over Tailscale:

- UI: `http://<tailscale-ip>:3000`
- Backend API: `http://<tailscale-ip>:8000`

This works across reboots and 5G IP changes as long as both devices are online and logged into Tailscale.

## License

See repository or project documentation.
