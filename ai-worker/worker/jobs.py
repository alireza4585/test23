"""Idempotent jobs with retry and exponential backoff, kept in SQLite.

* A job is identified by an idempotency key (default: hash of name, hotel and
  payload). Submitting the same key again never creates a second job; a job
  that already succeeded is not run again.
* Failures are retried with exponential backoff and jitter up to
  `max_attempts`; `PermanentError` stops at once. Exhausted jobs are "dead"
  and keep their last error for inspection.
* Outputs written to PocketBase must be idempotent too (insights are upserted
  by id), so a retry after a crash never duplicates anything.
"""

from __future__ import annotations

import hashlib
import json
import random
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable


class PermanentError(Exception):
    """The job cannot succeed by retrying (bad input, missing permission…)."""


@dataclass
class JobSpec:
    name: str
    fn: Callable[["JobContext", dict], Any]
    max_attempts: int = 5
    base_delay: float = 2.0
    max_delay: float = 300.0


@dataclass
class JobContext:
    hotel_id: str
    key: str
    attempt: int
    services: dict


@dataclass
class JobRecord:
    key: str
    name: str
    hotel_id: str
    payload: dict
    status: str  # queued | running | done | dead
    attempts: int
    next_at: float
    last_error: str
    result: Any


def default_key(name: str, hotel_id: str, payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(f"{name}|{hotel_id}|{canonical}".encode()).hexdigest()[:32]


class JobRunner:
    def __init__(self, db_path: str = ":memory:", *, services: dict | None = None,
                 clock: Callable[[], float] = time.time, rng: random.Random | None = None):
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._lock = threading.Lock()
        self._clock = clock
        self._rng = rng or random.Random()
        self._specs: dict[str, JobSpec] = {}
        self.services = services or {}
        with self._lock:
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, name TEXT NOT NULL, hotel TEXT NOT NULL,"
                " payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,"
                " next_at REAL NOT NULL, last_error TEXT NOT NULL DEFAULT '', result TEXT,"
                " created REAL NOT NULL, updated REAL NOT NULL)"
            )
            self._db.execute("CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, next_at)")
            # Jobs left "running" by a crash are picked up again.
            self._db.execute("UPDATE jobs SET status = 'queued' WHERE status = 'running'")
            self._db.commit()

    # ------------------------------------------------------------ registry
    def register(self, name: str, fn: Callable[[JobContext, dict], Any], **opts) -> None:
        self._specs[name] = JobSpec(name=name, fn=fn, **opts)

    @property
    def names(self) -> list[str]:
        return sorted(self._specs)

    # ---------------------------------------------------------- submission
    def submit(self, name: str, hotel_id: str, payload: dict | None = None, key: str | None = None) -> str:
        if name not in self._specs:
            raise KeyError(f"unknown job {name}")
        payload = payload or {}
        key = key or default_key(name, hotel_id, payload)
        now = self._clock()
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO jobs (key, name, hotel, payload, status, next_at, created, updated)"
                " VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)",
                (key, name, hotel_id, json.dumps(payload, ensure_ascii=False), now, now, now),
            )
            self._db.commit()
        return key

    def get(self, key: str) -> JobRecord | None:
        with self._lock:
            row = self._db.execute(
                "SELECT key, name, hotel, payload, status, attempts, next_at, last_error, result FROM jobs WHERE key = ?",
                (key,),
            ).fetchone()
        if not row:
            return None
        return JobRecord(row[0], row[1], row[2], json.loads(row[3]), row[4], row[5], row[6], row[7],
                         json.loads(row[8]) if row[8] else None)

    # ------------------------------------------------------------- running
    def backoff(self, attempt: int, spec: JobSpec) -> float:
        delay = min(spec.max_delay, spec.base_delay * (2 ** (attempt - 1)))
        return delay * (0.5 + self._rng.random() / 2)  # jitter: 50–100 %

    def _claim(self, now: float, key: str | None) -> tuple | None:
        with self._lock:
            if key:
                row = self._db.execute(
                    "SELECT key, name, hotel, payload, attempts FROM jobs WHERE key = ? AND status = 'queued' AND next_at <= ?",
                    (key, now),
                ).fetchone()
            else:
                row = self._db.execute(
                    "SELECT key, name, hotel, payload, attempts FROM jobs WHERE status = 'queued' AND next_at <= ?"
                    " ORDER BY next_at LIMIT 1",
                    (now,),
                ).fetchone()
            if not row:
                return None
            self._db.execute("UPDATE jobs SET status = 'running', updated = ? WHERE key = ?", (now, row[0]))
            self._db.commit()
            return row

    def _run_one(self, row: tuple) -> JobRecord:
        key, name, hotel, payload, attempts = row
        spec = self._specs.get(name)
        attempt = attempts + 1
        now = self._clock()
        if spec is None:
            self._finish(key, "dead", attempt, now, f"unknown job {name}", None)
            return self.get(key)  # type: ignore[return-value]
        try:
            result = spec.fn(JobContext(hotel_id=hotel, key=key, attempt=attempt, services=self.services), json.loads(payload))
        except PermanentError as err:
            self._finish(key, "dead", attempt, now, f"permanent: {err}"[:500], None)
        except Exception as err:  # noqa: BLE001 — every failure is recorded and retried
            if attempt >= spec.max_attempts:
                self._finish(key, "dead", attempt, now, f"{type(err).__name__}: {err}"[:500], None)
            else:
                self._finish(key, "queued", attempt, now + self.backoff(attempt, spec), f"{type(err).__name__}: {err}"[:500], None)
        else:
            self._finish(key, "done", attempt, now, "", result)
        return self.get(key)  # type: ignore[return-value]

    def _finish(self, key: str, status: str, attempts: int, next_at: float, error: str, result: Any) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE jobs SET status = ?, attempts = ?, next_at = ?, last_error = ?, result = ?, updated = ? WHERE key = ?",
                (status, attempts, next_at, error, json.dumps(result, ensure_ascii=False) if result is not None else None,
                 self._clock(), key),
            )
            self._db.commit()

    def run_due(self, limit: int = 50) -> int:
        """Runs queued jobs that are due; returns how many ran."""
        ran = 0
        while ran < limit:
            row = self._claim(self._clock(), None)
            if not row:
                break
            self._run_one(row)
            ran += 1
        return ran

    def run_now(self, name: str, hotel_id: str, payload: dict | None = None, key: str | None = None) -> JobRecord:
        """Submits and runs one attempt now (CLI and tests); idempotent."""
        key = self.submit(name, hotel_id, payload, key)
        row = self._claim(float("inf"), key)
        return self._run_one(row) if row else self.get(key)  # type: ignore[return-value]
