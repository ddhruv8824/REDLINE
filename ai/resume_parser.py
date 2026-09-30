"""
ai/resume_parser.py
───────────────────────
Uploaded resume file → id-tagged resume JSON.

This is a single AI call, so it's a plain function rather than a graph:
    1. load the file (PDF bytes + column-aware text)       backend/app/services/extract.py
    2. ask the model for a ResumeExtraction                 ai/schemas.py
    3. give every job, project and bullet a stable id       backend/app/services/structure.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from app.services.extract import extract_text
from app.services.structure import assign_ids
from . import models, prompts
from .schemas import ResumeExtraction


def load_document(path: Path) -> dict:
    """PDF bytes (for models that read PDFs) plus extracted text (for the rest)."""
    is_pdf = path.suffix.lower() == ".pdf"
    return {
        "mime": "application/pdf" if is_pdf else "text/plain",
        "bytes": path.read_bytes() if is_pdf else b"",
        "text": extract_text(path),
    }


async def parse_resume_file(llm: models.LLMConfig, path: Path) -> dict:
    document = await asyncio.to_thread(load_document, path)  # PDF parsing is blocking work
    if not document["text"].strip() and not models.PROVIDERS[llm.provider]["reads_pdf"]:
        raise RuntimeError("This PDF has no extractable text (is it scanned?). Try Gemini, Claude or OpenAI.")
    extraction = await models.ask(llm, ResumeExtraction, prompts.resume_extraction(llm.provider, document))
    return assign_ids(extraction.model_dump())
