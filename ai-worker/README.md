# Zarin AI worker

Python service for the AI jobs that do not belong inside PocketBase's JS
hooks (long LLM calls, statistics, scheduled analysis). PocketBase stays the
source of truth and enforces permissions; the worker uses only the signed
integration API with a **scoped key** (one or more hotels).

```
worker/
  config.py        settings from ZH_* environment variables (no secret defaults)
  pb_client.py     PocketBase /v1 client, HMAC v2 (key id + timestamp + nonce)
  jobs.py          idempotent jobs in SQLite: keys, retry + exponential backoff, dead jobs
  llm/             gateway: OpenAI-compatible providers with fallback and timeout,
                   per-hotel budget (PocketBase aiBudgets), cost log, PII redaction
  builtin_jobs.py  phase 0: ping (signed read), llm_selftest (gateway)
  api.py           FastAPI: GET /health, signed POST /jobs/{name}, GET /jobs/{key}
eval/              Persian assistant eval (see eval/README.md)
tests/             pytest (unit + live tests against a local PocketBase)
```

Why FastAPI and not a bare job runner: Liara runs apps behind an HTTP port
and health check, and n8n / PocketBase need a signed way to trigger jobs;
FastAPI gives that plus request validation with little code. The job logic
itself does not depend on it (`python -m worker run <job> <hotel>`).

Why the gateway is a module here and not a LiteLLM proxy (for now): one
consumer, low volume, and LiteLLM's budgets need an extra service and
database; a smaller dependency tree is also a smaller supply-chain surface.
The provider interface is OpenAI-compatible, so moving to LiteLLM, another
gateway or a self-hosted vLLM later is a configuration change.

## Run locally

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # unit tests; live tests skip without a server
python -m worker check                   # which required variables are missing
python -m worker run ping <hotelId>      # needs ZH_PB_URL, ZH_WORKER_KEY_ID, ZH_WORKER_SECRET
python -m worker serve                   # http://localhost:8000/health
```

Live tests against `npm run test-server`: create a key for the test hotel
(`npm run integration-key` in `pocketbase/`), then set `ZH_PB_TEST_URL`,
`ZH_PB_TEST_HOTEL`, `ZH_PB_TEST_KEY_ID`, `ZH_PB_TEST_KEY_SECRET`.

Environment variables and the Liara deployment steps: `docs/16-ai-architecture.md`.
