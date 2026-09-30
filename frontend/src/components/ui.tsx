// Primitives for the Redline workspace ("Architectural Monolith" design).
// All colours come from the am-* tokens in globals.css.

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "coral" | "outline" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  coral: "bg-am-coral text-am-ink hover:opacity-90",
  outline: "border border-am-border bg-transparent text-am-canvas hover:bg-am-accent",
  ghost: "bg-transparent text-am-muted hover:bg-am-accent hover:text-am-canvas",
};

export const AmButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "icon" }
>(function AmButton({ variant = "outline", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-am-md font-am-body font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        size === "icon" ? "size-8" : size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-[13px]",
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
});

/** Tiny uppercase mono label — sits above headings, numerals and sections. */
export function MonoLabel({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted", className)}
      {...props}
    />
  );
}

type ChipTone = "neutral" | "coral" | "success" | "destructive";

const CHIP: Record<ChipTone, string> = {
  neutral: "border-am-border text-am-muted",
  coral: "border-am-coral/25 bg-am-coral/10 text-am-coral",
  success: "border-am-success/30 bg-am-success/5 text-am-success",
  destructive: "border-am-destructive/30 bg-am-destructive/10 text-am-canvas",
};

export function Chip({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-am-md border px-2 py-0.5 font-am-mono text-[10px] uppercase tracking-[0.08em]",
        CHIP[tone],
        className,
      )}
      {...props}
    />
  );
}

export const amInput =
  "w-full rounded-am-md border border-am-input bg-am-surface px-3 py-2 font-am-body text-[13px] text-am-canvas placeholder:text-am-muted outline-none transition-colors duration-150 focus:border-am-coral";
