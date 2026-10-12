"""Zarin Hooshmand AI worker: jobs and the LLM gateway, outside PocketBase.

PocketBase stays the source of truth and the place where permissions are
enforced; the worker reads and writes only through the signed /v1 API.
"""

__version__ = "0.1.0"
