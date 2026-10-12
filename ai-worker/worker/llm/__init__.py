"""LLM gateway: provider chain with timeout and fallback, per-hotel budget,
cost log and PII redaction. Swapping the model or the provider is
configuration only (ZH_LLM_*)."""

from .gateway import BudgetExceeded, LLMGateway, LLMResult, LLMUnavailable, build_gateway
from .providers import MockProvider, OpenAICompatibleProvider, ProviderError
from .redact import Redactor

__all__ = [
    "BudgetExceeded", "LLMGateway", "LLMResult", "LLMUnavailable", "build_gateway",
    "MockProvider", "OpenAICompatibleProvider", "ProviderError", "Redactor",
]
