import json

import httpx
import pytest

from worker.config import LLMSettings
from worker.llm import BudgetExceeded, LLMGateway, LLMUnavailable, MockProvider, OpenAICompatibleProvider, ProviderError
from worker.llm.gateway import MemoryBudget, build_gateway
from worker.llm.providers import chat_url


def gateway(providers, budget=None, tmp_path=None, **kw):
    return LLMGateway(providers, budget or MemoryBudget(), cost_log_path=str(tmp_path / "cost.jsonl") if tmp_path else None, **kw)


def test_redacts_before_sending_and_restores_names_in_the_answer(tmp_path):
    p = MockProvider(script=["[P1] باید تماس بگیرد."])
    r = gateway([p], tmp_path=tmp_path).complete(
        "h1", [{"role": "user", "content": "مریم احمدی با 09121234567 تماس گرفت"}], names=["مریم احمدی"])
    sent = p.requests[0]["messages"][0]["content"]
    assert "مریم" not in sent and "0912" not in sent and "[phone]" in sent
    assert r.text == "مریم احمدی باید تماس بگیرد."


def test_falls_back_to_the_next_provider_and_logs_cost_without_content(tmp_path):
    primary = MockProvider(name="primary", script=[ProviderError("primary: timeout")])
    fallback = MockProvider(name="fallback", model="small-model", script=["OK"])
    budget = MemoryBudget()
    g = gateway([primary, fallback], budget, tmp_path, price_in_per_mtok=0.4, price_out_per_mtok=1.6)
    r = g.complete("h1", [{"role": "user", "content": "x" * 4000}], purpose="test")
    assert r.provider == "fallback" and r.model == "small-model"
    assert r.cost_micros == round(r.tokens_in * 0.4 + r.tokens_out * 1.6)
    assert budget.used["h1"] == r.tokens_in + r.tokens_out
    lines = [json.loads(l) for l in (tmp_path / "cost.jsonl").read_text().splitlines()]
    assert [l["status"] for l in lines] == ["error", "ok"]
    assert all("x" * 20 not in json.dumps(l) for l in lines)  # no prompt text in the log


def test_no_provider_answering_raises_unavailable():
    g = gateway([MockProvider(script=[ProviderError("down")])])
    with pytest.raises(LLMUnavailable):
        g.complete("h1", [{"role": "user", "content": "hi"}])


def test_spent_budget_blocks_the_call():
    p = MockProvider()
    budget = MemoryBudget(limit=10)
    budget.record("h1", 8, 5)
    with pytest.raises(BudgetExceeded):
        gateway([p], budget).complete("h1", [{"role": "user", "content": "hi"}])
    assert p.requests == []
    gateway([p], budget).complete("h2", [{"role": "user", "content": "hi"}])  # other hotels unaffected


def test_max_tokens_is_capped_by_configuration():
    p = MockProvider()
    gateway([p], max_tokens=300).complete("h1", [{"role": "user", "content": "hi"}], max_tokens=5000)
    assert p.requests[0]["max_tokens"] == 300


def test_openai_compatible_provider_over_http():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.headers.get("authorization") != "Bearer k":
            return httpx.Response(401)
        body = json.loads(request.content)
        if body["model"] == "broken":
            return httpx.Response(500)
        if body["model"] == "bad":
            return httpx.Response(400)
        return httpx.Response(200, json={"model": "m1", "choices": [{"message": {"content": " سلام "}, "finish_reason": "length"}],
                                         "usage": {"prompt_tokens": 12, "completion_tokens": 3}})

    t = httpx.MockTransport(handler)
    c = OpenAICompatibleProvider("https://ai.example/api/v1", "m1", "k", transport=t).complete(
        [{"role": "user", "content": "hi"}], max_tokens=10, temperature=0.2, timeout=5)
    assert (c.text, c.tokens_in, c.tokens_out, c.finish_reason) == ("سلام", 12, 3, "length")
    assert str(seen[0].url) == "https://ai.example/api/v1/chat/completions"
    with pytest.raises(ProviderError) as e:
        OpenAICompatibleProvider("https://ai.example", "broken", "k", transport=t).complete([], max_tokens=1, temperature=0, timeout=5)
    assert e.value.retryable
    with pytest.raises(ProviderError) as e:
        OpenAICompatibleProvider("https://ai.example", "bad", "k", transport=t).complete([], max_tokens=1, temperature=0, timeout=5)
    assert not e.value.retryable


def test_timeouts_become_provider_errors():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ProviderError, match="timeout"):
        OpenAICompatibleProvider("https://ai.example", "m", transport=httpx.MockTransport(handler)).complete(
            [], max_tokens=1, temperature=0, timeout=1)


def test_chat_url_accepts_bases_with_or_without_version():
    assert chat_url("https://x/api/v1") == "https://x/api/v1/chat/completions"
    assert chat_url("http://localhost:11434") == "http://localhost:11434/v1/chat/completions"


def test_gateway_is_built_from_configuration_only():
    assert build_gateway(LLMSettings(provider="openai_compatible"), MemoryBudget()) is None  # nothing configured
    g = build_gateway(LLMSettings(base_url="https://ai.example/v1", model="mini", fallback_model="tiny"), MemoryBudget())
    assert [(p.name, p.model) for p in g.providers] == [("primary", "mini"), ("fallback", "tiny")]
    assert build_gateway(LLMSettings(provider="mock"), MemoryBudget()).providers[0].name == "mock"
