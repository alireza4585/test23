import hashlib
import hmac
import json

import httpx
import pytest

from worker.pb_client import PocketBaseClient, PocketBaseError, sign


def test_signature_format_matches_pocketbase_v2():
    expected = hmac.new(b"s3", b"1700000000.abcdefabcdefabcd.{\"a\":1}", hashlib.sha256).hexdigest()
    assert sign("s3", 1700000000, "abcdefabcdefabcd", '{"a":1}') == expected


def test_requests_carry_key_nonce_and_a_valid_signature():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"remaining": 5})

    pb = PocketBaseClient("http://pb.test", "zk_test", "secret-x", transport=httpx.MockTransport(handler), clock=lambda: 1700000000)
    pb.report_usage("hotel1", 10, 2)
    pb.report_usage("hotel1", 10, 2)
    r = seen[0]
    assert r.url.path == "/v1/hotels/hotel1/ai/usage"
    assert r.headers["x-zarin-key-id"] == "zk_test"
    raw = r.content.decode()
    assert json.loads(raw) == {"tokensIn": 10, "tokensOut": 2}
    assert r.headers["x-zarin-signature"] == sign("secret-x", 1700000000, r.headers["x-zarin-nonce"], raw)
    assert seen[0].headers["x-zarin-nonce"] != seen[1].headers["x-zarin-nonce"]  # fresh nonce per request


def test_errors_carry_the_pocketbase_code_and_retry_hint():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/summary"):
            return httpx.Response(403, json={"status": 403, "message": "Key_not_allowed_for_hotel.",
                                             "data": {"code": {"code": "key_not_allowed_for_hotel"}}})
        return httpx.Response(503, json={})

    pb = PocketBaseClient("http://pb.test", "k", "s", transport=httpx.MockTransport(handler))
    with pytest.raises(PocketBaseError) as e:
        pb.summary("other")
    assert e.value.code == "key_not_allowed_for_hotel" and not e.value.retryable
    with pytest.raises(PocketBaseError) as e:
        pb.budget("h")
    assert e.value.retryable
