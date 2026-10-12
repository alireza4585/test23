"""The only way worker code talks to an LLM."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from ..config import LLMSettings
from .providers import MockProvider, OpenAICompatibleProvider, Provider, ProviderError
from .redact import Redactor


class BudgetExceeded(Exception):
    pass


class LLMUnavailable(Exception):
    """No provider answered; callers fall back to their rule-based output."""


class Budget(Protocol):
    def remaining(self, hotel_id: str) -> int: ...
    def record(self, hotel_id: str, tokens_in: int, tokens_out: int) -> None: ...


class PocketBaseBudget:
    """aiBudgets in PocketBase, shared with the assistant in ai.js."""

    def __init__(self, pb):
        self._pb = pb

    def remaining(self, hotel_id: str) -> int:
        return int(self._pb.budget(hotel_id).get("remaining", 0))

    def record(self, hotel_id: str, tokens_in: int, tokens_out: int) -> None:
        self._pb.report_usage(hotel_id, tokens_in, tokens_out)


class MemoryBudget:
    def __init__(self, limit: int = 1_000_000):
        self.limit = limit
        self.used: dict[str, int] = {}

    def remaining(self, hotel_id: str) -> int:
        return max(0, self.limit - self.used.get(hotel_id, 0))

    def record(self, hotel_id: str, tokens_in: int, tokens_out: int) -> None:
        self.used[hotel_id] = self.used.get(hotel_id, 0) + tokens_in + tokens_out


@dataclass
class LLMResult:
    text: str
    model: str
    provider: str
    tokens_in: int
    tokens_out: int
    cost_micros: int
    latency_ms: int
    truncated: bool


class LLMGateway:
    def __init__(self, providers: list[Provider], budget: Budget, *, timeout: float = 30.0, max_tokens: int = 800,
                 price_in_per_mtok: float = 0.0, price_out_per_mtok: float = 0.0, cost_log_path: str | None = None,
                 clock: Callable[[], float] = time.time):
        if not providers:
            raise ValueError("at least one provider")
        self.providers = providers
        self.budget = budget
        self.timeout = timeout
        self.max_tokens = max_tokens
        self.price_in = price_in_per_mtok
        self.price_out = price_out_per_mtok
        self.cost_log_path = cost_log_path
        self._clock = clock
        self._log_lock = threading.Lock()

    def _log(self, entry: dict) -> None:
        """Cost and outcome only — never prompt or answer text."""
        if not self.cost_log_path:
            return
        with self._log_lock, open(self.cost_log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def complete(self, hotel_id: str, messages: list[dict], *, names: list[str] | tuple[str, ...] = (),
                 max_tokens: int | None = None, temperature: float = 0.2, purpose: str = "") -> LLMResult:
        if self.budget.remaining(hotel_id) <= 0:
            self._log({"ts": self._clock(), "hotel": hotel_id, "purpose": purpose, "status": "budget_exceeded"})
            raise BudgetExceeded(hotel_id)
        r = Redactor(names)
        safe = [{"role": m["role"], "content": r.text(m["content"])} for m in messages]
        limit = min(max_tokens or self.max_tokens, self.max_tokens)
        errors: list[str] = []
        for provider in self.providers:
            started = self._clock()
            try:
                c = provider.complete(safe, max_tokens=limit, temperature=temperature, timeout=self.timeout)
            except ProviderError as err:
                errors.append(str(err))
                self._log({"ts": started, "hotel": hotel_id, "purpose": purpose, "provider": provider.name,
                           "model": provider.model, "status": "error", "error": str(err)[:200]})
                continue
            latency = int((self._clock() - started) * 1000)
            cost = round(c.tokens_in * self.price_in + c.tokens_out * self.price_out)  # USD/Mtok == µUSD/token
            self.budget.record(hotel_id, c.tokens_in, c.tokens_out)
            self._log({"ts": started, "hotel": hotel_id, "purpose": purpose, "provider": provider.name, "model": c.model,
                       "status": "ok", "tokensIn": c.tokens_in, "tokensOut": c.tokens_out, "costMicros": cost,
                       "latencyMs": latency})
            return LLMResult(text=r.restore(c.text), model=c.model, provider=provider.name, tokens_in=c.tokens_in,
                             tokens_out=c.tokens_out, cost_micros=cost, latency_ms=latency,
                             truncated=c.finish_reason == "length")
        raise LLMUnavailable("; ".join(errors))


def build_gateway(settings: LLMSettings, budget: Budget) -> LLMGateway | None:
    """Gateway from ZH_LLM_* settings; None when no provider is configured."""
    providers: list[Provider] = []
    if settings.provider == "mock":
        providers.append(MockProvider())
    elif settings.provider == "openai_compatible" and settings.base_url and settings.model:
        providers.append(OpenAICompatibleProvider(settings.base_url, settings.model, settings.api_key, name="primary"))
        if settings.fallback_model:
            providers.append(OpenAICompatibleProvider(
                settings.fallback_base_url or settings.base_url, settings.fallback_model,
                settings.fallback_api_key or settings.api_key, name="fallback"))
    if not providers:
        return None
    return LLMGateway(providers, budget, timeout=settings.timeout_seconds, max_tokens=settings.max_tokens,
                      price_in_per_mtok=settings.price_in_per_mtok, price_out_per_mtok=settings.price_out_per_mtok,
                      cost_log_path=settings.cost_log_path)
