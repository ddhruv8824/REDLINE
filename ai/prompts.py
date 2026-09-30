"""
ai/prompts.py
─────────────────
The messages we send for each AI step. Long system prompts live as Markdown files
in ai/system_prompts/ so they're easy to read and edit; short ones are inline here.

Every builder returns a list of LangChain messages:
    SystemMessage  → instructions (who the model is, the rules)
    HumanMessage   → the data for this request (resume, job, chat message…)
"""

from __future__ import annotations

import base64
import json
from functools import cache
from pathlib import Path
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from .models import PROVIDERS

SYSTEM_PROMPTS = Path(__file__).parent / "system_prompts"


@cache
def _load(name: str) -> str:
    return (SYSTEM_PROMPTS / name).read_text(encoding="utf-8")


def _as_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1)


def _without_contact(doc: dict) -> dict:
    """Contact details aren't needed for tailoring, so don't send them."""
    return {k: v for k, v in doc.items() if k != "contact"}


# ── 1. Resume extraction ──────────────────────────────────────────────────────

RESUME_EXTRACTION_SYSTEM = """\
You copy resumes into structured data. Copy text exactly as written — never rephrase,
never invent. Leave a field empty rather than guessing. If the resume has several
columns, keep each column's content together instead of mixing lines across columns."""


def resume_extraction(provider: str, document: dict) -> list[BaseMessage]:
    """The resume goes in as the PDF itself when the provider can read PDFs,
    otherwise as column-aware extracted text (see backend/app/services/extract.py)."""
    if document["mime"] == "application/pdf" and PROVIDERS[provider]["reads_pdf"]:
        resume_block = {
            "type": "file",  # LangChain's standard file block — translated per provider
            "base64": base64.standard_b64encode(document["bytes"]).decode("ascii"),
            "mime_type": "application/pdf",
            "extras": {"filename": "resume.pdf"},
        }
    else:
        resume_block = {"type": "text", "text": f"Resume text:\n\n{document['text']}"}
    return [
        SystemMessage(RESUME_EXTRACTION_SYSTEM),
        HumanMessage(content=[resume_block, {"type": "text", "text": "Extract this resume."}]),
    ]


# ── 2. Job description analysis ───────────────────────────────────────────────

JD_ANALYSIS_SYSTEM = """\
You analyse job descriptions the way an applicant-tracking system (ATS) does.
Keywords must be things a resume can literally contain: 1–3 words, in the job's own
spelling. Skip vague qualities and soft phrases ("production-ready", "team
collaboration", "fast-paced") — they are not ATS keywords. For every keyword, list
its aliases: abbreviations, expansions, common synonyms, spelling variants."""


def jd_analysis(jd_text: str) -> list[BaseMessage]:
    return [SystemMessage(JD_ANALYSIS_SYSTEM), HumanMessage(f"Job description:\n\n{jd_text}")]


# ── 3. Tailoring ──────────────────────────────────────────────────────────────


def tailoring(jd: dict, resume: dict, master: dict) -> list[BaseMessage]:
    return [
        SystemMessage(_load("jd_resume_tailor_prompt.md")),
        HumanMessage(
            "## jd_analysis\n" + _as_json(jd)
            + "\n\n## current_resume\n" + _as_json(_without_contact(resume))
            + "\n\n## master_profile\n" + _as_json(_without_contact(master))
        ),
    ]


# ── 4. Chat ───────────────────────────────────────────────────────────────────


def chat(resume: dict, master: dict, jd: dict | None, conversation: list[BaseMessage]) -> list[BaseMessage]:
    """System prompt + the current resume/profile/job as context + the conversation so far
    (the conversation comes from the LangGraph checkpoint — see chat_graph.py)."""
    context = (
        "# Context for this conversation (always up to date)\n\n"
        "## resume (as currently shown)\n" + _as_json(_without_contact(resume))
        + "\n\n## master_profile\n" + _as_json(_without_contact(master))
        + "\n\n## jd_analysis\n" + (_as_json(jd) if jd else "none — no job description yet")
    )
    # One system message: some providers reject several.
    return [SystemMessage(_load("resume_chat_prompt.md") + "\n\n" + context), *conversation]
