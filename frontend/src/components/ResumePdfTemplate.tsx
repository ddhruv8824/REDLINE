// Resume PDF template (React-PDF). Rendered from resume JSON — the uploaded PDF
// is never edited. Load it lazily via renderResumePdf in lib/renderPdf.ts.

import { Document, Font, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Bullet, Resume } from "@/lib/tailor/types";

// Keep words whole — React-PDF's default hyphenation splits tech terms oddly.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#d4d4d4";
const HIGHLIGHT = "#fef08a";

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 42,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    lineHeight: 1.35,
    color: INK,
  },
  name: { fontFamily: "Helvetica-Bold", fontSize: 20, textAlign: "center", marginBottom: 3 },
  contact: { fontSize: 8.5, color: MUTED, textAlign: "center", marginBottom: 10 },
  link: { color: MUTED, textDecoration: "none" },
  section: { marginTop: 8 },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    borderBottomWidth: 0.75,
    borderBottomColor: RULE,
    paddingBottom: 2,
    marginBottom: 5,
  },
  item: { marginBottom: 6 },
  itemHeader: { flexDirection: "row", justifyContent: "space-between" },
  itemTitle: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  itemMeta: { fontSize: 8.5, color: MUTED },
  itemSub: { fontSize: 9, color: MUTED, marginBottom: 2 },
  bulletRow: { flexDirection: "row", paddingHorizontal: 2, borderRadius: 2 },
  bulletDot: { width: 9 },
  bulletText: { flex: 1 },
  highlighted: { backgroundColor: HIGHLIGHT },
});

function dateRange(start?: string, end?: string): string {
  return [start, end].filter(Boolean).join(" – ");
}

function Bullets({ bullets, highlight }: { bullets: Bullet[]; highlight: Set<string> }) {
  return (
    <View>
      {bullets.map((b) => (
        <View key={b.id} style={highlight.has(b.id) ? [s.bulletRow, s.highlighted] : s.bulletRow} wrap={false}>
          <Text style={s.bulletDot}>•</Text>
          <Text style={s.bulletText}>{b.text}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} minPresenceAhead={40}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function ResumeDocument({ resume, highlight = new Set() }: { resume: Resume; highlight?: Set<string> }) {
  const c = resume.contact;
  const contactParts = [c.email, c.phone, c.location].filter(Boolean);
  const links = [c.linkedin, c.github, c.website].filter(Boolean);

  return (
    <Document title={`${c.name || "Resume"}`} author={c.name || undefined} creator="Redline">
      <Page size="A4" style={s.page}>
        {c.name ? <Text style={s.name}>{c.name}</Text> : null}
        {contactParts.length + links.length > 0 && (
          <Text style={s.contact}>
            {contactParts.join("  |  ")}
            {links.map((url, i) => (
              <Text key={url}>
                {contactParts.length > 0 || i > 0 ? "  |  " : ""}
                <Link style={s.link} src={url.startsWith("http") ? url : `https://${url}`}>
                  {url.replace(/^https?:\/\/(www\.)?/, "")}
                </Link>
              </Text>
            ))}
          </Text>
        )}

        {resume.summary?.text ? (
          <Section title="Summary">
            <Text style={highlight.has("summary") ? s.highlighted : undefined}>{resume.summary.text}</Text>
          </Section>
        ) : null}

        {resume.experience.length > 0 && (
          <Section title="Experience">
            {resume.experience.map((e) => (
              <View key={e.id} style={s.item}>
                <View style={s.itemHeader}>
                  <Text style={s.itemTitle}>{e.title}</Text>
                  <Text style={s.itemMeta}>{dateRange(e.start_date, e.end_date)}</Text>
                </View>
                <Text style={s.itemSub}>{[e.company, e.location].filter(Boolean).join(", ")}</Text>
                <Bullets bullets={e.bullets} highlight={highlight} />
              </View>
            ))}
          </Section>
        )}

        {resume.projects.length > 0 && (
          <Section title="Projects">
            {resume.projects.map((p) => (
              <View key={p.id} style={s.item}>
                <View style={s.itemHeader}>
                  <Text style={s.itemTitle}>
                    {p.name}
                    {p.tech.length > 0 ? <Text style={s.itemMeta}>{`  ·  ${p.tech.join(", ")}`}</Text> : null}
                  </Text>
                  <Text style={s.itemMeta}>{dateRange(p.start_date, p.end_date)}</Text>
                </View>
                <Bullets bullets={p.bullets} highlight={highlight} />
              </View>
            ))}
          </Section>
        )}

        {resume.skills.length > 0 && (
          <Section title="Skills">
            <Text style={highlight.has("skills") ? s.highlighted : undefined}>{resume.skills.join(", ")}</Text>
          </Section>
        )}

        {resume.education.length > 0 && (
          <Section title="Education">
            {resume.education.map((ed) => (
              <View key={ed.id} style={[s.item, s.itemHeader]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitle}>{ed.institution}</Text>
                  <Text style={s.itemSub}>
                    {[ed.degree, ed.field_of_study].filter(Boolean).join(", ")}
                    {ed.gpa ? `  ·  GPA ${ed.gpa}` : ""}
                  </Text>
                </View>
                <Text style={s.itemMeta}>{ed.dates}</Text>
              </View>
            ))}
          </Section>
        )}

        {resume.certifications.length > 0 && (
          <Section title="Certifications">
            <Text>{resume.certifications.join(", ")}</Text>
          </Section>
        )}
      </Page>
    </Document>
  );
}
