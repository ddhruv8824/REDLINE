"""
ai/schemas.py
─────────────────
What we ask the AI to return, as Pydantic classes.

LangChain's `model.with_structured_output(SomeClass)` turns a class into the
provider's structured-output format (JSON schema or a tool definition), and hands
back a validated `SomeClass` instance. Each `Field(description=...)` is sent to
the model too, so these descriptions double as instructions.

    ResumeExtraction  ← parse an uploaded resume
    JDAnalysis        ← understand a job description (ATS keywords + aliases)
    TailorPlan        ← edits that tailor the resume to the JD
    ChatDecision      ← what to do with a chat message (edit / answer / fact)
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# ── 1. Resume extraction ──────────────────────────────────────────────────────


class Contact(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin: str = ""
    github: str = ""
    website: str = ""


class Job(BaseModel):
    company: str
    title: str
    location: str = ""
    start_date: str = ""
    end_date: str = ""
    tools: list[str] = Field(default_factory=list, description="Every technology, tool or platform the job's bullets mention.")
    bullets: list[str] = Field(default_factory=list, description="Accomplishment lines, verbatim, without the bullet symbol.")


class Project(BaseModel):
    name: str
    tech: list[str] = Field(default_factory=list, description="The project's tech stack.")
    link: str = ""
    start_date: str = ""
    end_date: str = ""
    bullets: list[str] = Field(default_factory=list)


class Education(BaseModel):
    institution: str = ""
    degree: str = ""
    field_of_study: str = ""
    dates: str = ""
    gpa: str = ""


class ResumeExtraction(BaseModel):
    """A resume copied into structured fields, text exactly as written."""

    contact: Contact = Field(default_factory=Contact)
    summary: str = ""
    experience: list[Job] = Field(default_factory=list, description="Every job, most recent first.")
    projects: list[Project] = Field(default_factory=list, description="Personal, academic or open-source projects.")
    skills: list[str] = Field(
        default_factory=list,
        description='One skill per entry: split "Python, Java" into two and drop labels like "Languages:".',
    )
    education: list[Education] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)


# ── 2. Job description analysis ───────────────────────────────────────────────


class KeywordAlias(BaseModel):
    term: str
    aliases: list[str] = Field(
        default_factory=list,
        description='Other ways a resume may say the same thing, e.g. "Generative AI" → ["GenAI", "LLM"].',
    )


class JDAnalysis(BaseModel):
    """A job description as an applicant-tracking system (ATS) sees it."""

    company: str = ""
    role_title: str = ""
    seniority: str = Field("", description="e.g. intern, junior, mid, senior, lead")
    domain: str = Field("", description="e.g. backend, data, fintech")
    must_have_skills: list[str] = Field(
        default_factory=list,
        description="Hard requirements a recruiter would search for: skills, tools, languages, frameworks, platforms.",
    )
    nice_to_have_skills: list[str] = Field(default_factory=list, description="Preferred / bonus skills of the same kind.")
    keywords: list[str] = Field(
        default_factory=list,
        description="Other searchable domain concepts and methods (e.g. CI/CD, A/B testing) not in the skill lists.",
    )
    keyword_aliases: list[KeywordAlias] = Field(default_factory=list, description="Aliases for every term above.")
    responsibilities: list[str] = Field(default_factory=list, description="Main duties, one short line each.")


# ── 3. Edits (shared by tailoring and chat) ───────────────────────────────────


class SummaryEdit(BaseModel):
    after: str = Field("", description="The rewritten professional summary (≤ 70 words). Empty = no change.")
    reason: str = ""
    keywords_added: list[str] = Field(default_factory=list)


class ProposedChange(BaseModel):
    """One edit to a job's or project's bullets, referencing ids from the resume."""

    op: Literal["rewrite_bullet", "add_bullet", "remove_bullet", "reorder_bullets"]
    item_id: str = Field(description="Id of the job or project, e.g. 'exp1' or 'proj2'.")
    bullet_id: str = Field("", description="Bullet to rewrite/remove (e.g. 'exp1_b2'), or to insert after for add_bullet.")
    before: str = ""
    after: str = Field("", description="New bullet text (≤ 30 words).")
    new_order: list[str] = Field(default_factory=list, description="reorder_bullets only: the item's bullet ids in the new order.")
    reason: str = Field(description="One sentence tying the edit to the job.")
    keywords_added: list[str] = Field(default_factory=list, description="Job terms this edit introduces.")


class EditProposal(BaseModel):
    """Summary + bullet edits + skills list — what both tailoring and chat can propose."""

    summary: SummaryEdit = Field(default_factory=SummaryEdit)
    changes: list[ProposedChange] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list, description="Full new skills list, most relevant first. Empty = no change.")

    def to_changes(self) -> list[dict]:
        """Flatten into the change list the review step and the frontend use.

        The summary and skills list become changes too, so every edit gets the
        same accept / reject treatment.
        """
        changes = [c.model_dump() for c in self.changes]
        if self.summary.after.strip():
            changes.append({
                "op": "rewrite_summary",
                "after": self.summary.after,
                "reason": self.summary.reason,
                "keywords_added": self.summary.keywords_added,
            })
        if self.skills:
            changes.append({
                "op": "update_skills",
                "skills_after": self.skills,
                "reason": "Reordered and aligned skills with the job's requirements.",
            })
        return changes


class GapQuestion(BaseModel):
    skill: str
    question: str = Field(description='A short yes/no question, e.g. "The JD asks for Azure. Have you used it?"')
    importance: Literal["must_have", "nice_to_have"] = "nice_to_have"


class TailorPlan(EditProposal):
    """The tailoring edits for one job description, plus questions about gaps."""

    gaps: list[GapQuestion] = Field(
        default_factory=list, description="Job requirements the profile shows no evidence for."
    )


# ── 4. Chat ───────────────────────────────────────────────────────────────────


class ProfileFact(BaseModel):
    skill: str = Field("", description="A tool or skill name, or empty.")
    item_id: str = Field("", description="The job/project it belongs to, or empty if general.")
    note: str = Field(description="The fact in the candidate's own words, one sentence.")


class ChatDecision(EditProposal):
    """How to respond to one chat message."""

    action: Literal["edit", "answer", "profile_update", "tailor_request"] = Field(
        description="edit = change the resume · answer = reply only · profile_update = record a stated fact · "
        "tailor_request = the message is itself a full job description"
    )
    reply: str = Field(description="One or two friendly sentences saying what you did or answering the question.")
    profile_facts: list[ProfileFact] = Field(
        default_factory=list, description="Only facts the candidate explicitly states in their message."
    )
