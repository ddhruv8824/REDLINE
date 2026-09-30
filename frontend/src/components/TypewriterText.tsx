import { useEffect, useMemo, useRef, useState } from "react";

const WORD_MS = 35; // per word for short replies
const MAX_TOTAL_MS = 2500; // long replies speed up so none takes longer than this

interface TypewriterTextProps {
  text: string;
  /** Show the full text at once (e.g. the user has already moved on). */
  instant?: boolean;
  /** Called after each revealed step, so the chat can keep following the text. */
  onProgress?: () => void;
  onDone?: () => void;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Reveals an AI reply word by word, with a coral caret while typing. */
export function TypewriterText({ text, instant = false, onProgress, onDone }: TypewriterTextProps) {
  // Words keep their trailing whitespace so line breaks survive.
  const words = useMemo(() => text.match(/\S+\s*/g) ?? [text], [text]);
  const skip = instant || prefersReducedMotion();
  const [shown, setShown] = useState(0);
  const done = skip || shown >= words.length;

  // Latest callbacks without restarting the timer.
  const cb = useRef({ onProgress, onDone });
  useEffect(() => {
    cb.current = { onProgress, onDone };
  });

  useEffect(() => {
    if (done) return;
    const step = Math.max(1, Math.ceil((words.length * WORD_MS) / MAX_TOTAL_MS));
    const timer = window.setInterval(() => {
      setShown((n) => Math.min(words.length, n + step));
    }, WORD_MS);
    return () => window.clearInterval(timer);
  }, [done, words.length]);

  useEffect(() => {
    cb.current.onProgress?.();
    if (done) cb.current.onDone?.();
  }, [shown, done]);

  if (done) return <>{text}</>;
  return (
    <>
      {/* Screen readers get the whole reply once, not word by word. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.slice(0, shown).join("")}
        <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-am-coral" />
      </span>
    </>
  );
}
