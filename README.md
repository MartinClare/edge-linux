# Edge AI – PPE / Safety Inspection

Edge application for camera streams, object detection (YOLO), and local vision LLM analysis. **Default vision path:** Gemma via embedded **vLLM** inside the FastAPI local vision server on port **8001** (`local_gemma4_e4b`). Optional: direct Qwen3-vLLM on **8002**, Transformers FastAPI, OpenRouter, or Rockchip targets.

## Structure

| Path | Description |
|------|-------------|
| **python/** | FastAPI backend: RTSP streaming, detection (YOLO stub on RK3576), alarms, WebSocket feeds |
| **cloud/** | Node.js API (port 3001): Deep Vision + CMP; default `LOCAL_VISION_API_URL` (FastAPI on 8001, embedded vLLM for Gemma) |
| **ppe-ui/** | React frontend (build output in `build/`) |
| **deploy/** | Systemd unit files and device install scripts |
| **app.config.json** | Cameras, central server URL, and runtime config |

## Prerequisites

- Python 3.10+ with venv
- Node.js 18+ (for cloud middleware)
- Cameras reachable via RTSP
- Local model weights (e.g. under `/home/.../models/`) and Hugging Face login if required for download

## Quick start

### 1. Python backend (port 8000)

**NVIDIA DGX / other CUDA GPU:** install a CUDA build of PyTorch *before* the other packages. From the repo root:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -U pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r python/requirements.txt
cd python
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Rockchip edge devices** follow the install order in `python/requirements.txt` (PyTorch CPU, optional RKNN wheel, then `requirements-rk3588.txt` on-device).


### 1b. Local vision via FastAPI + embedded vLLM (port 8001) — default for GPU edges

**Start this before** the cloud service when using `vision.activeModel` **`local_gemma4_e4b`** (default in `app.config.json`):

```bash
cd deploy
docker compose -f docker-compose.local-vision-ngc.yml up -d --build
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8001/v1/vision/models
```

See [python/LOCAL_VISION.md](python/LOCAL_VISION.md) and `deploy/docker-compose.local-vision-ngc.yml`. The FastAPI service embeds vLLM for Gemma when `LOCAL_VISION_BACKEND=vllm`.

### 1c. Optional: direct OpenAI-compatible Qwen3-vLLM (port 8002)

Use `deploy/docker-compose.local-vllm.yml` only if you select `vision.activeModel` **`local_qwen3_vllm`**. The default Gemma path does not require port 8002.

### 1d. Optional: Transformers fallback inside FastAPI (port 8001)

Set `LOCAL_VISION_BACKEND=transformers` to recover the older serialized Transformers behavior for Gemma. Qwen2.5/Qwen3 FastAPI model IDs still use the Transformers path.

The bare-venv path is still available for CUDA stacks that support the GPU:

```bash
source venv/bin/activate
export QWEN25_VL_PATH=/path/to/Qwen2.5-VL-7B-Instruct
export QWEN3_VL_8B_PATH=/path/to/Qwen3-VL-8B-Instruct
export GEMMA4_E4B_PATH=/path/to/gemma-4-E4B-it
export GEMMA3N_E4B_PATH=/path/to/gemma-3n-E4B-it
export GEMMA3N_E2B_PATH=/path/to/gemma-3n-E2B-it
export DEFAULT_MODEL_ID=gemma-4-e4b
export LOCAL_VISION_BACKEND=vllm
cd python
python -m uvicorn app.local_vision_server:app --host 0.0.0.0 --port 8001
```

See [python/LOCAL_VISION.md](python/LOCAL_VISION.md) for environment variables and troubleshooting.

### 2. Cloud middleware (port 3001)

```bash
cd cloud
npm install
npm run build
cp .env.example .env   # Default path: LOCAL_VISION_API_URL=http://127.0.0.1:8001
npm start
```

### 3. UI

Serve the pre-built static files (e.g. with the Python backend or nginx). The UI expects the backend at port 8000 and the cloud API at 3001.

## Configuration

- **python/app.config.json** and root **app.config.json**: camera RTSP URLs and `centralServer.url`.
- **cloud/.env**: **`LOCAL_VISION_API_URL`** for default FastAPI Gemma-vLLM (8001). Direct Qwen3-vLLM on 8002 uses `LOCAL_VLLM_API_URL` / `LOCAL_VLLM_MODEL`. OpenRouter: `OPENROUTER_API_KEY`.

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
- **Local LLM**: Ensure **FastAPI on 8001** is up for the default Gemma-vLLM path. The Deep Vision background loop will not report to CMP when the evaluator sets `shouldReport: false` (or on evaluator failure, see `LOCAL_EVALUATOR_FAIL_NO_REPORT`).
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
  - Camera subnet route is pinned to `eth2` while internet/cloud traffic uses uplink.
- **VPN and cloud**:
  - `wg-mullvad` is used for OpenRouter region access where required.
  - VPN traffic is policy-routed for the `edge` service user only (cloud/Gemini path), so Tailscale and camera access are unaffected by VPN toggles.
  - `edge-cloud.service` runs independently of VPN; it is kept running even when VPN is off.
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

**Tailscale in app.config.json:** Set `tailscale.enabled` to `true` or `false` in root `app.config.json`. You can also toggle it in PPE-UI **Settings** (under VPN): "Enable Tailscale (remote access)". Saving applies the change immediately (runs `tailscale up` or `tailscale down` on the device).

## License

See repository or project documentation.
