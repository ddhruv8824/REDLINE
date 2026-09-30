"""
app/services/text.py
───────────────────────
Small text helpers shared by validation and ATS scoring: term matching,
number extraction, word counts, and flattening resume / profile JSON to text.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")
# Characters that count as part of a term, so "C" doesn't match inside "C++"
# and "Go" doesn't match inside "Google".
_TERM_CHARS = r"a-z0-9+#"


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _squash(text: str) -> str:
    """'Node.js' → 'nodejs', 'CI/CD' → 'cicd' — for spelling-variant matches."""
    return re.sub(r"[\s.\-_/]", "", normalize(text))


def contains_term(text: str, term: str) -> bool:
    """True if ``term`` appears in ``text`` as a whole term (case-insensitive)."""
    t = normalize(term)
    if not t:
        return False
    hay = normalize(text)
    pattern = rf"(?<![{_TERM_CHARS}]){re.escape(t)}(?![{_TERM_CHARS}])"
    if re.search(pattern, hay):
        return True
    # Spelling variants ("NodeJS" vs "Node.js") only for longer terms, where a
    # squashed substring match is unlikely to be a false positive.
    sq = _squash(t)
    return len(sq) >= 5 and sq in _squash(hay)


def numbers_in(text: str) -> set[str]:
    """Numbers in ``text``, normalised ('1,200' → '1200', '40.0' stays '40.0')."""
    return {m.replace(",", "") for m in _NUMBER_RE.findall(text or "")}


def word_count(text: str) -> int:
    return len((text or "").split())


def flatten(value: Any) -> Iterable[str]:
    """Yield every string inside a nested dict / list structure."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from flatten(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from flatten(v)
