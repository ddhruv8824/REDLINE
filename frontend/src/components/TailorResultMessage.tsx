import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiUrl } from "@/lib/api";
import { changeImpacts, hasKeywords } from "@/lib/tailor/ats";
import type { ChangeStatus, Gap, MasterProfile, RejectedChange, ResumeVersion, TailorChange } from "@/lib/tailor/types";
import { AtsPanel, type KeywordTarget } from "./AtsPanel";
import { ChangeCard } from "./ChangeCard";
import { AmButton, Chip, MonoLabel, amInput } from "./ui";

export interface GapConfirmation {
  itemId: string; // job / project id, or "" for general
  note: string;
}

interface TailorResultMessageProps {
  version: ResumeVersion;
  masterProfile: MasterProfile | null;
  busy: boolean;
  activeChangeId: string | null;
  onSetStatus: (changeId: string, status: ChangeStatus) => void;
  onAcceptAll: () => void;
  onShowChange: (change: TailorChange) => void;
  onGapYes: (gap: Gap, confirmation: GapConfirmation) => void;
  onGapNo: (gap: Gap) => void;
  onAddKeywords: (keywords: string[], target: KeywordTarget) => void;
}

function StatusRow({ children, done = true }: { children: React.ReactNode; done?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-[13px] text-am-canvas/90">
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-full border",
          done ? "border-am-success/40 text-am-success" : "border-am-border text-am-muted",
        )}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      {children}
    </li>
  );
}

