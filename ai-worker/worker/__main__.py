"""python -m worker serve              # HTTP (health, signed triggers) + job loop
python -m worker run <job> <hotelId>  # one job now; prints the result
python -m worker check                # which required variables are missing"""

from __future__ import annotations

import json
import os
import sys

from .config import Settings


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "serve"
    settings = Settings.from_env()
    if cmd == "check":
        missing = settings.missing()
        print("missing: " + ", ".join(missing) if missing else "configuration complete")
        print(f"LLM provider: {settings.llm.provider} ({'configured' if settings.llm.model or settings.llm.provider == 'mock' else 'not configured'})")
        return 1 if missing else 0
    if cmd == "run":
        if len(argv) < 3:
            print("usage: python -m worker run <job> <hotelId> [payload-json]", file=sys.stderr)
            return 2
        from .main import build_runner

        runner = build_runner(settings)
        payload = json.loads(argv[3]) if len(argv) > 3 else {}
        rec = runner.run_now(argv[1], argv[2], payload)
        print(json.dumps({"key": rec.key, "status": rec.status, "attempts": rec.attempts, "result": rec.result,
                          "error": rec.last_error or None}, ensure_ascii=False, indent=2))
        return 0 if rec.status == "done" else 1
    if cmd == "serve":
        import uvicorn

        uvicorn.run("worker.main:create_default_app", factory=True, host="0.0.0.0",
                    port=int(os.environ.get("PORT", "8000")), log_level="info")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
