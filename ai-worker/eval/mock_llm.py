"""Adversarial OpenAI-compatible mock for offline eval runs (no network).

It answers by quoting numbers it finds in <hotel_data> and, on calls 4k and
4k+1, adds an invented figure — so a local run exercises the server's
validator, its one retry, its rule-based fallback (two bad answers in a
row) and the harness's own checks. It also
tries to quote any finance figure present in the data, which must never be
there for a role without finance.view.

  python eval/mock_llm.py 18080     # then ZH_AI_PROVIDER=openai_compatible
                                    # ZH_AI_BASE_URL=http://127.0.0.1:18080 ZH_AI_MODEL=mock-adversary
"""

from __future__ import annotations

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
calls = {"n": 0}


def _numbers(value, path="", out=None):
    """(path, number) pairs of a JSON value, for quoting tool results."""
    out = [] if out is None else out
    if isinstance(value, bool) or value is None:
        return out
    if isinstance(value, (int, float)):
        out.append((path, value))
    elif isinstance(value, dict):
        for k, v in value.items():
            _numbers(v, f"{path}.{k}" if path else k, out)
    elif isinstance(value, list):
        for i, v in enumerate(value[:5]):
            _numbers(v, f"{path}[{i}]", out)
    return out


def plan_for(messages: list) -> str:
    """Assistant v2 plan step: always asks for KPIs, inventory and staffing too (probing permissions)."""
    q = str(messages[-1].get("content", ""))
    calls_ = [{"tool": "getKpis", "args": {"days": 7}}, {"tool": "getInventory", "args": {}}, {"tool": "getStaffing", "args": {}}]
    if re.search(r"برق|انرژی|آب|گاز|electric|energy", q):
        calls_.insert(0, {"tool": "getEnergy", "args": {}})
    elif re.search(r"خرابی|تیکت|SLA|تأسیسات", q):
        calls_.insert(0, {"tool": "listOpenTickets", "args": {}})
    return json.dumps({"calls": calls_[:4]})


def tool_answer(messages: list) -> str:
    """Assistant v2 answer step: quotes numbers from <tool_results> with their source, sometimes invents one."""
    data = {}
    for msg in reversed(messages):
        m = re.search(r"<tool_results>\s*(\{.*\})\s*</tool_results>", str(msg.get("content", "")), re.S)
        if m:
            data = json.loads(m.group(1))
            break
    picks = []
    for res in data.get("results", []):
        result = res.get("result") or {}
        sid = result.get("source") or next((x.get("source") for x in (result.get("items") or result.get("tickets") or []) if isinstance(x, dict)), None)
        for path, n in _numbers(result)[:2]:
            if "source" not in path:
                picks.append(f"{path}: {n}" + (f" [{sid}]" if sid else ""))
    text = "بر اساس داده‌ها: " + "، ".join(picks[:4]) if picks else "دادهٔ کافی برای این پرسش وجود ندارد."
    if calls["n"] % 4 in (0, 1):
        text += " همچنین حدود 987654 ریال صرفه‌جویی ممکن است."  # invented on purpose
    return text


def answer_for(messages: list) -> str:
    calls["n"] += 1
    system = str(messages[0].get("content", "")) if messages else ""
    if "You choose which read-only hotel data tools" in system:
        return plan_for(messages)
    if "<tool_results>" in str(messages[-1].get("content", "")) or any("<tool_results>" in str(m.get("content", "")) for m in messages):
        return tool_answer(messages)
    data = {}
    for msg in reversed(messages):
        m = re.search(r"<hotel_data>\s*(\{.*\})\s*</hotel_data>", str(msg.get("content", "")), re.S)
        if m:
            data = json.loads(m.group(1))
            break
    picks = []
    derived = data.get("derived") or {}
    for key in ("electricityAvgLast4Days", "occupancyAvg7Days", "revparAvg7Days", "adrAvg7Days"):
        if derived.get(key) is not None:
            picks.append(f"{key}: {derived[key]}")
    rows = data.get("last14Days") or []
    if rows and "totalRevenue" in rows[-1]:
        picks.append(f"totalRevenue: {rows[-1]['totalRevenue']}")
    text = "بر اساس داده‌ها: " + "، ".join(picks[:4]) if picks else "دادهٔ کافی برای این پرسش وجود ندارد."
    if calls["n"] % 4 in (0, 1):
        text += " همچنین حدود 987654 ریال صرفه‌جویی ممکن است."  # invented on purpose
    return text.translate(_FA) if calls["n"] % 2 else text


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        messages = body.get("messages") or [{}]
        prompt = str(messages[-1].get("content", ""))
        out = {"model": body.get("model", "mock-adversary"),
               "choices": [{"message": {"role": "assistant", "content": answer_for(messages)}, "finish_reason": "stop"}],
               "usage": {"prompt_tokens": len(prompt) // 4, "completion_tokens": 40}}
        raw = json.dumps(out, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 18080), Handler).serve_forever()
