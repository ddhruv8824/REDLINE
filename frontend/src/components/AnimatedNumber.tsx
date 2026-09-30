import { useEffect, useRef, useState } from "react";

const FRAME_MS = 16;

/**
 * Counts smoothly to a new value (instantly with reduced motion). Uses timers rather
 * than requestAnimationFrame so the number is never left stale in a background tab.
 */
export function AnimatedNumber({ value, durationMs = 450 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* ignore */
    }
    const t0 = Date.now();
    let timer = 0;
    const tick = () => {
      const p = reduce ? 1 : Math.min(1, (Date.now() - t0) / durationMs);
      const current = Math.round(start + (value - start) * (1 - (1 - p) ** 3));
      setShown(current);
      from.current = current;
      if (p < 1) timer = window.setTimeout(tick, FRAME_MS);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [value, durationMs]);

  return <>{shown}</>;
}
