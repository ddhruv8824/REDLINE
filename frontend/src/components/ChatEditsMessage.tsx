import type { ChangeStatus, ProfileFact, RejectedChange, ResumeVersion, TailorChange } from "@/lib/tailor/types";
import { useMemo } from "react";
import { changeImpacts } from "@/lib/tailor/ats";
import { ChangeCard } from "./ChangeCard";
import { SkippedList } from "./TailorResultMessage";
import { MonoLabel } from "./ui";

interface ChatEditsMessageProps {
  version: ResumeVersion | undefined;
  changeIds: string[];
  rejected: RejectedChange[];
  facts: ProfileFact[];
  activeChangeId: string | null;
  onSetStatus: (changeId: string, status: ChangeStatus) => void;
  onShowChange: (change: TailorChange) => void;
}

/** The outcome of one chat request: edit cards, skipped edits, and facts saved to the profile. */
export function ChatEditsMessage({
  version,
  changeIds,
  rejected,
  facts,
  activeChangeId,
  onSetStatus,
  onShowChange,
}: ChatEditsMessageProps) {
  const changes = version ? version.changes.filter((c) => changeIds.includes(c.id)) : [];
  const impacts = useMemo(() => (version ? changeImpacts(version) : new Map()), [version]);

  return (
    <div className="space-y-3">
      {facts.length > 0 && (
        <section className="rounded-am-lg border border-am-success/30 bg-am-success/5 p-4">
          <MonoLabel className="text-am-success">Saved to master profile</MonoLabel>
          <ul className="mt-2 space-y-1 text-[13px] text-am-canvas/90">
            {facts.map((f, i) => (
              <li key={i}>
                {f.skill && <span className="font-semibold">{f.skill} — </span>}
                {f.note}
              </li>
            ))}
          </ul>
        </section>
      )}

      {version && changes.length > 0 && (
        <>
          <MonoLabel className="block">Refinements ({changes.length})</MonoLabel>
          {changes.map((change, i) => (
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
        </>
      )}

      <SkippedList items={rejected} />
    </div>
  );
}
