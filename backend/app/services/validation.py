"""
app/services/validation.py
─────────────────────────────
Review checks for tailor changes. Nothing here blocks an honest-looking edit:
the candidate reviews every change, so rule findings are attached to the change
as ``warnings`` (shown as flags on its card) and the change is still applied.

Flagged (applied, with a warning):
    • a number in new text that isn't in the master profile
    • a hard skill (tool / language / platform) the master profile doesn't back
    • bullets over 30 words, summaries over 90 words
    • more than one added / removed bullet per item vs the original resume

Skipped (can't be applied, returned in ``rejected`` with a ``rejection_reason``):
    • unknown operations, items or bullets; two edits to the same bullet
    • edits aimed at company, title, dates, education, certifications or contact
    • empty text, removing an item's only bullet
"""

from __future__ import annotations

import re

from .patch import BULLET_OPS, apply_change, find_item
from .text import contains_term, flatten, normalize, numbers_in, word_count

MAX_BULLET_WORDS = 30
MAX_SUMMARY_WORDS = 90

# Keys that must never appear on a change — they would edit protected facts.
PROTECTED_KEYS = (
    "company", "title", "start_date", "end_date", "dates", "location",
    "name", "project_name", "institution", "degree", "field_of_study", "gpa",
    "contact", "email", "phone", "education",
)
_PROTECTED_PREFIXES = ("edu", "contact", "cert")

ALL_OPS = BULLET_OPS + ("rewrite_summary", "update_skills")


class Rejected(Exception):
    pass


# ── master-profile evidence ────────────────────────────────────────────────────

def _profile_item(master: dict, item_id: str) -> dict | None:
    for section in ("jobs", "projects"):
        for item in master.get(section, []):
            if item.get("id") == item_id:
                return item
    return None


def _item_evidence(master: dict, item_id: str) -> str:
    """Text that backs skills for one job / project."""
    parts = list(master.get("confirmed_skills") or [])
    item = _profile_item(master, item_id)
    if item:
        parts += item.get("tools") or []
        parts += item.get("tech") or []
        parts += item.get("bullets") or []
        parts.append(item.get("notes") or "")
    return "\n".join(parts)


def _global_evidence(master: dict) -> str:
    """Text that backs skills anywhere on the resume (summary, skills list)."""
    parts = list(master.get("confirmed_skills") or [])
    for section in ("jobs", "projects"):
        for item in master.get(section, []):
            parts += item.get("tools") or []
            parts += item.get("tech") or []
            parts += item.get("bullets") or []
            parts.append(item.get("notes") or "")
    parts += master.get("certifications") or []
    parts.append(master.get("summary") or "")
    parts.append(master.get("notes") or "")
    return "\n".join(parts)


def _jd_terms(jd_analysis: dict, *keys: str) -> list[str]:
    terms: list[str] = []
    for key in keys:
        terms += [t for t in jd_analysis.get(key) or [] if isinstance(t, str) and t.strip()]
    return terms


# ── individual checks ──────────────────────────────────────────────────────────

def _check_numbers(after: str, profile_numbers: set[str]) -> list[str]:
    invented = sorted(numbers_in(after) - profile_numbers)
    if invented:
        return [
            f"uses the number{'s' if len(invented) > 1 else ''} {', '.join(invented)}, "
            "which isn't in your master profile"
        ]
    return []


def is_hard_skill(term: str, *, from_jd_skill_list: bool = False) -> bool:
    """Tools, languages, platforms, certifications — things a resume can falsely claim.

    Soft phrases ("client communication", "scalable", "problem solving") are
    wording, not claims, so they're free to use. Heuristic: a term is hard if it
    has a capital letter, digit or tech symbol (Python, AWS, Node.js, C++, EC2),
    or if the JD lists it as a skill and it's a single word (e.g. "pandas").
    """
    t = term.strip()
    if re.search(r"[A-Z0-9+#./]", t):
        return True
    return from_jd_skill_list and len(t.split()) == 1


def _check_skills(before: str, after: str, keywords_added: list[str], evidence: str,
                  jd_skills: list[str], scope: str) -> list[str]:
    """Flag newly introduced *hard skills* that ``evidence`` doesn't back."""
    jd_skill_keys = {normalize(t) for t in jd_skills}
    candidates = {
        k.strip() for k in keywords_added
        if k and k.strip() and is_hard_skill(k, from_jd_skill_list=normalize(k) in jd_skill_keys)
    }
    # Catch JD skills slipped into the text without being declared.
    candidates |= {
        t for t in jd_skills
        if is_hard_skill(t, from_jd_skill_list=True) and contains_term(after, t) and not contains_term(before, t)
    }
    unsupported = sorted(
        t for t in candidates
        if contains_term(after, t) and not contains_term(before, t) and not contains_term(evidence, t)
    )
    if unsupported:
        return [
            f"adds {', '.join(repr(u) for u in unsupported)}, which your master profile "
            f"doesn't show for {scope}"
        ]
    return []


