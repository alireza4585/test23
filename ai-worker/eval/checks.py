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


_MONTHS = ("فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند|"
           "january|february|march|april|may|june|july|august|september|october|november|december")
_NOT_LETTER = r"(?![\u0600-\u06FFa-z])"
_EXEMPT = [
    re.compile(r"\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b"),
    re.compile(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b"),
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),
    re.compile(rf"\b\d{{1,2}}\s*(?:{_MONTHS}){_NOT_LETTER}(?:\s+\d{{4}}\b)?", re.I),
    re.compile(rf"(?:{_MONTHS}){_NOT_LETTER}\s+\d{{1,2}}\b(?:,?\s+\d{{4}}\b)?", re.I),
]
_LIST_MARKER = re.compile(r"^(\s*)\d{1,2}[.)\-–]\s", re.M)
_COUNT_KINDS = [
    (r"^counts\..*ticket", "(?:تیکت|خرابی|درخواست تعمیر)", r"(?:tickets?|faults?|work orders?)"),
    (r"^(?:counts\.rooms$|roomsNow\.)", "اتاق", r"rooms?"),
    (r"^counts\..*alert", "هشدار", r"alerts?"),
    (r"^counts\.lowStock", "(?:قلم|کالا)", r"(?:items?|products?)"),
    (r"^counts\..*insight", "(?:پیشنهاد|توصیه)", r"(?:insights?|recommendations?)"),
    (r"^windows\.", "روز", r"days?"),
]
_QUALIFIERS = [
    ("critical", re.compile(r"^(?:بحرانی|critical)")),
    ("high", re.compile(r"^(?:فوری|اولویت بالا|high)")),
    ("medium", re.compile(r"^(?:متوسط|medium)")),
    ("low", re.compile(r"^(?:کم‌اهمیت|اولویت پایین|low)")),
    ("overdue", re.compile(r"^(?:معوق|از sla گذشته|گذشته از sla|overdue|past sla)")),
]


def _without_exempt(s: str) -> str:
    """Dates, clock times and list numbering are not data claims."""
    for rx in _EXEMPT:
        s = rx.sub(" ", s)
    return _LIST_MARKER.sub(r"\1 ", s)


def _qualifier(text: str):
    return next((q for q, rx in _QUALIFIERS if rx.match(text)), None)


def _count_claim(following: str):
    t = following.lstrip().lower()
    for kind, fa, en in _COUNT_KINDS:
        m = re.match(rf"(?:تا\s+|عدد\s+|مورد\s+)?{fa}(?:\u200c?های|\u200c?ها|ی)?\s*", t)
        if m:
            return {"kind": kind, "qualifier": _qualifier(t[m.end():])}
        m = re.match(rf"((?:critical|high|medium|low|overdue|open|low-stock)\s+)?{en}\b", t)
        if m:
            return {"kind": kind, "qualifier": _qualifier(m.group(1)) if m.group(1) else None}
    return None


def numbers_in(text: str) -> list[dict]:
    s = _without_exempt(str(text or "").translate(_DIGITS))
    out = []
    for m in _NUM.finditer(s):
        if s[max(0, m.start() - 2):m.start()] == "[P":
            continue
        raw = m.group(0).replace(",", "")
        after = s[m.end():m.end() + 14].strip().lower()
        scale = next((v for w, v in _SCALE_WORDS.items() if after.startswith(w)), 1.0)
        percent = bool(re.match(r"(%|٪|درصد|percent)", after))
        claim = _count_claim(s[m.end():m.end() + 40]) if scale == 1.0 and not percent and "." not in raw else None
        out.append({"value": float(raw), "decimals": len(raw.split(".")[1]) if "." in raw else 0, "raw": m.group(0),
                    "scale": scale, "percent": percent, "claim": claim})
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


def numeric_paths(value, path: str = "", out: list | None = None) -> list[tuple[str, float]]:
    out = [] if out is None else out
    if isinstance(value, bool):
        return out
    if isinstance(value, (int, float)):
        out.append((path, float(value)))
    elif isinstance(value, list):
        for v in value:
            numeric_paths(v, path, out)
    elif isinstance(value, dict):
        for k, v in value.items():
            numeric_paths(v, f"{path}.{k}" if path else k, out)
    return out


def _states(n: dict, fact: float) -> bool:
    candidates = [abs(fact)]
    if n["percent"]:
        candidates.append(abs(fact) * 100)
    if n["scale"] != 1.0:
        candidates.append(abs(fact) / n["scale"])
    for v in candidates:
        if float(v).is_integer() and v < 1000 and n["decimals"] == 0:
            if n["value"] == v:
                return True
            continue
        if abs(v - n["value"]) <= max(0.5 * 10 ** (-n["decimals"]), v * 0.005):
            return True
    return False


def unsupported(answer: str, facts: list[float], data=None) -> list[str]:
    """Numbers in the answer not backed by the data. Mirrors ai.js:
    dates, times and list numbering are exempt; counts must equal a count of
    the same thing; percentages and scale words only when written out."""
    paths = numeric_paths(data) if data is not None else None
    bad = []
    for n in numbers_in(answer):
        if n["claim"] and paths is not None:
            kind = re.compile(n["claim"]["kind"], re.I)
            q = re.compile(n["claim"]["qualifier"], re.I) if n["claim"]["qualifier"] else None
            ok = any(kind.search(p) and (q is None or q.search(p)) and v == n["value"] for p, v in paths)
        else:
            ok = any(_states(n, f) for f in facts)
        if not ok:
            bad.append(n["raw"])
    return bad


def _matches(n: dict, fact: float, scales) -> bool:
    tolerance = 0.5 * 10 ** (-n["decimals"])
    for scale in scales:
        v = abs(fact * scale)
        if abs(v - n["value"]) <= max(tolerance, v * 0.005):
            return True
    return False


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
