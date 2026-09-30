"""
app/services/profile.py
───────────────────────
Adding facts the candidate tells us ("I used Terraform at Acme for 12 services")
to their master profile.
"""

from __future__ import annotations

import copy

from .text import contains_term, numbers_in


def _has(values: list[str], term: str) -> bool:
    return any(v.strip().lower() == term.strip().lower() for v in values)


def facts_user_stated(facts: list[dict], message: str) -> list[dict]:
    """Keep only facts whose skill and numbers the user actually typed.

    The AI extracts the facts; this guard stops it from slipping an invented
    claim (a skill or metric the user never mentioned) into the profile.
    """
    return [
        f for f in facts
        if (not (f.get("skill") or "").strip() or contains_term(message, f["skill"]))
        and numbers_in(f.get("note") or "") <= numbers_in(message)
    ]


def apply_profile_facts(master: dict, facts: list[dict]) -> tuple[dict, list[dict]]:
    """Return (updated copy of the master profile, facts that were added)."""
    updated = copy.deepcopy(master)
    added: list[dict] = []
    for fact in facts:
        note = (fact.get("note") or "").strip()
        skill = (fact.get("skill") or "").strip()
        item_id = (fact.get("item_id") or "").strip()
        if not note:
            continue
        item = next(
            (i for section in ("jobs", "projects") for i in updated.get(section, []) if i.get("id") == item_id),
            None,
        )
        if skill and not _has(updated.setdefault("confirmed_skills", []), skill):
            updated["confirmed_skills"].append(skill)
        if item is not None:
            tools_key = "tools" if "tools" in item else "tech"
            if skill and not _has(item.setdefault(tools_key, []), skill):
                item[tools_key].append(skill)
            item["notes"] = f"{item.get('notes', '')}\n{note}".strip()
        else:
            updated["notes"] = f"{updated.get('notes', '')}\n{note}".strip()
        added.append({"skill": skill, "item_id": item_id if item is not None else "", "note": note})
    return updated, added
