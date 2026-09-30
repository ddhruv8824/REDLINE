"""
app/services/ats.py
───────────────────
Deterministic ATS-style keyword score: the share of the JD's keywords that appear in
the text an applicant-tracking system reads from the rendered resume.

- Must-have skills weigh 3, nice-to-have skills and other keywords weigh 1.
- A keyword counts if the term *or any of its aliases* appears ("LLM" counts for
  "Generative AI" when the JD analysis lists it as an alias), singular or plural.

Mirrored on the frontend in ``frontend/src/lib/tailor/ats.ts`` — keep them in sync.
"""

from __future__ import annotations

from .text import contains_term, normalize

GROUPS = (("must_have_skills", 3), ("nice_to_have_skills", 1), ("keywords", 1))


def resume_text(resume: dict) -> str:
    """Everything that appears on the rendered PDF."""
    parts: list[str] = [(resume.get("summary") or {}).get("text", "")]
    for exp in resume.get("experience", []):
        parts += [exp.get("title", ""), exp.get("company", "")]
        parts += [b["text"] for b in exp.get("bullets", [])]
    for proj in resume.get("projects", []):
        parts.append(proj.get("name", ""))
        parts += proj.get("tech") or []
        parts += [b["text"] for b in proj.get("bullets", [])]
    parts += resume.get("skills") or []
    for edu in resume.get("education", []):
        parts += [edu.get("degree", ""), edu.get("field_of_study", "")]
    parts += resume.get("certifications") or []
    return "\n".join(p for p in parts if p)


def _variants(term: str) -> list[str]:
    """The term plus its singular/plural twin (pipelines ↔ pipeline)."""
    t = term.strip()
    out = [t]
    if len(t) > 3 and t.lower().endswith("s") and not t.lower().endswith("ss"):
        out.append(t[:-1])
    elif len(t) > 2 and t[-1].isalpha():
        out.append(t + "s")
    return out


def _aliases(jd_analysis: dict) -> dict[str, list[str]]:
    table: dict[str, list[str]] = {}
    for entry in jd_analysis.get("keyword_aliases") or []:
        if isinstance(entry, dict) and isinstance(entry.get("term"), str):
            table[normalize(entry["term"])] = [a for a in entry.get("aliases") or [] if isinstance(a, str) and a.strip()]
    return table


def keyword_found(text: str, term: str, aliases: list[str]) -> bool:
    return any(contains_term(text, v) for form in [term, *aliases] for v in _variants(form))


def ats_score(resume: dict, jd_analysis: dict) -> dict:
    text = resume_text(resume)
    aliases = _aliases(jd_analysis)
    seen: set[str] = set()
    total = hit = 0
    matched: list[str] = []
    missing: list[str] = []
    groups: dict[str, dict[str, int]] = {}
    for key, weight in GROUPS:
        g = groups.setdefault(key, {"matched": 0, "total": 0})
        for term in jd_analysis.get(key) or []:
            if not isinstance(term, str) or not term.strip() or normalize(term) in seen:
                continue
            seen.add(normalize(term))
            total += weight
            g["total"] += 1
            if keyword_found(text, term, aliases.get(normalize(term), [])):
                hit += weight
                g["matched"] += 1
                matched.append(term)
            else:
                missing.append(term)
    score = round(100 * hit / total) if total else 0
    return {"score": score, "matched": matched, "missing": missing, "groups": groups}
