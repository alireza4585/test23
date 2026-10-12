"""Removes personal data before text goes to an external LLM.

* Iranian mobile and landline numbers → [phone]; 10-digit national IDs → [id]
  (Persian and Arabic-Indic digits are normalised first).
* Known person names → [P1], [P2], … ; `restore()` puts them back in the
  answer shown to the (authorised) user.
Mirrors the rules in pocketbase/pb_hooks/lib/ai.js.
"""

from __future__ import annotations

import re

_FA = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_MOBILE = re.compile(r"(^|[^\d])(?:\+98|0098|0)?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)")
_LANDLINE = re.compile(r"(^|[^\d])0\d{2}[\s-]?\d{8}(?!\d)")
_NATIONAL_ID = re.compile(r"(^|[^\d])\d{3}-?\d{6}-?\d(?!\d)")
_CONTROL = re.compile("[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩]")
_TOKEN = re.compile(r"\[P\d+\]")


def redact_ids(text: str) -> str:
    s = text.translate(_FA)
    s = _MOBILE.sub(r"\1[phone]", s)
    s = _LANDLINE.sub(r"\1[phone]", s)
    return _NATIONAL_ID.sub(r"\1[id]", s)


def clean(text: str, limit: int = 4000) -> str:
    """Untrusted text → one plain line without control/bidi characters or markup."""
    s = _CONTROL.sub(" ", str(text or ""))
    s = re.sub(r"[<>`]", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:limit]


class Redactor:
    def __init__(self, names: list[str] | tuple[str, ...] = ()):
        self._names = sorted({n.strip() for n in names if len(n.strip()) >= 3}, key=len, reverse=True)
        self._tokens: dict[str, str] = {}
        self._back: dict[str, str] = {}

    def _token(self, name: str) -> str:
        if name not in self._tokens:
            token = f"[P{len(self._tokens) + 1}]"
            self._tokens[name] = token
            self._back[token] = name
        return self._tokens[name]

    def text(self, value: str) -> str:
        s = redact_ids(str(value or ""))
        for name in self._names:
            if name in s:
                s = s.replace(name, self._token(name))
        return s

    def restore(self, value: str) -> str:
        return _TOKEN.sub(lambda m: self._back.get(m.group(0), m.group(0)), value or "")
