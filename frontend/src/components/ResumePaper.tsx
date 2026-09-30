import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Bullet, Resume } from "@/lib/tailor/types";

interface ResumePaperProps {
  resume: Resume;
  /** Every element edited in the current version (persistent marker). */
  changed: Set<string>;
  /** Elements to call attention to right now (scrolled into view, stronger marker). */
  focus: Set<string>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 border-b border-am-ink/15 pb-0.5 text-[12.5px] font-bold uppercase tracking-[0.1em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function range(a?: string, b?: string) {
  return [a, b].filter(Boolean).join(" – ");
}

/**
 * Live HTML rendering of the resume on a light "paper" sheet. Mirrors the
 * React-PDF template (ResumePdfTemplate) so what you review is what you download.
 * Edited elements carry data-changed and a coral marker.
 */
export function ResumePaper({ resume, changed, focus }: ResumePaperProps) {
  const ref = useRef<HTMLElement>(null);
  const focusKey = [...focus].sort().join(",");

  useEffect(() => {
    if (!focusKey || !ref.current) return;
    const first = ref.current.querySelector<HTMLElement>(
      focusKey
        .split(",")
        .map((id) => `[data-id="${CSS.escape(id)}"]`)
        .join(","),
    );
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [focusKey]);

  const mark = (id: string) =>
    changed.has(id) || focus.has(id)
      ? {
          "data-changed": "",
          className: cn(
            "-mx-1.5 rounded-am-sm px-1.5 transition-colors duration-200",
            focus.has(id) ? "bg-am-coral/35 shadow-[inset_2px_0_0_var(--color-am-coral)]" : "bg-am-coral/15",
          ),
        }
      : { className: "-mx-1.5 px-1.5 transition-colors duration-200" };

  const c = resume.contact;
  const contact = [c.email, c.phone, c.location, c.linkedin, c.github, c.website]
    .filter(Boolean)
    .map((v) => v.replace(/^https?:\/\/(www\.)?/, ""));

  const bullets = (list: Bullet[]) => (
    <ul className="mt-1 space-y-0.5">
      {list.map((b) => {
        const m = mark(b.id);
        return (
          <li key={b.id} data-id={b.id} {...m} className={cn("flex gap-2", m.className)}>
            <span aria-hidden>•</span>
            <span>{b.text}</span>
          </li>
        );
      })}
    </ul>
  );

  const summary = mark("summary");
  const skills = mark("skills");

  return (
    <article
      ref={ref}
      id="resume-document"
      className="mx-auto min-h-[1100px] w-full max-w-[800px] bg-am-canvas px-12 py-11 font-am-paper text-[12.5px] leading-[1.45] text-am-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] sm:px-14"
    >
      {c.name && <h1 className="text-center text-[26px] font-bold tracking-tight">{c.name}</h1>}
      {contact.length > 0 && <p className="mt-1 text-center text-[11px] text-am-ink/65">{contact.join("  |  ")}</p>}

      {resume.summary?.text && (
        <Section title="Summary">
          <p data-id="summary" {...summary}>
            {resume.summary.text}
          </p>
        </Section>
      )}

      {resume.experience.length > 0 && (
        <Section title="Experience">
          <div className="space-y-3">
            {resume.experience.map((e) => (
              <div key={e.id} data-id={e.id}>
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-[13px] font-bold">{e.title}</h3>
                  <span className="shrink-0 text-[11px] text-am-ink/65">{range(e.start_date, e.end_date)}</span>
                </div>
                <p className="text-[11.5px] text-am-ink/65">{[e.company, e.location].filter(Boolean).join(", ")}</p>
                {bullets(e.bullets)}
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.projects.length > 0 && (
        <Section title="Projects">
          <div className="space-y-3">
            {resume.projects.map((p) => (
              <div key={p.id} data-id={p.id}>
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-[13px] font-bold">
                    {p.name}
                    {p.tech.length > 0 && (
                      <span className="font-normal text-am-ink/65">{`  ·  ${p.tech.join(", ")}`}</span>
                    )}
                  </h3>
                  <span className="shrink-0 text-[11px] text-am-ink/65">{range(p.start_date, p.end_date)}</span>
                </div>
                {bullets(p.bullets)}
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.skills.length > 0 && (
        <Section title="Skills">
          <p data-id="skills" {...skills}>
            {resume.skills.join(", ")}
          </p>
        </Section>
      )}

      {resume.education.length > 0 && (
        <Section title="Education">
          <div className="space-y-2">
            {resume.education.map((ed) => (
              <div key={ed.id} className="flex items-baseline justify-between gap-4">
                <div>
                  <h3 className="text-[13px] font-bold">{ed.institution}</h3>
                  <p className="text-[11.5px] text-am-ink/65">
                    {[ed.degree, ed.field_of_study].filter(Boolean).join(", ")}
                    {ed.gpa ? `  ·  GPA ${ed.gpa}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-am-ink/65">{ed.dates}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {resume.certifications.length > 0 && (
        <Section title="Certifications">
          <p>{resume.certifications.join(", ")}</p>
        </Section>
      )}
    </article>
  );
}