def _check_bullet_text(after: str) -> list[str]:
    if not after.strip():
        raise Rejected("new bullet text is empty")
    n = word_count(after)
    return [f"bullet is {n} words (aim for ≤ {MAX_BULLET_WORDS})"] if n > MAX_BULLET_WORDS else []


# ── main entry point ───────────────────────────────────────────────────────────

def validate_changes(
    changes: list[dict],
    resume: dict,
    master: dict,
    jd_analysis: dict,
    *,
    original: dict | None = None,
    id_prefix: str = "c",
    bullet_prefix: str = "new",
) -> tuple[list[dict], list[dict]]:
    """Check proposed changes in order; returns (applied, skipped).

    ``resume`` is what the changes edit (the resume as currently displayed).
    ``original`` is the uploaded resume the ±1 bullet-count rule is measured
    against; it defaults to ``resume``. Follow-up batches pass a distinct
    ``id_prefix`` / ``bullet_prefix`` so their ids never collide with earlier ones.
    """
    accepted: list[dict] = []
    rejected: list[dict] = []

    working: dict = {
        "experience": [dict(e, bullets=list(e.get("bullets", []))) for e in resume.get("experience", [])],
        "projects": [dict(p, bullets=list(p.get("bullets", []))) for p in resume.get("projects", [])],
        "summary": dict(resume.get("summary") or {"id": "summary", "text": ""}),
        "skills": list(resume.get("skills") or []),
    }
    profile_numbers: set[str] = set().union(*(numbers_in(s) for s in flatten(master)))
    global_evidence = _global_evidence(master)
    jd_skills = _jd_terms(jd_analysis, "must_have_skills", "nice_to_have_skills")

    # Bullets already added / removed relative to the original upload count
    # towards the one-add / one-remove allowance per item.
    adds: dict[str, int] = {}
    removes: dict[str, int] = {}
    for item in working["experience"] + working["projects"]:
        orig_ids = {b["id"] for b in resume_item_bullets(original or resume, item["id"])}
        cur_ids = {b["id"] for b in item["bullets"]}
        adds[item["id"]] = len(cur_ids - orig_ids)
        removes[item["id"]] = len(orig_ids - cur_ids)
    reordered: set[str] = set()
    touched_bullets: set[str] = set()
    new_bullet_seq = 0

    for change in changes:
        try:
            op = change.get("op")
            if op not in ALL_OPS:
                raise Rejected(f"unknown operation {op!r}")

            for key in PROTECTED_KEYS:
                if change.get(key) not in (None, "", []):
                    raise Rejected(f"tries to modify a protected field ({key})")

            item_id = change.get("item_id") or ""
            if item_id.lower().startswith(_PROTECTED_PREFIXES):
                raise Rejected("education, certifications and contact details can't be changed")

            warnings: list[str] = []
            after = (change.get("after") or "").strip()
            keywords = [k for k in change.get("keywords_added") or [] if isinstance(k, str)]

            if op == "rewrite_summary":
                before = working["summary"].get("text", "")
                if not after or normalize(after) == normalize(before):
                    continue  # no-op, drop silently
                if word_count(after) > MAX_SUMMARY_WORDS:
                    warnings.append(f"summary is {word_count(after)} words (aim for ≤ {MAX_SUMMARY_WORDS})")
                warnings += _check_numbers(after, profile_numbers)
                warnings += _check_skills(before, after, keywords, global_evidence, jd_skills, "your profile")
                change = {**change, "item_id": "summary", "before": before, "after": after}

            elif op == "update_skills":
                before_skills = list(working["skills"])
                proposed = [s.strip() for s in change.get("skills_after") or [] if isinstance(s, str) and s.strip()]
                have = {normalize(s) for s in before_skills}
                kept: list[str] = []
                unbacked: list[str] = []
                seen: set[str] = set()
                for skill in proposed:
                    key = normalize(skill)
                    if key in seen:
                        continue
                    seen.add(key)
                    kept.append(skill)
                    if key not in have and not contains_term(global_evidence, skill):
                        unbacked.append(skill)
                if unbacked:
                    warnings.append(
                        f"adds {', '.join(repr(u) for u in unbacked)}, which your master profile doesn't show"
                    )
                if [normalize(s) for s in kept] == [normalize(s) for s in before_skills]:
                    continue
                change = {
                    **change,
                    "item_id": "skills",
                    "skills_before": before_skills,
                    "skills_after": kept,
                    "keywords_added": [s for s in kept if normalize(s) not in have],
                }

            else:
                item = find_item(working, item_id)
                if item is None:
                    raise Rejected(f"unknown item {item_id!r}")
                bullets = item["bullets"]
                by_id = {b["id"]: b for b in bullets}
                bullet_id = change.get("bullet_id") or ""
                scope = f"{item.get('title') or item.get('name')}" + (
                    f" at {item['company']}" if item.get("company") else ""
                )
                evidence = _item_evidence(master, item_id)

                if op == "rewrite_bullet":
                    if bullet_id in touched_bullets:
                        raise Rejected("bullet already changed by another edit")
                    if bullet_id not in by_id:
                        raise Rejected(f"unknown bullet {bullet_id!r}")
                    before = by_id[bullet_id]["text"]
                    if normalize(after) == normalize(before):
                        continue  # no-op, drop silently
                    warnings += _check_bullet_text(after)
                    warnings += _check_numbers(after, profile_numbers)
                    warnings += _check_skills(before, after, keywords, evidence, jd_skills, scope)
                    touched_bullets.add(bullet_id)
                    change = {**change, "before": before, "after": after}

                elif op == "add_bullet":
                    if adds.get(item_id, 0) >= 1:
                        warnings.append("adds more than one bullet to this item vs your original resume")
                    if bullet_id and bullet_id not in by_id:
                        bullet_id = ""
                    warnings += _check_bullet_text(after)
                    warnings += _check_numbers(after, profile_numbers)
                    warnings += _check_skills("", after, keywords, evidence, jd_skills, scope)
                    new_bullet_seq += 1
                    adds[item_id] = adds.get(item_id, 0) + 1
                    change = {
                        **change,
                        "bullet_id": bullet_id or None,
                        "before": "",
                        "after": after,
                        "new_bullet_id": f"{item_id}_{bullet_prefix}{new_bullet_seq}",
                    }

                elif op == "remove_bullet":
                    if bullet_id not in by_id:
                        raise Rejected(f"unknown bullet {bullet_id!r}")
                    if bullet_id in touched_bullets:
                        raise Rejected("bullet already changed by another edit")
                    if removes.get(item_id, 0) >= 1:
                        warnings.append("removes more than one bullet from this item vs your original resume")
                    if len(bullets) <= 1:
                        raise Rejected("can't remove an item's only bullet")
                    removes[item_id] = removes.get(item_id, 0) + 1
                    touched_bullets.add(bullet_id)
                    change = {**change, "before": by_id[bullet_id]["text"], "after": ""}

                elif op == "reorder_bullets":
                    if item_id in reordered:
                        raise Rejected("item already reordered")
                    original_ids = [b["id"] for b in resume_item_bullets(resume, item_id)]
                    listed = [b for b in change.get("new_order") or [] if isinstance(b, str)]
                    if len(set(listed)) != len(listed) or not set(listed) <= set(original_ids):
                        raise Rejected("new order lists unknown or duplicate bullets")
                    # Bullets the model left out keep their relative order at the end.
                    new_order = listed + [b for b in original_ids if b not in listed]
                    if new_order == original_ids:
                        continue
                    reordered.add(item_id)
                    change = {**change, "new_order": new_order, "before": "", "after": ""}

            change["id"] = f"{id_prefix}{len(accepted) + 1}"
            change["keywords_added"] = change.get("keywords_added") or []
            change["warnings"] = warnings
            apply_change(working, change)
            accepted.append(change)

        except Rejected as exc:
            rejected.append({**change, "rejection_reason": str(exc)})

    return accepted, rejected


def resume_item_bullets(resume: dict, item_id: str) -> list[dict]:
    item = find_item(resume, item_id)
    return list(item.get("bullets", [])) if item else []


def supported_skill(master: dict, skill: str) -> bool:
    """True if the master profile already backs ``skill`` anywhere."""
    return contains_term(_global_evidence(master), skill)


__all__ = ["validate_changes", "supported_skill", "MAX_BULLET_WORDS"]
