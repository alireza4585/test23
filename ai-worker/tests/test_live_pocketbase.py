"""Against a local PocketBase (npm run test-server) with a scoped key:
    ZH_PB_TEST_URL, ZH_PB_TEST_HOTEL, ZH_PB_TEST_KEY_ID, ZH_PB_TEST_KEY_SECRET
Skipped when they are not set. Never point this at production."""

import os

import pytest

from worker.builtin_jobs import register_builtin
from worker.jobs import JobRunner
from worker.llm import LLMGateway, MockProvider
from worker.llm.gateway import PocketBaseBudget
from worker.pb_client import PocketBaseClient, PocketBaseError

ENV = {k: os.environ.get(k, "") for k in ("ZH_PB_TEST_URL", "ZH_PB_TEST_HOTEL", "ZH_PB_TEST_KEY_ID", "ZH_PB_TEST_KEY_SECRET")}
pytestmark = pytest.mark.skipif(not all(ENV.values()), reason="local PocketBase test server not configured")


@pytest.fixture
def pb():
    c = PocketBaseClient(ENV["ZH_PB_TEST_URL"], ENV["ZH_PB_TEST_KEY_ID"], ENV["ZH_PB_TEST_KEY_SECRET"])
    yield c
    c.close()


def test_ping_job_reads_the_summary_with_the_scoped_key(pb):
    runner = JobRunner(services={"pb": pb, "gateway": None, "hotel_ids": ()})
    register_builtin(runner)
    rec = runner.run_now("ping", ENV["ZH_PB_TEST_HOTEL"])
    assert rec.status == "done", rec.last_error
    assert rec.result["hotelId"] == ENV["ZH_PB_TEST_HOTEL"]


def test_gateway_usage_lands_in_the_hotels_budget(pb):
    hotel = ENV["ZH_PB_TEST_HOTEL"]
    before = pb.budget(hotel)
    g = LLMGateway([MockProvider(script=["OK"])], PocketBaseBudget(pb))
    r = g.complete(hotel, [{"role": "user", "content": "x" * 400}])
    after = pb.budget(hotel)
    assert after["used"] == before["used"] + r.tokens_in + r.tokens_out
    assert after["calls"] == before["calls"] + 1


def test_the_key_cannot_reach_another_hotel(pb):
    with pytest.raises(PocketBaseError) as e:
        pb.summary("not-my-hotel-000")
    assert e.value.status in (403, 404)
