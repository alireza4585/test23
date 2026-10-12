"""Wiring: settings → PocketBase client, budget, gateway, runner, app."""

from __future__ import annotations

from .builtin_jobs import register_builtin
from .config import Settings
from .jobs import JobRunner
from .llm.gateway import PocketBaseBudget, build_gateway
from .pb_client import PocketBaseClient


def build_runner(settings: Settings) -> JobRunner:
    pb = PocketBaseClient(settings.pb_url, settings.key_id, settings.secret) if not settings.missing() else None
    gateway = build_gateway(settings.llm, PocketBaseBudget(pb)) if pb else None
    runner = JobRunner(settings.db_path, services={"pb": pb, "gateway": gateway, "hotel_ids": settings.hotel_ids})
    register_builtin(runner)
    return runner


def create_default_app():
    from .api import create_app

    settings = Settings.from_env()
    return create_app(settings, build_runner(settings))
