"""LLM providers behind one interface: OpenAI-compatible HTTP (Liara AI, a
gateway, vLLM, Ollama…) and a scripted mock for tests."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Protocol

import httpx


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class Completion:
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    finish_reason: str = "stop"


class Provider(Protocol):
    name: str
    model: str

    def complete(self, messages: list[dict], *, max_tokens: int, temperature: float, timeout: float) -> Completion: ...


def chat_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    return f"{base}/chat/completions" if re.search(r"/v\d+$", base) else f"{base}/v1/chat/completions"


class OpenAICompatibleProvider:
    def __init__(self, base_url: str, model: str, api_key: str = "", *, name: str = "primary",
                 transport: httpx.BaseTransport | None = None):
        if not base_url or not model:
            raise ValueError("base_url and model are required")
        self.name = name
        self.model = model
        self._url = chat_url(base_url)
        self._api_key = api_key
        self._transport = transport

    def complete(self, messages: list[dict], *, max_tokens: int, temperature: float, timeout: float) -> Completion:
        headers = {"content-type": "application/json"}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
        try:
            with httpx.Client(timeout=timeout, transport=self._transport) as http:
                res = http.post(self._url, json=body, headers=headers)
        except httpx.TimeoutException as err:
            raise ProviderError(f"{self.name}: timeout") from err
        except httpx.HTTPError as err:
            raise ProviderError(f"{self.name}: {type(err).__name__}") from err
        if res.status_code != 200:
            # 4xx other than 408/429 will fail the same way on retry.
            retryable = res.status_code >= 500 or res.status_code in (408, 429)
            raise ProviderError(f"{self.name}: HTTP {res.status_code}", retryable=retryable)
        data = res.json()
        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage") or {}
        return Completion(
            text=str((choice.get("message") or {}).get("content") or "").strip(),
            model=str(data.get("model") or self.model),
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            finish_reason=str(choice.get("finish_reason") or "stop"),
        )


@dataclass
class MockProvider:
    """Answers from a script (or echoes); records every request. No network."""

    name: str = "mock"
    model: str = "mock-model"
    script: list = field(default_factory=list)  # str answers or Exception instances
    requests: list = field(default_factory=list)

    def complete(self, messages: list[dict], *, max_tokens: int, temperature: float, timeout: float) -> Completion:
        self.requests.append({"messages": messages, "max_tokens": max_tokens, "temperature": temperature})
        nxt = self.script.pop(0) if self.script else "پاسخ آزمایشی."
        if isinstance(nxt, Exception):
            raise nxt
        tokens_in = sum(len(str(m.get("content", ""))) for m in messages) // 4
        return Completion(text=str(nxt), model=self.model, tokens_in=tokens_in, tokens_out=len(str(nxt)) // 4)
