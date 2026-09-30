import { useMemo, useState } from "react";
import { Check, Info, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ATS_GROUPS, atsScore, keywordGroup } from "@/lib/tailor/ats";
import { applyActiveChanges } from "@/lib/tailor/patch";
import type { ResumeVersion } from "@/lib/tailor/types";
import { AnimatedNumber } from "./AnimatedNumber";
import { AmButton, MonoLabel, amInput } from "./ui";

export type KeywordTarget = { kind: "summary" } | { kind: "skills" } | { kind: "item"; id: string; label: string };

interface AtsPanelProps {
  version: ResumeVersion;
  busy: boolean;
  onAddKeywords: (keywords: string[], target: KeywordTarget) => void;
}

/**
 * ATS keyword match for a tailored version: original vs what's in the preview now,
 * per-group breakdown, and missing keywords you can select and ask Redline to work in.
 */
export function AtsPanel({ version, busy, onAddKeywords }: AtsPanelProps) {
  const [showHow, setShowHow] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const jd = version.jd_analysis;

  const { original, now, pending } = useMemo(() => {
    const current = applyActiveChanges(version.base_resume, version.changes, version.statuses);
    return {
      original: atsScore(version.base_resume, jd),
      now: atsScore(current, jd),
      pending: version.changes.filter((c) => (version.statuses[c.id] ?? "pending") === "pending").length,
    };
  }, [version, jd]);

  const delta = now.score - original.score;
  const total = now.matched.length + now.missing.length;
  const items = [
    ...version.base_resume.experience.map((e) => ({ id: e.id, label: `${e.title} · ${e.company}` })),
    ...version.base_resume.projects.map((p) => ({ id: p.id, label: `Project · ${p.name}` })),
  ];

  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const add = (target: KeywordTarget) => {
    onAddKeywords(selected, target);
    setSelected([]);
  };

  return (
    <section className="rounded-am-lg border border-am-border bg-am-surface/50 p-5">
      {/* header */}
      <div className="flex items-center justify-between gap-3">
        <MonoLabel>ATS keyword match</MonoLabel>
        <button
          type="button"
          onClick={() => setShowHow((v) => !v)}
          aria-expanded={showHow}
          className="flex items-center gap-1 font-am-mono text-[10px] uppercase tracking-[0.12em] text-am-muted transition-colors duration-150 hover:text-am-canvas"
        >
          <Info className="h-3.5 w-3.5" /> How it&apos;s scored
        </button>
      </div>
      {showHow && (
        <p className="mt-3 rounded-am-md border border-am-border bg-am-ink/40 p-3 text-xs leading-relaxed text-am-muted">
          The share of this job&apos;s keywords that appear in your resume, the way an applicant-tracking system scans
          it. Must-have skills count 3×, nice-to-have skills and other keywords 1×. Synonyms and plurals count
          (e.g. <span className="text-am-canvas">LLM</span> for <span className="text-am-canvas">Generative AI</span>).
          It&apos;s a keyword check, not a judgement of fit.
        </p>
      )}

      {/* scores */}
      <div className="mt-4 flex items-end gap-6">
        <div>
          <MonoLabel className="block">Original</MonoLabel>
          <p className="font-am-display text-4xl font-bold text-am-muted">{original.score}%</p>
        </div>
        <span className="pb-2 text-xl text-am-muted">→</span>
        <div>
          <MonoLabel className="block text-am-coral">Now, in preview</MonoLabel>
          <p className="font-am-display text-5xl font-bold text-am-coral">
            <AnimatedNumber value={now.score} />%
          </p>
        </div>
        {delta !== 0 && (
          <span
            className={cn(
              "mb-2 rounded-am-md border px-2 py-0.5 font-am-mono text-xs",
              delta > 0 ? "border-am-success/30 bg-am-success/5 text-am-success" : "border-am-border text-am-muted",
            )}
          >
            {delta > 0 ? "+" : ""}
            {delta} pts
          </span>
        )}
      </div>

      {/* two-layer bar: original under current */}
      <div className="relative mt-4 h-1.5 w-full overflow-hidden rounded-full bg-am-ink">
        <div className="absolute inset-y-0 left-0 bg-am-coral/30" style={{ width: `${original.score}%` }} />
        <div
          className="absolute inset-y-0 left-0 bg-am-coral transition-[width] duration-300"
          style={{ width: `${now.score}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-am-muted">
        {pending > 0
          ? `Includes ${pending} pending edit${pending === 1 ? "" : "s"} — they're already in your preview. Accept keeps an edit; Reject removes it and its keywords.`
          : "Counts every edit you've kept."}
      </p>

      {/* breakdown */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {ATS_GROUPS.map(({ key, label, weight }) => {
          const g = now.groups?.[key] ?? { matched: 0, total: 0 };
          if (!g.total) return <div key={key} />;
          return (
            <div key={key}>
              <MonoLabel className="block">
                {label} {weight > 1 && <span className="text-am-coral">×{weight}</span>}
              </MonoLabel>
              <p className="mt-1 font-am-display text-lg font-semibold text-am-canvas">
                {g.matched}
                <span className="text-sm text-am-muted"> / {g.total}</span>
              </p>
              <div className="mt-1 h-0.5 w-full bg-am-ink">
                <div className="h-full bg-am-success" style={{ width: `${(100 * g.matched) / g.total}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* keywords */}
      {now.matched.length > 0 && (
        <div className="mt-5">
          <MonoLabel className="block">In your resume ({now.matched.length})</MonoLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {now.matched.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-am-md border border-am-success/30 bg-am-success/5 px-2 py-0.5 font-am-mono text-[10px] text-am-success"
              >
                <Check className="h-3 w-3" /> {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {now.missing.length > 0 && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3">
            <MonoLabel className="block">
              Missing ({now.missing.length} of {total})
            </MonoLabel>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected([])}
                className="font-am-mono text-[10px] uppercase tracking-[0.1em] text-am-muted hover:text-am-canvas"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-am-muted">
            Select the ones you&apos;ve genuinely worked with, then choose where Redline should add them.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {now.missing.map((k) => {
              const on = selected.includes(k);
              const must = keywordGroup(jd, k) === "must_have_skills";
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-am-md border px-2 py-0.5 font-am-mono text-[10px] transition-colors duration-150",
                    on
                      ? "border-am-coral bg-am-coral/15 text-am-coral"
                      : "border-am-border text-am-muted hover:border-am-input hover:text-am-canvas",
                  )}
                  title={must ? "Must-have (counts 3×)" : undefined}
                >
                  {on ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                  {k}
                  {must && <span className="ml-0.5 size-1 rounded-full bg-am-coral" aria-label="must-have" />}
                </button>
              );
            })}
          </div>

          {selected.length > 0 && (
            <div className="mt-3 rounded-am-md border border-am-coral/35 bg-am-ink/40 p-3">
              <MonoLabel className="block text-am-coral">
                Add {selected.length} keyword{selected.length === 1 ? "" : "s"} to
              </MonoLabel>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <AmButton variant="coral" size="sm" disabled={busy} onClick={() => add({ kind: "summary" })}>
                  Summary
                </AmButton>
                <AmButton variant="outline" size="sm" disabled={busy} onClick={() => add({ kind: "skills" })}>
                  Skills
                </AmButton>
                {items.length > 0 && (
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const item = items.find((i) => i.id === e.target.value);
                      if (item) add({ kind: "item", id: item.id, label: item.label });
                    }}
                    className={cn(amInput, "h-7 w-auto py-0 text-xs")}
                    aria-label="Add to a role or project"
                  >
                    <option value="">A role or project…</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="mt-2 text-[11px] text-am-muted">
                Edits arrive as redlines to review. Anything your profile doesn&apos;t back up gets flagged.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
