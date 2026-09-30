import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Resume } from "@/lib/tailor/types";
import { ResumePaper } from "./ResumePaper";
import { MonoLabel } from "./ui";

interface ResumePreviewProps {
  resume: Resume | null;
  changed: Set<string>;
  focus: Set<string>;
  showEdits: boolean;
  onToggleEdits: (v: boolean) => void;
  toolbar?: React.ReactNode;
  emptyState?: React.ReactNode;
}

/** Right column: the resume on paper (live, with edit markers) or the exact PDF that downloads. */
export function ResumePreview({ resume, changed, focus, showEdits, onToggleEdits, toolbar, emptyState }: ResumePreviewProps) {
  const [view, setView] = useState<"paper" | "pdf">("paper");

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-am-border px-6 py-3">
        <div className="flex items-center gap-1 rounded-am-md border border-am-border p-0.5">
          {(["paper", "pdf"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-am-sm px-2.5 py-1 font-am-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150",
                view === v ? "bg-am-accent text-am-canvas" : "text-am-muted hover:text-am-canvas",
              )}
            >
              {v === "paper" ? "Preview" : "PDF"}
            </button>
          ))}
        </div>
        {view === "paper" && resume && (
          <label className="flex cursor-pointer items-center gap-2 font-am-mono text-[10px] uppercase tracking-[0.12em] text-am-muted">
            <input
              type="checkbox"
              checked={showEdits}
              onChange={(e) => onToggleEdits(e.target.checked)}
              className="accent-[var(--color-am-coral)]"
            />
            Highlight edits
          </label>
        )}
        <div className="ml-auto">{toolbar}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-am-ink px-4 py-8 sm:px-8">
        {!resume ? (
          emptyState
        ) : view === "paper" ? (
          <ResumePaper resume={resume} changed={showEdits ? changed : new Set()} focus={focus} />
        ) : (
          <PdfView resume={resume} />
        )}
      </div>
    </section>
  );
}

function PdfView({ resume }: { resume: Resume }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { renderResumePdf } = await import("@/lib/renderPdf");
        const blob = await renderResumePdf(resume);
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render PDF");
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resume]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  if (error) return <p className="text-sm text-am-canvas">Couldn&apos;t render the PDF: {error}</p>;
  if (!url)
    return (
      <div className="flex h-full items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-am-coral" />
        <MonoLabel>Rendering PDF</MonoLabel>
      </div>
    );
  return (
    <iframe
      key={url}
      src={`${url}#toolbar=0&navpanes=0&view=FitH`}
      title="Resume PDF"
      className="mx-auto h-[1100px] w-full max-w-[800px] rounded-am-sm border-0 bg-am-canvas shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
    />
  );
}
