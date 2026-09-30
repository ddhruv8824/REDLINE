import { Check, Cpu, FileUp, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AmButton, Chip, MonoLabel } from "./ui";

interface OnboardingProps {
  aiReady: boolean;
  aiLabel: string;
  uploading: boolean;
  loadingSample: boolean;
  onConnectAi: () => void;
  onUpload: (file: File) => void;
  onSample: () => void;
}

/** First-run screen: what Redline does, and the three steps to get going. */
export function Onboarding({ aiReady, aiLabel, uploading, loadingSample, onConnectAi, onUpload, onSample }: OnboardingProps) {
  const busy = uploading || loadingSample;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-12 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-16 lg:py-20">
        {/* Pitch + steps */}
        <section>
          <MonoLabel>Resume · tailored per job</MonoLabel>
          <h1 className="mt-3 font-am-display text-4xl font-bold leading-[1.1] tracking-tight text-am-canvas sm:text-5xl">
            Every job gets its own resume.
            <br />
            <span className="text-am-coral">You approve every edit.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-am-muted">
            Paste a job description and Redline rewrites your resume to match it — then shows each change as a redline
            you accept or reject. Anything your profile doesn&apos;t back up gets flagged, never slipped in.
          </p>

          <ol className="mt-10 space-y-3">
            <Step
              index={1}
              title="Connect an AI model"
              done={aiReady}
              body={
                aiReady
                  ? `Connected · ${aiLabel}`
                  : "Gemini, OpenAI, Claude or Groq — bring your own API key. It stays in this browser."
              }
              action={
                <AmButton variant={aiReady ? "ghost" : "coral"} size="sm" onClick={onConnectAi}>
                  <Cpu className="h-3.5 w-3.5" /> {aiReady ? "Change" : "Connect AI"}
                </AmButton>
              }
            />
            <Step
              index={2}
              title="Add your resume"
              current={aiReady}
              body="Upload a PDF or DOCX — or look around first with a sample resume."
              action={
                <div className="flex flex-wrap gap-2">
                  <label
                    className={cn(
                      "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-am-md bg-am-coral px-2.5 text-xs font-semibold text-am-ink transition-opacity duration-150 hover:opacity-90",
                      (!aiReady || busy) && "pointer-events-none opacity-40",
                    )}
                    title={aiReady ? "Upload your resume" : "Connect an AI model first — it reads your resume"}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
                    {uploading ? "Reading resume…" : "Upload resume"}
                    <input
                      type="file"
                      accept=".pdf,.docx"
                      className="hidden"
                      disabled={!aiReady || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <AmButton variant="outline" size="sm" onClick={onSample} disabled={busy}>
                    {loadingSample ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Try a sample
                  </AmButton>
                </div>
              }
            />
            <Step
              index={3}
              title="Paste a job description"
              body="Get a tailored version with an ATS score, change-by-change review and a clean PDF."
            />
          </ol>

          <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-am-muted">
            <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-am-success" />
            Your API key never leaves this browser except to make each request. Your resume is saved in a private
            workspace for this browser only.
          </p>
        </section>

        {/* What a redline looks like */}
        <section aria-label="Example" className="hidden lg:block">
          <RedlinePreview />
        </section>
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  body,
  action,
  done = false,
  current = false,
}: {
  index: number;
  title: string;
  body: string;
  action?: React.ReactNode;
  done?: boolean;
  current?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-am-lg border bg-am-surface/50 p-4 sm:flex-row sm:items-center sm:justify-between",
        current && !done ? "border-am-coral/35" : "border-am-border",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-am-mono text-[10px]",
            done ? "border-am-success/40 text-am-success" : "border-am-border text-am-coral",
          )}
        >
          {done ? <Check className="h-3 w-3" strokeWidth={3} /> : String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <p className="font-am-display text-[15px] font-semibold text-am-canvas">{title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-am-muted">{body}</p>
        </div>
      </div>
      {action && <div className="shrink-0 pl-9 sm:pl-0">{action}</div>}
    </li>
  );
}

/** Static illustration: a slice of resume paper with one redline, and its change card. */
function RedlinePreview() {
  return (
    <div className="relative">
      <div className="rounded-am-sm bg-am-canvas p-7 font-am-paper text-[12px] leading-[1.5] text-am-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        <p className="text-[13px] font-bold">Software Engineer</p>
        <p className="text-[11px] text-am-ink/60">Northwind Labs · 2022 – Present</p>
        <ul className="mt-2 space-y-1.5">
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span className="-mx-1 rounded-am-sm bg-am-coral/20 px-1 shadow-[inset_2px_0_0_var(--color-am-coral)]">
              Built a Python and FastAPI billing API processing 40k invoices a month.
            </span>
          </li>
          <li className="flex gap-2 text-am-ink/70">
            <span aria-hidden>•</span>
            <span>Rebuilt the customer dashboard in React, cutting load time by 45%.</span>
          </li>
          <li className="flex gap-2 text-am-ink/70">
            <span aria-hidden>•</span>
            <span>Moved deployments to Docker on AWS, from 2 hours to 15 minutes.</span>
          </li>
        </ul>
      </div>

      <article className="relative -mt-6 ml-8 mr-[-8px] rounded-am-lg border border-am-coral/35 bg-am-surface p-4 shadow-2xl">
        <p className="font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-coral">[01] Rephrase</p>
        <p className="mt-1 font-am-mono text-[10px] uppercase tracking-[0.08em] text-am-muted">
          Experience / Software Engineer · Northwind
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-am-muted line-through decoration-am-muted/60">
          Built the billing service in Python and FastAPI that processes 40k invoices a month.
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-am-canvas/90">
          Built a Python and FastAPI <span className="text-am-coral">billing API</span> processing 40k invoices a month.
        </p>
        <div className="mt-3 flex items-center gap-2 border-t border-am-border pt-3">
          <Chip tone="coral" className="normal-case">
            REST APIs
          </Chip>
          <span className="ml-auto flex gap-2" aria-hidden>
            <span className="inline-flex h-7 items-center gap-1 rounded-am-md bg-am-coral px-2.5 text-xs font-semibold text-am-ink">
              <Check className="h-3.5 w-3.5" /> Accept
            </span>
            <span className="inline-flex h-7 items-center rounded-am-md border border-am-border px-2.5 text-xs font-semibold text-am-canvas">
              Reject
            </span>
          </span>
        </div>
      </article>

      <div className="mt-6 flex items-center justify-between px-1">
        <MonoLabel>ATS keyword match</MonoLabel>
        <p className="font-am-display text-2xl font-bold">
          <span className="text-am-coral/60">58</span>
          <span className="mx-2 text-lg text-am-muted">→</span>
          <span className="text-am-coral">86</span>
          <span className="ml-2 text-base font-semibold text-am-success">+28</span>
        </p>
      </div>
    </div>
  );
}
