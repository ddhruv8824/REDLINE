"""
app/services/patch.py
────────────────────────
Apply tailor changes to resume JSON as a patch. The original resume is never
mutated, so rejecting one change = re-applying all the others to the original.

Mirrored on the frontend in ``frontend/src/lib/tailor/patch.ts`` — keep the two
in sync.

Change ops
──────────
    rewrite_bullet   item_id, bullet_id, after
    add_bullet       item_id, new_bullet_id, after, bullet_id (optional anchor:
                     insert after it; append when missing)
    remove_bullet    item_id, bullet_id
    reorder_bullets  item_id, new_order  (ids not listed keep their relative
                     order at the end, so added bullets are never lost)
    rewrite_summary  after
    update_skills    skills_after
"""

from __future__ import annotations

import copy
from typing import Any, Optional

BULLET_OPS = ("rewrite_bullet", "add_bullet", "remove_bullet", "reorder_bullets")


def find_item(resume: dict, item_id: str) -> Optional[dict]:
    """Experience or project item by id (the only items with editable bullets)."""
    for section in ("experience", "projects"):
        for item in resume.get(section, []):
            if item.get("id") == item_id:
                return item
    return None


def apply_change(resume: dict, change: dict) -> None:
    """Apply one change in place. Changes that no longer fit are skipped."""
    op = change.get("op")

    if op == "rewrite_summary":
        resume.setdefault("summary", {"id": "summary", "text": ""})["text"] = change["after"]
        return
    if op == "update_skills":
        resume["skills"] = list(change.get("skills_after") or [])
        return

    item = find_item(resume, change.get("item_id", ""))
    if item is None:
        return
    bullets: list[dict] = item.setdefault("bullets", [])
    index = {b["id"]: i for i, b in enumerate(bullets)}

    if op == "rewrite_bullet":
        i = index.get(change.get("bullet_id"))
        if i is not None:
            bullets[i] = {**bullets[i], "text": change["after"]}
    elif op == "add_bullet":
        new = {"id": change["new_bullet_id"], "text": change["after"]}
        anchor = index.get(change.get("bullet_id"))
        bullets.insert(anchor + 1 if anchor is not None else len(bullets), new)
    elif op == "remove_bullet":
        i = index.get(change.get("bullet_id"))
        if i is not None:
            bullets.pop(i)
    elif op == "reorder_bullets":
        order = [bid for bid in change.get("new_order") or [] if bid in index]
        rest = [b for b in bullets if b["id"] not in set(order)]
        item["bullets"] = [bullets[index[bid]] for bid in order] + rest


def apply_changes(resume: dict, changes: list[dict]) -> dict:
    """Return a new resume with ``changes`` applied in order."""
    patched = copy.deepcopy(resume)
    for change in changes:
        apply_change(patched, change)
    return patched
