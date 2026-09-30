// Apply tailor changes to resume JSON as a patch.
// Mirror of ai/services/tailor/patch.py — keep the two in sync.
// The base resume is never mutated: rejecting a change = re-applying the rest.

import type { ChangeStatus, ExperienceItem, ProjectItem, Resume, TailorChange } from "./types";

function findItem(resume: Resume, itemId: string): ExperienceItem | ProjectItem | undefined {
  return (
    resume.experience.find((e) => e.id === itemId) ?? resume.projects.find((p) => p.id === itemId)
  );
}

export function applyChange(resume: Resume, change: TailorChange): void {
  if (change.op === "rewrite_summary") {
    resume.summary = { id: "summary", text: change.after ?? "" };
    return;
  }
  if (change.op === "update_skills") {
    resume.skills = [...(change.skills_after ?? [])];
    return;
  }

  const item = findItem(resume, change.item_id);
  if (!item) return;
  const bullets = item.bullets;
  const index = new Map(bullets.map((b, i) => [b.id, i]));

  switch (change.op) {
    case "rewrite_bullet": {
      const i = index.get(change.bullet_id ?? "");
      if (i !== undefined) bullets[i] = { ...bullets[i], text: change.after ?? "" };
      break;
    }
    case "add_bullet": {
      const anchor = index.get(change.bullet_id ?? "");
      const bullet = { id: change.new_bullet_id ?? `${change.item_id}_new`, text: change.after ?? "" };
      bullets.splice(anchor !== undefined ? anchor + 1 : bullets.length, 0, bullet);
      break;
    }
    case "remove_bullet": {
      const i = index.get(change.bullet_id ?? "");
      if (i !== undefined) bullets.splice(i, 1);
      break;
    }
    case "reorder_bullets": {
      const order = (change.new_order ?? []).filter((id) => index.has(id));
      const listed = new Set(order);
      item.bullets = [
        ...order.map((id) => bullets[index.get(id)!]),
        ...bullets.filter((b) => !listed.has(b.id)),
      ];
      break;
    }
  }
}

export function applyChanges(resume: Resume, changes: TailorChange[]): Resume {
  const patched: Resume = structuredClone(resume);
  for (const change of changes) applyChange(patched, change);
  return patched;
}

/** Apply every change that hasn't been rejected. */
export function applyActiveChanges(
  resume: Resume,
  changes: TailorChange[],
  statuses: Record<string, ChangeStatus>,
): Resume {
  return applyChanges(
    resume,
    changes.filter((c) => statuses[c.id] !== "rejected"),
  );
}

/** Resume element ids a change touches — used to highlight it in the preview. */
export function highlightIdsFor(change: TailorChange): string[] {
  switch (change.op) {
    case "rewrite_bullet":
      return change.bullet_id ? [change.bullet_id] : [];
    case "add_bullet":
      return change.new_bullet_id ? [change.new_bullet_id] : [];
    case "reorder_bullets":
      return change.new_order ?? [];
    case "rewrite_summary":
      return ["summary"];
    case "update_skills":
      return ["skills"];
    default:
      return [];
  }
}
