import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { startNewWorkspace, workspaceLink } from "@/lib/workspace";
import { MonoLabel } from "./ui";

/** Header menu: copy a link back to this workspace, or start a fresh one. */
export function WorkspaceMenu({ workspace }: { workspace: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(workspaceLink(workspace));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link to reopen your workspace:", workspaceLink(workspace));
    }
  };

  const item =
    "flex w-full items-center gap-2 rounded-am-md px-2.5 py-2 text-left text-[13px] text-am-canvas transition-colors duration-150 hover:bg-am-accent";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setConfirmNew(false);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-am-md px-1.5 py-1 text-[13px] text-am-canvas transition-colors duration-150 hover:bg-am-accent"
      >
        Workspace <ChevronDown className={cn("h-3.5 w-3.5 text-am-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-am-lg border border-am-border bg-am-surface p-1.5 shadow-2xl"
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <MonoLabel>This browser&apos;s workspace</MonoLabel>
            <p className="mt-1 truncate font-am-mono text-[11px] text-am-muted" title={workspace}>
              {workspace}
            </p>
          </div>
          <div className="my-1 h-px bg-am-border" />
          <button type="button" role="menuitem" className={item} onClick={copyLink}>
            {copied ? <Check className="h-4 w-4 text-am-success" /> : <Link2 className="h-4 w-4 text-am-muted" />}
            {copied ? "Link copied" : "Copy link to this workspace"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn(item, confirmNew && "bg-am-coral/10 text-am-coral hover:bg-am-coral/15")}
            onClick={() => (confirmNew ? startNewWorkspace() : setConfirmNew(true))}
          >
            <Plus className={cn("h-4 w-4", confirmNew ? "text-am-coral" : "text-am-muted")} />
            {confirmNew ? "Click again — this one stays saved" : "Start a new workspace"}
          </button>
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] leading-relaxed text-am-muted">
            Workspaces are private to whoever has the link. Save yours to come back from another browser.
          </p>
        </div>
      )}
    </div>
  );
}
