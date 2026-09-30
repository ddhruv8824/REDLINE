import { AlertTriangle, Check, Eye, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChangeImpact } from "@/lib/tailor/ats";
import type { ChangeStatus, Resume, TailorChange } from "@/lib/tailor/types";
import { AmButton, Chip } from "./ui";

const OP_LABEL: Record<TailorChange["op"], string> = {
  rewrite_bullet: "Rephrase",
  add_bullet: "Add",
  remove_bullet: "Remove",
  reorder_bullets: "Reorder",
  rewrite_summary: "Summary",
  update_skills: "Skills",
};

/** Word-level diff (LCS) so small rewrites are easy to scan. */
function diffWords(before: string, after: string): Array<{ text: string; kind: "same" | "del" | "add" }> {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Array<{ text: string; kind: "same" | "del" | "add" }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ text: a[i++], kind: "same" });
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ text: b[j++], kind: "add" });
    else out.push({ text: a[i++], kind: "del" });
  }
  return out;
}

function bulletText(resume: Resume, id: string): string {
  for (const item of [...resume.experience, ...resume.projects]) {
    const b = item.bullets.find((x) => x.id === id);
    if (b) return b.text;
  }
  return id;
}

function changeContext(resume: Resume, change: TailorChange): string {
  if (change.op === "rewrite_summary") return "Summary";
  if (change.op === "update_skills") return "Skills";
  const exp = resume.experience.find((e) => e.id === change.item_id);
  if (exp) return `Experience / ${exp.title} · ${exp.company}`;
  const proj = resume.projects.find((p) => p.id === change.item_id);
  return proj ? `Projects / ${proj.name}` : change.item_id;
}

interface ChangeCardProps {
  index: number;
  change: TailorChange;
  status: ChangeStatus;
  baseResume: Resume;
  active?: boolean;
  /** Exact ATS contribution (points + keywords it adds). */
  impact?: ChangeImpact;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  onShow: () => void;
}

export function ChangeCard({ index, change, status, baseResume, active, impact, onAccept, onReject, onUndo, onShow }: ChangeCardProps) {
  const rejected = status === "rejected";

  let body: React.ReactNode;
  if (change.op === "update_skills") {
    const before = new Set((change.skills_before ?? []).map((s) => s.toLowerCase()));
    const after = new Set((change.skills_after ?? []).map((s) => s.toLowerCase()));
    const removed = (change.skills_before ?? []).filter((s) => !after.has(s.toLowerCase()));
    body = (
      <div className="flex flex-wrap gap-1.5">
        {(change.skills_after ?? []).map((s) => (
          <Chip key={s} tone={before.has(s.toLowerCase()) ? "neutral" : "coral"} className="normal-case">
            {before.has(s.toLowerCase()) ? s : `+ ${s}`}
          </Chip>
        ))}
        {removed.map((s) => (
          <Chip key={s} className="normal-case line-through opacity-70">
            {s}
          </Chip>
        ))}
      </div>
    );
  } else if (change.op === "reorder_bullets") {
    body = (
      <ol className="list-decimal space-y-1 pl-4 text-[13px] text-am-canvas/90 marker:font-am-mono marker:text-[10px] marker:text-am-muted">
        {(change.new_order ?? []).map((id) => (
          <li key={id} className="line-clamp-1">
            {bulletText(baseResume, id)}
          </li>
        ))}
      </ol>
    );
  } else if (change.op === "remove_bullet") {
    body = <p className="text-[13px] leading-relaxed text-am-muted line-through">{change.before}</p>;
  } else if (change.op === "add_bullet") {
    body = <p className="text-[13px] leading-relaxed text-am-canvas/90">{change.after}</p>;
  } else {
    body = (
      <div className="space-y-2 text-[13px] leading-relaxed">
        <p className="text-am-muted line-through decoration-am-muted/60">{change.before}</p>
        <p className="text-am-canvas/90">
          {diffWords(change.before ?? "", change.after ?? "")
            .filter((part) => part.kind !== "del")
            .map((part, i) =>
              part.kind === "add" && part.text.trim() ? (
                <span key={i} className="text-am-coral">
                  {part.text}
                </span>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
        </p>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "rounded-am-lg border bg-am-surface/50 p-4 transition-[border-color,opacity] duration-150",
        active ? "border-am-coral/35" : "border-am-border",
        rejected && "opacity-70",
      )}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-coral">
            [{String(index).padStart(2, "0")}] {OP_LABEL[change.op]}
            {status === "accepted" && <span className="ml-2 text-am-success">· Accepted</span>}
            {rejected && <span className="ml-2 text-am-muted">· Reverted</span>}
          </p>
          <p className="mt-1 truncate font-am-mono text-[10px] uppercase tracking-[0.08em] text-am-muted">
            {changeContext(baseResume, change)}
          </p>
        </div>
        {!rejected && (
          <AmButton variant="ghost" size="icon" onClick={onShow} title="Show in preview" aria-label="Show in preview">
            <Eye className="h-4 w-4" />
          </AmButton>
        )}
      </header>

      {body}

      {impact && impact.points !== 0 && (
        <div
          className={cn(
            "mt-3 flex flex-wrap items-center gap-1.5 rounded-am-md border px-2.5 py-1.5",
            impact.points > 0 ? "border-am-success/25 bg-am-success/5" : "border-am-border",
          )}
        >
          <span
            className={cn(
              "font-am-mono text-[10px] font-medium uppercase tracking-[0.1em]",
              impact.points > 0 ? "text-am-success" : "text-am-muted",
            )}
          >
            {rejected ? "Restoring adds " : "ATS "}
            {impact.points > 0 ? "+" : ""}
            {impact.points} pts
          </span>
          {impact.keywords.length > 0 && (
            <span className="text-[11px] text-am-muted">· adds {impact.keywords.join(", ")}</span>
          )}
        </div>
      )}

      {(change.reason || change.keywords_added.length > 0) && (
        <div className="mt-3 border-t border-am-border pt-3">
          {change.reason && <p className="text-xs italic text-am-muted">{change.reason}</p>}
          {change.keywords_added.length > 0 && change.op !== "update_skills" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {change.keywords_added.map((k) => (
                <Chip key={k} tone="coral" className="normal-case">
                  {k}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {change.warnings && change.warnings.length > 0 && !rejected && (
        <ul className="mt-3 space-y-1">
          {change.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-[11px] text-am-muted">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-am-coral" />
              <span>
                <span className="font-am-mono text-[10px] uppercase tracking-[0.08em] text-am-coral">Check · </span>
                {w}
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-4 flex items-center gap-2">
        {rejected ? (
          <AmButton variant="ghost" size="sm" onClick={onUndo}>
            <Undo2 className="h-3.5 w-3.5" /> Restore
          </AmButton>
        ) : status === "accepted" ? (
          <>
            <span className="flex items-center gap-1 font-am-mono text-[10px] uppercase tracking-[0.1em] text-am-success">
              <Check className="h-3.5 w-3.5" /> Kept
            </span>
            <AmButton variant="ghost" size="sm" className="ml-auto" onClick={onReject}>
              Revert
            </AmButton>
          </>
        ) : (
          <>
            <AmButton variant="coral" size="sm" onClick={onAccept}>
              <Check className="h-3.5 w-3.5" /> Accept
            </AmButton>
            <AmButton variant="outline" size="sm" onClick={onReject}>
              <X className="h-3.5 w-3.5" /> Reject
            </AmButton>
          </>
        )}
      </footer>
    </article>
  );
}
