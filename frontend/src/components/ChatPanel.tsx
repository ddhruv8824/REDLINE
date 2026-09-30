import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ChangeStatus,
  Gap,
  MasterProfile,
  ProfileFact,
  RejectedChange,
  ResumeVersion,
  TailorChange,
} from "@/lib/tailor/types";
import { ChatEditsMessage } from "./ChatEditsMessage";
import { TypewriterText } from "./TypewriterText";
import type { KeywordTarget } from "./AtsPanel";
import { TailorResultMessage, type GapConfirmation } from "./TailorResultMessage";
import { AmButton, MonoLabel } from "./ui";

export type ChatMessage =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "text"; text: string; tone?: "error"; animate?: boolean }
  | { id: string; role: "assistant"; kind: "status"; text: string; done: boolean }
  | { id: string; role: "assistant"; kind: "result"; versionId: string }
  | {
      id: string;
      role: "assistant";
      kind: "edits";
      versionId: string;
      changeIds: string[];
      rejected: RejectedChange[];
      facts: ProfileFact[];
    };

interface ChatPanelProps {
  messages: ChatMessage[];
  versions: Record<string, ResumeVersion>;
  masterProfile: MasterProfile | null;
  hasResume: boolean;
  busy: boolean;
  aiReady: boolean;
  activeChangeId: string | null;
  onSend: (text: string) => void;
  onOpenProfile: () => void;
  onOpenAiSettings: () => void;
  onSetStatus: (versionId: string, changeId: string, status: ChangeStatus) => void;
  onAcceptAll: (versionId: string) => void;
  onShowChange: (versionId: string, change: TailorChange) => void;
  onGapYes: (versionId: string, gap: Gap, confirmation: GapConfirmation) => void;
  onGapNo: (versionId: string, gap: Gap) => void;
  onAddKeywords: (versionId: string, keywords: string[], target: KeywordTarget) => void;
}

export function ChatPanel(props: ChatPanelProps) {
  const { messages, versions, masterProfile, hasResume, busy, aiReady, activeChangeId } = props;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [typed, setTyped] = useState<Set<string>>(() => new Set());

  // A reply types out word by word; whatever the AI sent after it (cards, status)
  // waits until it finishes. Once the user sends something newer, it completes instantly.
  const isInstant = (index: number) => messages.slice(index + 1).some((m) => m.role === "user");
  const gate = messages.findIndex(
    (m, i) => m.role === "assistant" && m.kind === "text" && m.animate && !typed.has(m.id) && !isInstant(i),
  );
  const visible = gate === -1 ? messages : messages.slice(0, gate + 1);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visible.length]);

  /** Keep following text as it types — unless the user has scrolled up to read. */
  const followBottom = () => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !hasResume) return;
    if (!aiReady) {
      props.onOpenAiSettings();
      return;
    }
    props.onSend(text);
    setDraft("");
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-am-border px-6 py-3">
        <MonoLabel>Workspace</MonoLabel>
        {hasResume && (
          <AmButton variant="ghost" size="sm" onClick={props.onOpenProfile}>
            <UserCog className="h-3.5 w-3.5" /> Master profile
          </AmButton>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
        {hasResume && (
          visible.map((m, i) => {
            if (m.role === "user")
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[88%] whitespace-pre-wrap rounded-am-lg border border-am-border bg-am-surface px-4 py-3 text-sm leading-relaxed text-am-canvas">
                    {m.text.length > 600 ? `${m.text.slice(0, 600)}…` : m.text}
                  </div>
                </div>
              );
            if (m.kind === "status")
              return (
                <div key={m.id} className="flex items-center gap-2.5 font-am-mono text-[11px] uppercase tracking-[0.1em]">
                  {m.done ? (
                    <span className="text-am-success">✓</span>
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-am-coral" />
                  )}
                  <span className={m.done ? "text-am-muted" : "text-am-canvas"}>{m.text}</span>
                </div>
              );
            if (m.kind === "edits")
              return (
                <div key={m.id} className="animate-am-fade-in">
                <ChatEditsMessage
                  version={versions[m.versionId]}
                  changeIds={m.changeIds}
                  rejected={m.rejected}
                  facts={m.facts}
                  activeChangeId={activeChangeId}
                  onSetStatus={(cid, st) => props.onSetStatus(m.versionId, cid, st)}
                  onShowChange={(change) => props.onShowChange(m.versionId, change)}
                />
                </div>
              );
            if (m.kind === "result")
              return versions[m.versionId] ? (
                <div key={m.id} className="animate-am-fade-in">
                <TailorResultMessage
                  version={versions[m.versionId]}
                  masterProfile={masterProfile}
                  busy={busy}
                  activeChangeId={activeChangeId}
                  onSetStatus={(cid, st) => props.onSetStatus(m.versionId, cid, st)}
                  onAcceptAll={() => props.onAcceptAll(m.versionId)}
                  onShowChange={(change) => props.onShowChange(m.versionId, change)}
                  onGapYes={(gap, c) => props.onGapYes(m.versionId, gap, c)}
                  onGapNo={(gap) => props.onGapNo(m.versionId, gap)}
                  onAddKeywords={(kw, target) => props.onAddKeywords(m.versionId, kw, target)}
                />
                </div>
              ) : null;
            return (
              <p
                key={m.id}
                className={cn(
                  "whitespace-pre-wrap text-sm leading-relaxed",
                  m.tone === "error"
                    ? "rounded-am-lg border border-am-destructive/30 bg-am-destructive/10 px-4 py-3 text-am-canvas"
                    : "text-am-canvas/90",
                )}
              >
                {m.animate && !typed.has(m.id) ? (
                  <TypewriterText
                    text={m.text}
                    instant={isInstant(i)}
                    onProgress={followBottom}
                    onDone={() => setTyped((s) => new Set(s).add(m.id))}
                  />
                ) : (
                  m.text
                )}
              </p>
            );
          })
        )}
      </div>

      <div className="border-t border-am-border p-4">
        <MonoLabel className="mb-2 block">Job description or request</MonoLabel>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            disabled={!hasResume}
            placeholder={
              !aiReady
                ? "Set up an AI provider first"
                : hasResume
                  ? "Paste a JD to tailor — or ask, e.g. “rewrite my intro for this role”"
                  : "Upload your resume first"
            }
            className="max-h-[220px] min-h-[84px] w-full resize-none rounded-am-md border border-am-input bg-am-surface py-3 pl-3.5 pr-12 text-sm leading-relaxed text-am-canvas outline-none transition-colors duration-150 placeholder:text-am-muted focus:border-am-coral disabled:cursor-not-allowed disabled:opacity-60"
          />
          <AmButton
            variant="coral"
            size="icon"
            onClick={send}
            disabled={!draft.trim() || busy || !hasResume}
            className="absolute bottom-3 right-3"
            aria-label="Send"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </AmButton>
        </div>
        <p className="mt-1.5 font-am-mono text-[10px] uppercase tracking-[0.1em] text-am-muted">
          Enter to send · Shift+Enter new line
        </p>
      </div>
    </section>
  );
}
