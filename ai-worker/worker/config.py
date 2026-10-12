"""Settings from the environment. Nothing secret has a default."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class LLMSettings:
    provider: str = "openai_compatible"  # openai_compatible | mock | none
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    model: str = ""
    fallback_base_url: str = ""
    fallback_api_key: str = field(default="", repr=False)
    fallback_model: str = ""
    timeout_seconds: float = 30.0
    max_tokens: int = 800
    price_in_per_mtok: float = 0.0  # USD per million input tokens
    price_out_per_mtok: float = 0.0
    cost_log_path: str = "cost-log.jsonl"


@dataclass(frozen=True)
class Settings:
    pb_url: str = ""
    key_id: str = ""
    secret: str = field(default="", repr=False)
    hotel_ids: tuple[str, ...] = ()
    trigger_secret: str = field(default="", repr=False)
    db_path: str = "worker.db"
    poll_seconds: float = 5.0
    llm: LLMSettings = field(default_factory=LLMSettings)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            pb_url=_env("ZH_PB_URL").rstrip("/"),
            key_id=_env("ZH_WORKER_KEY_ID"),
            secret=_env("ZH_WORKER_SECRET"),
            hotel_ids=tuple(h.strip() for h in _env("ZH_WORKER_HOTEL_IDS").split(",") if h.strip()),
            trigger_secret=_env("ZH_WORKER_TRIGGER_SECRET"),
            db_path=_env("ZH_WORKER_DB", "worker.db"),
            poll_seconds=_float("ZH_WORKER_POLL_SECONDS", 5.0),
            llm=LLMSettings(
                provider=_env("ZH_LLM_PROVIDER", "openai_compatible"),
                base_url=_env("ZH_LLM_BASE_URL").rstrip("/"),
                api_key=_env("ZH_LLM_API_KEY"),
                model=_env("ZH_LLM_MODEL"),
                fallback_base_url=_env("ZH_LLM_FALLBACK_BASE_URL").rstrip("/"),
                fallback_api_key=_env("ZH_LLM_FALLBACK_API_KEY"),
                fallback_model=_env("ZH_LLM_FALLBACK_MODEL"),
                timeout_seconds=_float("ZH_LLM_TIMEOUT_SECONDS", 30.0),
                max_tokens=_int("ZH_LLM_MAX_TOKENS", 800),
                price_in_per_mtok=_float("ZH_LLM_PRICE_IN_PER_MTOK", 0.0),
                price_out_per_mtok=_float("ZH_LLM_PRICE_OUT_PER_MTOK", 0.0),
                cost_log_path=_env("ZH_LLM_COST_LOG", "cost-log.jsonl"),
            ),
        )

    def missing(self) -> list[str]:
        """Names of required variables that are not set (values never shown)."""
        need = {"ZH_PB_URL": self.pb_url, "ZH_WORKER_KEY_ID": self.key_id, "ZH_WORKER_SECRET": self.secret}
        return [k for k, v in need.items() if not v]
