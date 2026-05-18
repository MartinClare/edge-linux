# Local vision (FastAPI + embedded vLLM default)

The Node `cloud/` service calls this FastAPI app at **`LOCAL_VISION_API_URL`** (default `http://127.0.0.1:8001`). The default `vision.activeModel` is **`local_gemma4_e4b`**, which maps to `model_id=gemma-4-e4b`. With `LOCAL_VISION_BACKEND=vllm` (default), Gemma requests run through an embedded vLLM engine inside this FastAPI process.

## Gemma via embedded vLLM (default path)

FastAPI keeps the existing `/v1/vision/generate` API, but Gemma model IDs use vLLM internally for scheduling and concurrent inference.

```bash
cd deploy && docker compose -f docker-compose.local-vision-ngc.yml up -d --build
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8001/v1/vision/models
```

**Defaults:** `vision.activeModel` is **`local_gemma4_e4b`** and FastAPI `DEFAULT_MODEL_ID` is **`gemma-4-e4b`**. Use **`local_qwen3_vl_8b`** or **`local_qwen2_5_vl_7b`** for the Qwen Transformers path on the same port **8001**, **`local_qwen3_vllm`** for the separate OpenAI-compatible Qwen3-vLLM server on **8002**, or **OpenRouter** for hosted models.

Benchmark helper: `python/tmp/benchmark_vllm_throughput.py`.

## Transformers fallback (port 8001)

Set `LOCAL_VISION_BACKEND=transformers` to recover the older Gemma Transformers loader. Qwen model IDs always use the Transformers path. Switching `model_id` unloads the previous active model and loads the requested one.

### Run (venv)

From repo root, with the same venv that has `transformers`, CUDA PyTorch, etc.:

```bash
source venv/bin/activate
export DEFAULT_MODEL_ID=gemma-4-e4b
export LOCAL_VISION_BACKEND=vllm
export QWEN25_VL_PATH=/path/to/Qwen2.5-VL-7B-Instruct
export QWEN3_VL_8B_PATH=/path/to/Qwen3-VL-8B-Instruct
export GEMMA4_E4B_PATH=/path/to/gemma-4-E4B-it
export GEMMA3N_E4B_PATH=/path/to/gemma-3n-E4B-it
export GEMMA3N_E2B_PATH=/path/to/gemma-3n-E2B-it
cd python
python -m uvicorn app.local_vision_server:app --host 0.0.0.0 --port 8001
```

## GB10 / NGC Container

```bash
cd deploy
docker compose -f docker-compose.local-vision-ngc.yml up -d --build
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:8001/v1/vision/models
```

Mount model directories under `/home/interlv/models` (see `docker-compose.local-vision-ngc.yml`).

## `model_id` values

| `model_id` | Default path env | Model |
|------------|------------------|--------|
| `qwen2-5-vl-7b` | `QWEN25_VL_PATH` | Qwen2.5-VL-7B-Instruct |
| `qwen3-vl-8b` | `QWEN3_VL_8B_PATH` | Qwen3-VL-8B-Instruct |
| `gemma-4-e4b` | `GEMMA4_E4B_PATH` | google/gemma-4-E4B-it |
| `gemma-3n-e4b` | `GEMMA3N_E4B_PATH` | google/gemma-3n-E4B-it |
| `gemma-3n-e2b` | `GEMMA3N_E2B_PATH` | google/gemma-3n-E2B-it |

Hugging Face IDs: `Qwen/Qwen2.5-VL-7B-Instruct`, `Qwen/Qwen3-VL-8B-Instruct`, `google/gemma-4-E4B-it`, `google/gemma-3n-E4B-it`, `google/gemma-3n-E2B-it` — download to the paths above (use `HF_HUB_DISABLE_XET=1` if needed). Gemma models are gated; accept the license with the Hugging Face account used for downloading.

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `DEFAULT_MODEL_ID` | `gemma-4-e4b` | Preload on startup (if `PRECLOAD_DEFAULT=1`) |
| `LOCAL_VISION_BACKEND` | `vllm` | `vllm` for embedded Gemma vLLM, `transformers` for old Gemma path |
| `PRECLOAD_DEFAULT` | `1` | Preload `DEFAULT_MODEL_ID` in a background thread |
| `QWEN25_VL_PATH` / `QWEN3_VL_8B_PATH` / `GEMMA4_E4B_PATH` / `GEMMA3N_E4B_PATH` / `GEMMA3N_E2B_PATH` | under `/home/interlv/models/...` | Local weight directories |
| `INSPECTOR_MODEL_KIND` | `auto` | `qwen2_5_vl` vs `qwen3_vl` for Qwen paths |
| `VISUAL_TOKENS` | `512` | Qwen2.5-VL image token budget |
| `MAX_NEW_TOKENS_*` | see code | Generation limits |
| `ALERT_USE_ROLE` | `inspector` | For Qwen backends, `alert` uses the same VLM; Gemma backend uses Gemma for all roles |
| `VLLM_MAX_MODEL_LEN` / `VLLM_MAX_NUM_SEQS` / `VLLM_MAX_SOFT_TOKENS` | see code | Embedded vLLM runtime controls |

## API

- `GET /health` — device, `active_model_id`, paths.
- `GET /v1/vision/models` — which `model_id` values exist on disk.
- `POST /v1/vision/generate` — JSON:  
  `role` (`inspector` | `evaluator` | `alert`), `prompt`, `image_mime`, `image_base64`,  
  optional `model_id` (default `DEFAULT_MODEL_ID`), optional `max_new_tokens`.  
  Response: `text`, `role`, `model_path`, `model_id`.

Gemma vLLM requests are not serialized by the old lock; vLLM handles scheduling. Qwen/Transformers fallback requests remain serialized.

## Node.js + edge UI

Vision selection and CMP throttling are in `app.config.json` → `vision` (see `cloud/src/visionModels.ts`, `backgroundLoop.ts`).

Set `OPENROUTER_API_KEY` in the environment when `vision.activeModel` is `openrouter`.

## Two-stage (LOCAL_VISION_TWO_STAGE=1)

With a **Qwen** `model_id`, both inspector and evaluator calls use the same Qwen VLM. With **Gemma** `model_id`, both use Gemma. No second heavyweight download on the same box.
