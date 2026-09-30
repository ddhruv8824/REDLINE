// Deterministic ATS keyword score — mirror of backend/app/services/ats.py (keep in sync).
// A keyword counts if the term or any alias appears, singular or plural.

import { applyActiveChanges } from "./patch";
import type { AtsResult, JdAnalysis, Resume, ResumeVersion } from "./types";

export const ATS_GROUPS: Array<{ key: "must_have_skills" | "nice_to_have_skills" | "keywords"; label: string; weight: number }> = [
  { key: "must_have_skills", label: "Must-have", weight: 3 },
  { key: "nice_to_have_skills", label: "Nice-to-have", weight: 1 },
  { key: "keywords", label: "Other keywords", weight: 1 },
];

const normalize = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const squash = (s: string) => normalize(s).replace(/[\s.\-_/]/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function containsTerm(text: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  const hay = normalize(text);
  if (new RegExp(`(?<![a-z0-9+#])${escapeRe(t)}(?![a-z0-9+#])`).test(hay)) return true;
  const sq = squash(t);
  return sq.length >= 5 && squash(hay).includes(sq);
}

/** The term plus its singular/plural twin (pipelines ↔ pipeline). */
function variants(term: string): string[] {
  const t = term.trim();
  const lower = t.toLowerCase();
  if (t.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")) return [t, t.slice(0, -1)];
  if (t.length > 2 && /[a-z]$/i.test(t)) return [t, `${t}s`];
  return [t];
}

function aliasTable(jd: JdAnalysis): Map<string, string[]> {
  const table = new Map<string, string[]>();
  for (const entry of jd.keyword_aliases ?? []) {
    if (entry && typeof entry.term === "string")
      table.set(normalize(entry.term), (entry.aliases ?? []).filter((a) => typeof a === "string" && a.trim()));
  }
  return table;
}

export function keywordFound(text: string, term: string, aliases: string[]): boolean {
  return [term, ...aliases].some((form) => variants(form).some((v) => containsTerm(text, v)));
}

export function resumeText(resume: Resume): string {
  const parts: string[] = [resume.summary?.text ?? ""];
  for (const e of resume.experience) parts.push(e.title, e.company, ...e.bullets.map((b) => b.text));
  for (const p of resume.projects) parts.push(p.name, ...p.tech, ...p.bullets.map((b) => b.text));
  parts.push(...resume.skills);
  for (const ed of resume.education) parts.push(ed.degree, ed.field_of_study);
  parts.push(...resume.certifications);
  return parts.filter(Boolean).join("\n");
}

export function atsScore(resume: Resume, jd: JdAnalysis): AtsResult {
  const text = resumeText(resume);
  const aliases = aliasTable(jd);
  const seen = new Set<string>();
  let total = 0;
  let hit = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  const groups: AtsResult["groups"] = {};
  for (const { key, weight } of ATS_GROUPS) {
    const g = (groups[key] = { matched: 0, total: 0 });
    for (const term of jd[key] ?? []) {
      if (typeof term !== "string" || !term.trim() || seen.has(normalize(term))) continue;
      seen.add(normalize(term));
      total += weight;
      g.total += 1;
      if (keywordFound(text, term, aliases.get(normalize(term)) ?? [])) {
        hit += weight;
        g.matched += 1;
        matched.push(term);
      } else {
        missing.push(term);
      }
    }
  }
  return { score: total ? Math.round((100 * hit) / total) : 0, matched, missing, groups };
}

/** Which group a JD keyword belongs to (for labelling chips). */
export function keywordGroup(jd: JdAnalysis, term: string): "must_have_skills" | "nice_to_have_skills" | "keywords" {
  const t = normalize(term);
  for (const { key } of ATS_GROUPS) if ((jd[key] ?? []).some((k) => normalize(k) === t)) return key;
  return "keywords";
}

export interface ChangeImpact {
  /** Score points this change is worth (with it vs without it). */
  points: number;
  /** JD keywords that only match because of this change. */
  keywords: string[];
}

/**
 * Exact ATS contribution of each change in a version: the score with the change
 * applied minus the score without it (all other statuses unchanged). For a rejected
 * change this is what restoring it would add.
 */
export function changeImpacts(version: ResumeVersion): Map<string, ChangeImpact> {
  const out = new Map<string, ChangeImpact>();
  if (!hasKeywords(version.jd_analysis)) return out;
  for (const change of version.changes) {
    const withIt = atsScore(
      applyActiveChanges(version.base_resume, version.changes, { ...version.statuses, [change.id]: "accepted" }),
      version.jd_analysis,
    );
    const without = atsScore(
      applyActiveChanges(version.base_resume, version.changes, { ...version.statuses, [change.id]: "rejected" }),
      version.jd_analysis,
    );
    const lost = new Set(without.matched);
    out.set(change.id, {
      points: withIt.score - without.score,
      keywords: withIt.matched.filter((k) => !lost.has(k)),
    });
  }
  return out;
}

export function hasKeywords(jd: JdAnalysis | undefined): boolean {
  return !!jd && ATS_GROUPS.some(({ key }) => (jd[key] ?? []).length > 0);
}