export function SkippedList({ items }: { items: RejectedChange[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="rounded-am-lg border border-am-border p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <MonoLabel>Couldn&apos;t apply ({items.length})</MonoLabel>
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 text-am-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {items.map((r, i) => (
            <li key={i} className="text-xs text-am-muted">
              {r.after && <span className="block text-am-canvas/80">“{r.after}”</span>}→ {r.rejection_reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TailorResultMessage({
  version,
  masterProfile,
  busy,
  activeChangeId,
  onSetStatus,
  onAcceptAll,
  onShowChange,
  onGapYes,
  onGapNo,
  onAddKeywords,
}: TailorResultMessageProps) {
  const impacts = useMemo(() => changeImpacts(version), [version]);

  // Chat edits live in the same version but are shown on their own chat cards.
  const tailorChanges = version.changes.filter((c) => c.origin !== "chat");
  const pendingCount = tailorChanges.filter((c) => (version.statuses[c.id] ?? "pending") === "pending").length;
  const flagged = tailorChanges.filter((c) => c.warnings?.length).length;
  const role = [version.role_title, version.company].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      {/* Tailoring status */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <MonoLabel>Tailoring status</MonoLabel>
          <div className="flex items-center gap-3">
            {version.thread_id && (
              <a
                href={getApiUrl(`/api/v1/tailor/threads/${encodeURIComponent(version.thread_id)}/history`)}
                target="_blank"
                rel="noreferrer"
                title="Every LangGraph step of this run, with the data it produced"
                className="font-am-mono text-[10px] uppercase tracking-[0.12em] text-am-muted underline-offset-2 hover:text-am-canvas hover:underline"
              >
                Run log
              </a>
            )}
            <Chip tone={pendingCount ? "success" : "neutral"}>{pendingCount ? "Ready to review" : "Reviewed"}</Chip>
          </div>
        </div>
        <ul className="space-y-2">
          <StatusRow>JD analyzed{role ? ` — ${role}` : ""}</StatusRow>
          <StatusRow>
            {tailorChanges.length} refinement{tailorChanges.length === 1 ? "" : "s"} applied to the preview
          </StatusRow>
          {flagged > 0 && <StatusRow done={false}>{flagged} flagged for a quick check</StatusRow>}
          {version.gaps.length > 0 && (
            <StatusRow done={false}>
              {version.gaps.length} open question{version.gaps.length === 1 ? "" : "s"} about the JD
            </StatusRow>
          )}
        </ul>
      </section>

      {hasKeywords(version.jd_analysis) && (
        <AtsPanel version={version} busy={busy} onAddKeywords={onAddKeywords} />
      )}

      {/* Refinements */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <MonoLabel>Refinements ({tailorChanges.length})</MonoLabel>
          {pendingCount > 0 && (
            <AmButton variant="ghost" size="sm" onClick={onAcceptAll}>
              Accept all {pendingCount}
            </AmButton>
          )}
        </div>
        {tailorChanges.length > 0 ? (
          <div className="space-y-3">
            {tailorChanges.map((change, i) => (
              <ChangeCard
                key={change.id}
                index={i + 1}
                change={change}
                status={version.statuses[change.id] ?? "pending"}
                baseResume={version.base_resume}
                active={activeChangeId === change.id}
                impact={impacts.get(change.id)}
                onAccept={() => onSetStatus(change.id, "accepted")}
                onReject={() => onSetStatus(change.id, "rejected")}
                onUndo={() => onSetStatus(change.id, "pending")}
                onShow={() => onShowChange(change)}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-am-muted">Your resume already covers this JD well — no edits suggested.</p>
        )}
      </section>

      <SkippedList items={version.rejected} />

      {/* Gap questions */}
      {version.gaps.length > 0 && (
        <section>
          <MonoLabel className="mb-3 block">Open questions ({version.gaps.length})</MonoLabel>
          <div className="space-y-3">
            {version.gaps.map((gap) => (
              <GapCard
                key={gap.id}
                gap={gap}
                answer={version.gap_answers[gap.id]}
                masterProfile={masterProfile}
                busy={busy}
                onYes={(c) => onGapYes(gap, c)}
                onNo={() => onGapNo(gap)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GapCard({
  gap,
  answer,
  masterProfile,
  busy,
  onYes,
  onNo,
}: {
  gap: Gap;
  answer?: "yes" | "no";
  masterProfile: MasterProfile | null;
  busy: boolean;
  onYes: (c: GapConfirmation) => void;
  onNo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [note, setNote] = useState("");

  const items = [
    ...(masterProfile?.jobs ?? []).map((j) => ({ id: j.id, label: `${j.title} · ${j.company}` })),
    ...(masterProfile?.projects ?? []).map((p) => ({ id: p.id, label: `Project · ${p.name}` })),
  ];

  return (
    <article className="rounded-am-lg border border-am-border bg-am-surface/50 p-4">
      <div className="flex items-center gap-2">
        <Chip tone={gap.importance === "must_have" ? "coral" : "neutral"} className="normal-case">
          {gap.skill}
        </Chip>
        <MonoLabel>{gap.importance === "must_have" ? "Must have" : "Nice to have"}</MonoLabel>
      </div>
      <p className="mt-2 text-[13px] text-am-canvas/90">{gap.question}</p>

      {answer === "yes" ? (
        <p className="mt-3 font-am-mono text-[10px] uppercase tracking-[0.1em] text-am-success">Added to your profile</p>
      ) : answer === "no" ? (
        <p className="mt-3 font-am-mono text-[10px] uppercase tracking-[0.1em] text-am-muted">Skipped</p>
      ) : open ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) onYes({ itemId, note: note.trim() });
          }}
        >
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={amInput}>
            <option value="">Where did you use it? (general)</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.label}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={`How did you use ${gap.skill}? e.g. “Deployed our APIs on ${gap.skill} for 8 months”`}
            className={cn(amInput, "resize-none")}
          />
          <div className="flex gap-2">
            <AmButton type="submit" variant="coral" size="sm" disabled={!note.trim() || busy}>
              Save &amp; re-tailor
            </AmButton>
            <AmButton variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </AmButton>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <AmButton variant="coral" size="sm" onClick={() => setOpen(true)} disabled={busy}>
            Yes, I have
          </AmButton>
          <AmButton variant="outline" size="sm" onClick={onNo}>
            No
          </AmButton>
        </div>
      )}
    </article>
  );
}
