// Redline — shapes shared with backend/app/routers/tailor.py

export interface Bullet {
  id: string;
  text: string;
}

export interface ResumeContact {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
}

export interface ExperienceItem {
  id: string;
  company: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  tools: string[];
  bullets: Bullet[];
}

export interface ProjectItem {
  id: string;
  name: string;
  tech: string[];
  link: string;
  start_date: string;
  end_date: string;
  bullets: Bullet[];
}

export interface EducationItem {
  id: string;
  institution: string;
  degree: string;
  field_of_study: string;
  dates: string;
  gpa: string;
}

export interface Resume {
  contact: ResumeContact;
  summary: { id: "summary"; text: string };
  experience: ExperienceItem[];
  projects: ProjectItem[];
  skills: string[];
  education: EducationItem[];
  certifications: string[];
}

export interface MasterJob {
  id: string;
  company: string;
  title: string;
  start_date: string;
  end_date: string;
  bullets: string[];
  tools: string[];
  notes: string;
}

export interface MasterProject {
  id: string;
  name: string;
  bullets: string[];
  tech: string[];
  notes: string;
}

export interface MasterProfile {
  contact: ResumeContact;
  jobs: MasterJob[];
  projects: MasterProject[];
  education: EducationItem[];
  certifications: string[];
  confirmed_skills: string[];
  summary: string;
  notes: string;
}

export interface JdAnalysis {
  company: string;
  role_title: string;
  seniority?: string;
  domain?: string;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  keywords: string[];
  /** Other ways a resume may say each term ("LLM" for "Generative AI"). Absent in older analyses. */
  keyword_aliases?: Array<{ term: string; aliases: string[] }>;
  responsibilities?: string[];
}

export type ChangeOp =
  | "rewrite_bullet"
  | "add_bullet"
  | "remove_bullet"
  | "reorder_bullets"
  | "rewrite_summary"
  | "update_skills";

export interface TailorChange {
  id: string;
  op: ChangeOp;
  item_id: string;
  bullet_id?: string | null;
  new_bullet_id?: string;
  before?: string;
  after?: string;
  new_order?: string[];
  skills_before?: string[];
  skills_after?: string[];
  reason: string;
  keywords_added: string[];
  /** Review flags (unverified skill/number, long bullet…) — the change is still applied. */
  warnings?: string[];
  /** "chat" for edits made from a chat request; tailoring runs leave it unset. */
  origin?: "tailor" | "chat";
}

export interface RejectedChange extends Partial<TailorChange> {
  rejection_reason: string;
}

export interface Gap {
  id: string;
  skill: string;
  question: string;
  importance: "must_have" | "nice_to_have";
}

export interface AtsResult {
  score: number;
  matched: string[];
  missing: string[];
  /** Matched / total keywords per JD group (must-have, nice-to-have, other). */
  groups?: Partial<Record<"must_have_skills" | "nice_to_have_skills" | "keywords", { matched: number; total: number }>>;
}

export interface TailorResult {
  /** LangGraph thread of this run — its step-by-step log is at /tailor/threads/{id}/history. */
  thread_id?: string;
  jd_hash: string;
  jd_analysis: JdAnalysis;
  summary: string;
  changes: TailorChange[];
  rejected: RejectedChange[];
  skills: string[];
  gaps: Gap[];
  ats: { before: AtsResult; after: AtsResult };
  tailored_resume: Resume;
}

export type TailorEvent =
  | { type: "status"; stage: "analyzing" | "tailoring" | "validating"; message: string }
  | { type: "jd_analysis"; jd_analysis: JdAnalysis; cached: boolean }
  | { type: "progress"; chars: number }
  | ({ type: "result" } & TailorResult)
  | { type: "error"; message: string };

export type ChangeStatus = "pending" | "accepted" | "rejected";
export type GapAnswer = "yes" | "no";

/** One tailored resume per JD — persisted server-side. */
export interface ResumeVersion {
  id: string;
  label: string;
  company: string;
  role_title: string;
  created_at: string;
  updated_at: string;
  jd_text: string;
  jd_hash: string;
  jd_analysis: JdAnalysis;
  base_resume: Resume;
  changes: TailorChange[];
  statuses: Record<string, ChangeStatus>;
  rejected: RejectedChange[];
  gaps: Gap[];
  gap_answers: Record<string, GapAnswer>;
  /** LangGraph thread of the tailoring run that produced this version. */
  thread_id?: string;
}

export type VersionMeta = Pick<ResumeVersion, "id" | "label" | "company" | "role_title" | "created_at" | "updated_at">;

export interface Workspace {
  current_resume: Resume | null;
  master_profile: MasterProfile | null;
  versions: VersionMeta[];
}

export interface ProfileFact {
  skill: string;
  item_id: string;
  note: string;
}

export interface ChatResult {
  action: "edit" | "answer" | "profile_update" | "tailor_request";
  reply: string;
  changes: TailorChange[];
  rejected: RejectedChange[];
  facts_added: ProfileFact[];
  master_profile?: MasterProfile;
}

export type ChatEvent =
  | { type: "status"; stage: string; message: string }
  | { type: "progress"; chars: number }
  | ({ type: "result" } & ChatResult)
  | { type: "error"; message: string };
