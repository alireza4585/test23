"""Client for the PocketBase integration API with v2 (scoped key) signing.

Each request carries:
    x-zarin-key-id, x-zarin-timestamp, x-zarin-nonce,
    x-zarin-signature = hex(HMAC_SHA256(secret, f"{timestamp}.{nonce}.{raw_body}"))
The key only works for the hotels in its scope (enforced by PocketBase).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import httpx


class PocketBaseError(Exception):
    def __init__(self, status: int, code: str | None, message: str = ""):
        super().__init__(f"PocketBase {status} {code or ''} {message}".strip())
        self.status = status
        self.code = code

    @property
    def retryable(self) -> bool:
        return self.status >= 500 or self.status == 429


def sign(secret: str, timestamp: int, nonce: str, raw: str) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.{nonce}.{raw}".encode(), hashlib.sha256).hexdigest()


class PocketBaseClient:
    def __init__(self, base_url: str, key_id: str, secret: str, *, timeout: float = 20.0,
                 transport: httpx.BaseTransport | None = None, clock=time.time):
        self._key_id = key_id
        self._secret = secret
        self._clock = clock
        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def request(self, method: str, path: str, body: Any = None, params: dict | None = None) -> Any:
        raw = "" if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        ts = int(self._clock())
        nonce = secrets.token_hex(16)
        headers = {
            "content-type": "application/json",
            "x-zarin-key-id": self._key_id,
            "x-zarin-timestamp": str(ts),
            "x-zarin-nonce": nonce,
            "x-zarin-signature": sign(self._secret, ts, nonce, raw),
        }
        res = self._http.request(method, path, content=raw.encode() if raw else None, headers=headers, params=params)
        data: Any
        try:
            data = res.json()
        except ValueError:
            data = None
        if res.status_code >= 400:
            code = None
            if isinstance(data, dict):
                code = ((data.get("data") or {}).get("code") or {}).get("code")
            raise PocketBaseError(res.status_code, code, (data or {}).get("message", "") if isinstance(data, dict) else "")
        return data

    # ------------------------------------------------------------ endpoints
    def summary(self, hotel_id: str, day: str | None = None) -> dict:
        return self.request("GET", f"/v1/hotels/{hotel_id}/summary", params={"day": day} if day else None)

    def budget(self, hotel_id: str) -> dict:
        return self.request("GET", f"/v1/hotels/{hotel_id}/ai/budget")

    def report_usage(self, hotel_id: str, tokens_in: int, tokens_out: int) -> dict:
        return self.request("POST", f"/v1/hotels/{hotel_id}/ai/usage", {"tokensIn": int(tokens_in), "tokensOut": int(tokens_out)})

    def post_insight(self, hotel_id: str, insight: dict) -> dict:
        return self.request("POST", f"/v1/hotels/{hotel_id}/insights", insight)
