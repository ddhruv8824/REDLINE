import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { MasterProfile } from "@/lib/tailor/types";

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

interface MasterProfileDialogProps {
  profile: MasterProfile;
  saving: boolean;
  onClose: () => void;
  onSave: (profile: MasterProfile) => void;
}

/** Edit the master profile — the only source of truth the tailor may draw on. */
export function MasterProfileDialog({ profile, saving, onClose, onSave }: MasterProfileDialogProps) {
  const [draft, setDraft] = useState<MasterProfile>(() => structuredClone(profile));
  const [skillsText, setSkillsText] = useState(profile.confirmed_skills.join(", "));
  const [toolsText, setToolsText] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...profile.jobs.map((j) => [j.id, j.tools.join(", ")]),
      ...profile.projects.map((p) => [p.id, p.tech.join(", ")]),
    ]),
  );

  const save = () => {
    onSave({
      ...draft,
      confirmed_skills: splitList(skillsText),
      jobs: draft.jobs.map((j) => ({ ...j, tools: splitList(toolsText[j.id] ?? "") })),
      projects: draft.projects.map((p) => ({ ...p, tech: splitList(toolsText[p.id] ?? "") })),
    });
  };

  const items = [
    ...draft.jobs.map((j) => ({ id: j.id, label: `${j.title} · ${j.company}`, kind: "Tools" as const, notes: j.notes })),
    ...draft.projects.map((p) => ({ id: p.id, label: `Project · ${p.name}`, kind: "Tech" as const, notes: p.notes })),
  ];

  const setNotes = (id: string, notes: string) =>
    setDraft((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === id ? { ...j, notes } : j)),
      projects: d.projects.map((p) => (p.id === id ? { ...p, notes } : p)),
    }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-am-xl border border-am-border bg-am-ink shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-am-border px-6 py-4">
          <div>
            <h3 className="font-am-display text-lg font-semibold text-am-canvas">Master profile</h3>
            <p className="text-xs text-am-muted">
              The full truth about your experience. Edits that add skills or numbers not listed here get flagged for review.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-am-md p-1 text-am-muted hover:bg-am-accent">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted">Confirmed skills (comma-separated)</span>
            <textarea
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-am-md border border-am-border bg-am-surface p-2.5 text-xs text-am-canvas"
            />
          </label>

          {items.map((it) => (
            <div key={it.id} className="rounded-am-lg border border-am-border bg-am-surface/50 p-4">
              <p className="text-sm font-semibold text-am-canvas">{it.label}</p>
              <label className="mt-2 block">
                <span className="text-[11px] font-medium text-am-muted">{it.kind} used</span>
                <input
                  value={toolsText[it.id] ?? ""}
                  onChange={(e) => setToolsText((t) => ({ ...t, [it.id]: e.target.value }))}
                  className="mt-1 w-full rounded-am-md border border-am-border bg-am-surface px-2.5 py-1.5 text-xs text-am-canvas"
                />
              </label>
              <label className="mt-2 block">
                <span className="text-[11px] font-medium text-am-muted">
                  Notes — extra facts, metrics, responsibilities not on your resume
                </span>
                <textarea
                  value={it.notes}
                  onChange={(e) => setNotes(it.id, e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-y rounded-am-md border border-am-border bg-am-surface px-2.5 py-1.5 text-xs text-am-canvas"
                />
              </label>
            </div>
          ))}

          <label className="block">
            <span className="font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted">General notes</span>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={3}
              className="mt-1 w-full resize-y rounded-am-md border border-am-border bg-am-surface p-2.5 text-xs text-am-canvas"
            />
          </label>
        </div>

        <footer className="flex justify-end gap-2 border-t border-am-border px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-am-md px-4 py-2 text-xs font-medium text-am-muted hover:bg-am-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-am-md bg-am-coral px-4 py-2 text-xs font-semibold text-am-ink disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save profile
          </button>
        </footer>
      </div>
    </div>
  );
}
