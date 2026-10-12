"""HTTP surface: health check and signed job triggers (n8n / PocketBase).

POST /jobs/{name} and GET /jobs/{key} are signed like the PocketBase v2
scheme, with ZH_WORKER_TRIGGER_SECRET:
    x-zarin-timestamp, x-zarin-nonce,
    x-zarin-signature = hex(HMAC_SHA256(secret, f"{timestamp}.{nonce}.{raw_body}"))
"""

from __future__ import annotations

import hmac
import json
import re
import sqlite3
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request

from . import __version__
from .config import Settings
from .jobs import JobRunner
from .pb_client import sign

MAX_SKEW = 300
NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


class NonceGuard:
    """Each nonce is accepted once within the timestamp window."""

    def __init__(self, db_path: str, clock=time.time):
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._lock = threading.Lock()
        self._clock = clock
        with self._lock:
            self._db.execute("CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, at REAL NOT NULL)")
            self._db.commit()

    def accept(self, nonce: str) -> bool:
        now = self._clock()
        with self._lock:
            self._db.execute("DELETE FROM nonces WHERE at < ?", (now - 2 * MAX_SKEW,))
            try:
                self._db.execute("INSERT INTO nonces (nonce, at) VALUES (?, ?)", (nonce, now))
            except sqlite3.IntegrityError:
                self._db.commit()
                return False
            self._db.commit()
            return True


def create_app(settings: Settings, runner: JobRunner, *, start_loop: bool = True, clock=time.time) -> FastAPI:
    nonces = NonceGuard(settings.db_path, clock)
    stop = threading.Event()

    def loop() -> None:
        while not stop.wait(settings.poll_seconds):
            try:
                runner.run_due()
            except Exception as err:  # noqa: BLE001 — keep the loop alive
                print(f"job loop error: {type(err).__name__}: {err}", flush=True)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        thread = threading.Thread(target=loop, daemon=True) if start_loop else None
        if thread:
            thread.start()
        yield
        stop.set()

    app = FastAPI(title="Zarin AI worker", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)

    async def verified(request: Request) -> dict:
        raw = (await request.body()).decode()
        secret = settings.trigger_secret
        try:
            ts = int(request.headers.get("x-zarin-timestamp", ""))
        except ValueError:
            ts = 0
        nonce = request.headers.get("x-zarin-nonce", "")
        sig = request.headers.get("x-zarin-signature", "")
        fresh = abs(clock() - ts) <= MAX_SKEW
        if not secret or not fresh or not NONCE_RE.match(nonce) or not sig \
                or not hmac.compare_digest(sig, sign(secret, ts, nonce, raw)):
            raise HTTPException(401, "invalid_signature")
        if not nonces.accept(nonce):
            raise HTTPException(401, "replayed_request")
        if not raw:
            return {}
        try:
            body = json.loads(raw)
        except ValueError as err:
            raise HTTPException(400, "invalid_body") from err
        if not isinstance(body, dict):
            raise HTTPException(400, "invalid_body")
        return body

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "service": "zarin-ai-worker", "version": __version__, "jobs": runner.names,
                "missingConfig": settings.missing(), "llm": runner.services.get("gateway") is not None}

    @app.post("/jobs/{name}")
    async def trigger(name: str, request: Request) -> dict:
        body = await verified(request)
        if name not in runner.names:
            raise HTTPException(404, "unknown_job")
        hotel = str(body.get("hotelId") or "")
        if not re.match(r"^[A-Za-z0-9_-]{3,40}$", hotel):
            raise HTTPException(400, "hotel_required")
        payload = body.get("payload") or {}
        key = body.get("key")
        if not isinstance(payload, dict) or (key is not None and not re.match(r"^[A-Za-z0-9_:.-]{8,80}$", str(key))):
            raise HTTPException(400, "invalid_body")
        if body.get("wait"):
            rec = runner.run_now(name, hotel, payload, key)
        else:
            rec = runner.get(runner.submit(name, hotel, payload, key))
        return {"key": rec.key, "status": rec.status, "attempts": rec.attempts, "result": rec.result,
                "error": rec.last_error or None}

    @app.get("/jobs/{key}")
    async def status(key: str, request: Request) -> dict:
        await verified(request)
        rec = runner.get(key)
        if not rec:
            raise HTTPException(404, "unknown_key")
        return {"key": rec.key, "name": rec.name, "status": rec.status, "attempts": rec.attempts,
                "result": rec.result, "error": rec.last_error or None}

    return app
