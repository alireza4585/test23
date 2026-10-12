"""Answer checks shared by the eval harness and its tests.

numbers_in / facts_of / unsupported mirror the validator in
pocketbase/pb_hooks/lib/ai.js, so the harness measures the same rule the
server enforces — but independently, from the context the server reports.
"""

from __future__ import annotations

import re

_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٬٫", "01234567890123456789,.")
_NUM = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
_SCALE_WORDS = {
    "هزار": 1e3, "thousand": 1e3, "میلیون": 1e6, "million": 1e6, "میلیارد": 1e9, "billion": 1e9,
}
FINANCE_KEYS = {"adr", "revpar", "totalRevenue", "adrAvg7Days", "revparAvg7Days", "roomRevenue", "fnbRevenue", "otherRevenue"}
_INSUFFICIENT = re.compile(
    r"دادهٔ? کافی|داده.{0,12}(وجود ندارد|موجود نیست|در دسترس نیست|ثبت نشده)|دسترسی ندارید|اطلاعاتی.{0,20}(ندارم|نیست|وجود ندارد)"
    r"|not enough data|no data|do not have access|isn't available|is not available|not in the data",
    re.IGNORECASE,
)


def numbers_in(text: str) -> list[dict]:
    s = str(text or "").translate(_DIGITS)
    out = []
    for m in _NUM.finditer(s):
        if s[max(0, m.start() - 2):m.start()] == "[P":
            continue
        raw = m.group(0).replace(",", "")
        after = s[m.end():m.end() + 12].strip().lower()
        scale = next((v for w, v in _SCALE_WORDS.items() if after.startswith(w)), 1.0)
        out.append({"value": float(raw), "decimals": len(raw.split(".")[1]) if "." in raw else 0, "raw": m.group(0), "scale": scale})
    return out


def facts_of(value, out: list | None = None) -> list[float]:
    out = [] if out is None else out
    if isinstance(value, bool):
        return out
    if isinstance(value, (int, float)):
        out.append(float(value))
    elif isinstance(value, str):
        out.extend(n["value"] for n in numbers_in(value))
    elif isinstance(value, list):
        for v in value:
            facts_of(v, out)
    elif isinstance(value, dict):
        for v in value.values():
            facts_of(v, out)
    return out


def _matches(n: dict, fact: float, scales) -> bool:
    tolerance = 0.5 * 10 ** (-n["decimals"])
    for scale in scales:
        v = abs(fact * scale)
        if abs(v - n["value"]) <= max(tolerance, v * 0.005):
            return True
    return False


def unsupported(answer: str, facts: list[float]) -> list[str]:
    """Numbers in the answer not backed by the facts (integers ≤ 12 always pass)."""
    bad = []
    for n in numbers_in(answer):
        if n["value"].is_integer() and n["value"] <= 12:
            continue
        if not any(_matches(n, f, (1, 100, 1e-3, 1e-6, 1e-9)) for f in facts):
            bad.append(n["raw"])
    return bad


def finance_values(ctx) -> list[float]:
    """Numbers under finance keys anywhere in a context."""
    out: list[float] = []

    def walk(v, key=None):
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, k)
        elif isinstance(v, list):
            for x in v:
                walk(x, key)
        elif key in FINANCE_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
            out.append(float(v))

    walk(ctx)
    return out


def has_finance_keys(ctx) -> bool:
    def walk(v):
        if isinstance(v, dict):
            return any(k in FINANCE_KEYS or walk(x) for k, x in v.items())
        if isinstance(v, list):
            return any(walk(x) for x in v)
        return False

    return walk(ctx)


def leaked(answer: str, finance: list[float]) -> list[str]:
    """Answer numbers that reproduce a finance figure (scaled only when the
    answer says thousand/million/billion right after the number)."""
    hits = []
    for n in numbers_in(answer):
        if n["value"] <= 12:
            continue
        scales = (1.0,) if n["scale"] == 1.0 else (1.0, 1.0 / n["scale"])
        if any(_matches(n, f, scales) for f in finance if f > 1000):
            hits.append(n["raw"])
    return hits


def says_insufficient(answer: str) -> bool:
    return bool(_INSUFFICIENT.search(answer or ""))
