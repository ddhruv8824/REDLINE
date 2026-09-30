import { cn } from "@/lib/utils";

interface SplitHandleProps {
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  /** Left edge of the split container, so pointer x maps to a column width. */
  getOffset: () => number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Draggable vertical divider between the chat and the preview (also keyboard-adjustable). */
export function SplitHandle({ width, min, max, defaultWidth, getOffset, onChange, onCommit }: SplitHandleProps) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId); // keep receiving moves over the PDF iframe
    } catch {
      /* pointer already released */
    }
    const offset = getOffset();
    let latest = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      latest = clamp(ev.clientX - offset, min, max);
      onChange(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 24;
    const next =
      e.key === "ArrowLeft" ? width - step : e.key === "ArrowRight" ? width + step : e.key === "Home" ? min : e.key === "End" ? max : null;
    if (next === null) return;
    e.preventDefault();
    const w = clamp(next, min, max);
    onChange(w);
    onCommit(w);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat panel"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onChange(defaultWidth);
        onCommit(defaultWidth);
      }}
      className={cn(
        "group relative hidden w-px shrink-0 cursor-col-resize bg-am-border lg:block",
        "before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:content-['']",
      )}
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-am-coral opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
      <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-am-sm bg-am-muted/40 transition-colors duration-150 group-hover:bg-am-coral" />
    </div>
  );
}
