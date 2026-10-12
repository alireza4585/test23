import random

import pytest

from worker.jobs import JobRunner, PermanentError


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def runner(clock=None, path=":memory:"):
    return JobRunner(path, clock=clock or Clock(), rng=random.Random(1))


def test_same_key_is_one_job_and_a_done_job_is_not_run_again():
    calls = []
    r = runner()
    r.register("count", lambda ctx, p: calls.append(p) or {"n": len(calls)})
    a = r.run_now("count", "h1", {"day": "2026-10-01"})
    b = r.run_now("count", "h1", {"day": "2026-10-01"})
    assert a.key == b.key and b.status == "done" and calls == [{"day": "2026-10-01"}]
    assert r.run_now("count", "h1", {"day": "2026-10-02"}).key != a.key


def test_failures_retry_with_exponential_backoff_then_succeed():
    clock = Clock()
    r = runner(clock)
    attempts = []

    def flaky(ctx, p):
        attempts.append(ctx.attempt)
        if ctx.attempt < 3:
            raise ConnectionError("pb down")
        return "ok"

    r.register("flaky", flaky, max_attempts=5, base_delay=2, max_delay=60)
    key = r.submit("flaky", "h1")
    assert r.run_due() == 1
    rec = r.get(key)
    assert rec.status == "queued" and rec.attempts == 1 and "pb down" in rec.last_error
    first_delay = rec.next_at - clock.t
    assert 1.0 <= first_delay <= 2.0  # base 2 s with 50–100 % jitter
    assert r.run_due() == 0  # not due yet
    clock.t = rec.next_at
    r.run_due()
    rec = r.get(key)
    second_delay = rec.next_at - clock.t
    assert 2.0 <= second_delay <= 4.0
    clock.t = rec.next_at
    r.run_due()
    assert r.get(key).status == "done" and attempts == [1, 2, 3]


def test_jobs_die_after_max_attempts_or_on_a_permanent_error():
    clock = Clock()
    r = runner(clock)
    r.register("always", lambda ctx, p: (_ for _ in ()).throw(TimeoutError("slow")), max_attempts=2, base_delay=1)
    r.register("bad", lambda ctx, p: (_ for _ in ()).throw(PermanentError("missing permission")))
    k = r.submit("always", "h1")
    r.run_due()
    clock.t += 10
    r.run_due()
    assert r.get(k).status == "dead" and r.get(k).attempts == 2
    rec = r.run_now("bad", "h1")
    assert rec.status == "dead" and rec.attempts == 1 and rec.last_error.startswith("permanent")


def test_a_job_interrupted_by_a_crash_is_picked_up_again(tmp_path):
    db = str(tmp_path / "w.db")
    r1 = runner(path=db)
    r1.register("j", lambda ctx, p: "ok")
    key = r1.submit("j", "h1")
    r1._claim(float("inf"), key)  # "running" when the process dies
    assert r1.get(key).status == "running"
    r2 = runner(path=db)
    r2.register("j", lambda ctx, p: "ok")
    assert r2.get(key).status == "queued"
    r2.run_due()
    assert r2.get(key).status == "done"


def test_unknown_jobs_are_rejected():
    with pytest.raises(KeyError):
        runner().submit("nope", "h1")
