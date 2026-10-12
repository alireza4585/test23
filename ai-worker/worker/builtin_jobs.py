"""Phase 0 jobs: prove the signed PocketBase path and the LLM gateway.
Feature jobs (energy_model, impact, briefing, replenishment, assistant)
arrive in later phases on the same framework."""

from __future__ import annotations

from .jobs import JobContext, JobRunner, PermanentError
from .llm import BudgetExceeded, LLMUnavailable
from .pb_client import PocketBaseError


def _allowed(ctx: JobContext) -> None:
    hotels = ctx.services.get("hotel_ids") or ()
    if hotels and ctx.hotel_id not in hotels:
        raise PermanentError(f"hotel {ctx.hotel_id} is not served by this worker")


def _pb_call(fn, *args):
    try:
        return fn(*args)
    except PocketBaseError as err:
        if err.retryable:
            raise
        raise PermanentError(str(err)) from err


def ping(ctx: JobContext, payload: dict) -> dict:
    """Reads the hotel's summary through the scoped key (HMAC v2)."""
    _allowed(ctx)
    pb = ctx.services["pb"]
    s = _pb_call(pb.summary, ctx.hotel_id)
    return {"hotelId": s.get("hotelId"), "day": s.get("day"), "openAlerts": len(s.get("alerts") or [])}


def llm_selftest(ctx: JobContext, payload: dict) -> dict:
    """One tiny completion through the gateway (budget, fallback, cost log)."""
    _allowed(ctx)
    gateway = ctx.services.get("gateway")
    if gateway is None:
        raise PermanentError("no LLM provider configured (ZH_LLM_*)")
    try:
        r = gateway.complete(ctx.hotel_id, [{"role": "user", "content": "Reply with the single word OK."}],
                             max_tokens=8, temperature=0, purpose="selftest")
    except BudgetExceeded as err:
        raise PermanentError(f"budget exceeded for {err}") from err
    except LLMUnavailable:
        raise  # retried with backoff
    return {"provider": r.provider, "model": r.model, "tokensIn": r.tokens_in, "tokensOut": r.tokens_out,
            "latencyMs": r.latency_ms}


def register_builtin(runner: JobRunner) -> None:
    runner.register("ping", ping, max_attempts=3, base_delay=5)
    runner.register("llm_selftest", llm_selftest, max_attempts=3, base_delay=10)
