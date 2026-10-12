import json
import secrets
import time

import pytest
from fastapi.testclient import TestClient

from worker.api import create_app
from worker.builtin_jobs import register_builtin
from worker.config import Settings
from worker.jobs import JobRunner
from worker.llm import LLMGateway, MockProvider
from worker.llm.gateway import MemoryBudget
from worker.pb_client import sign

SECRET = "trigger-secret-for-tests"


class FakePb:
    def summary(self, hotel_id, day=None):
        return {"hotelId": hotel_id, "day": "2026-10-11", "alerts": [{"id": "a"}]}


@pytest.fixture
def client(tmp_path):
    settings = Settings(trigger_secret=SECRET, db_path=str(tmp_path / "w.db"), hotel_ids=("hotel1",))
    gw = LLMGateway([MockProvider(script=["OK"])], MemoryBudget())
    runner = JobRunner(settings.db_path, services={"pb": FakePb(), "gateway": gw, "hotel_ids": settings.hotel_ids})
    register_builtin(runner)
    with TestClient(create_app(settings, runner, start_loop=False)) as c:
        yield c


def post(client, path, body, secret=SECRET, nonce=None, ts=None):
    raw = json.dumps(body)
    ts = ts or int(time.time())
    nonce = nonce or secrets.token_hex(16)
    return client.post(path, content=raw, headers={
        "content-type": "application/json", "x-zarin-timestamp": str(ts), "x-zarin-nonce": nonce,
        "x-zarin-signature": sign(secret, ts, nonce, raw)})


def test_health_reports_jobs_and_missing_configuration_names_only(client):
    j = client.get("/health").json()
    assert j["ok"] and "ping" in j["jobs"] and "llm_selftest" in j["jobs"]
    assert j["missingConfig"] == ["ZH_PB_URL", "ZH_WORKER_KEY_ID", "ZH_WORKER_SECRET"]


def test_signed_trigger_runs_a_job(client):
    r = post(client, "/jobs/ping", {"hotelId": "hotel1", "wait": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done" and r.json()["result"] == {"hotelId": "hotel1", "day": "2026-10-11", "openAlerts": 1}
    r = post(client, "/jobs/llm_selftest", {"hotelId": "hotel1", "wait": True})
    assert r.json()["result"]["provider"] == "mock"


def test_jobs_for_hotels_the_worker_does_not_serve_fail_permanently(client):
    r = post(client, "/jobs/ping", {"hotelId": "hotel2", "wait": True})
    assert r.json()["status"] == "dead"


def test_bad_signature_stale_timestamp_and_replay_are_rejected(client):
    assert post(client, "/jobs/ping", {"hotelId": "hotel1"}, secret="wrong").status_code == 401
    assert post(client, "/jobs/ping", {"hotelId": "hotel1"}, ts=int(time.time()) - 3600).status_code == 401
    nonce = secrets.token_hex(16)
    assert post(client, "/jobs/ping", {"hotelId": "hotel1"}, nonce=nonce).status_code == 200
    r = post(client, "/jobs/ping", {"hotelId": "hotel1"}, nonce=nonce)
    assert r.status_code == 401 and r.json()["detail"] == "replayed_request"


def test_unknown_job_and_missing_hotel(client):
    assert post(client, "/jobs/nope", {"hotelId": "hotel1"}).status_code == 404
    assert post(client, "/jobs/ping", {}).status_code == 400
