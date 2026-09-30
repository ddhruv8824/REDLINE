"""
app/routers/tailor.py
─────────────────────
Redline API — thin HTTP layer. The AI work happens in the top-level ai/ package
(LangChain models + LangGraph graphs); this file only validates requests and streams results.
Every stored resource belongs to a ``workspace`` (the browser's private id).

Endpoints:
    POST /tailor                    → stream a tailoring run (Server-Sent Events)
    POST /tailor/chat               → free-form chat: edit, answer or record a fact (SSE)
    POST /tailor/resume             → upload PDF/DOCX → current_resume + master_profile
    POST /tailor/resume/sample      → load the built-in sample resume (no AI call)
    GET  /tailor/workspace          → saved resume, master profile and version list
    PUT  /tailor/master-profile     → save the master profile
    POST /tailor/versions           → save a tailored version (one per JD)
    GET  /tailor/versions/{id}      → load one version
    GET  /tailor/llm/providers      → provider / model catalogue for AI settings
    POST /tailor/llm/verify         → check a key and list the models it can use
    GET  /tailor/threads/{id}/history → every LangGraph checkpoint of a run or chat

The AI provider, model and (optional) user API key travel in the
X-LLM-Provider / X-LLM-Model / X-LLM-Key headers of each request. The key is
used for that request only; it is never stored or logged.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ai import chat_graph, checkpoints, tailor_graph
from ai.models import LLMConfig, LLMConfigError, describe_providers, list_models, resolve_config
from ai.resume_parser import parse_resume_file

from ..services import assign_ids, build_master_profile, store

router = APIRouter(prefix="/tailor", tags=["Tailor"])

_ALLOWED_EXTENSIONS = {".pdf", ".docx"}
_SAMPLE_RESUME = Path(__file__).resolve().parent.parent / "samples" / "sample_resume.json"
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_THREAD_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}:(chat|tailor:[a-f0-9]{8,32})$")


class TailorRequest(BaseModel):
    workspace: str = "default"
    jd_text: str = Field(..., min_length=50, max_length=30_000)
    current_resume: dict[str, Any]
    master_profile: dict[str, Any]


class ChatRequest(BaseModel):
    workspace: str = "default"  # the chat thread (and its memory) is per workspace
    message: str = Field(..., min_length=1, max_length=30_000)
    resume: dict[str, Any]  # resume as currently displayed
    original: dict[str, Any] | None = None  # uploaded resume (for bullet-count checks)
    master_profile: dict[str, Any]
    jd_analysis: dict[str, Any] | None = None


class WorkspaceRequest(BaseModel):
    workspace: str


class MasterProfileRequest(BaseModel):
    workspace: str
    master_profile: dict[str, Any]


class SaveVersionRequest(BaseModel):
    workspace: str
    version: dict[str, Any]


def llm_config(
    x_llm_provider: str | None = Header(default=None),
    x_llm_model: str | None = Header(default=None),
    x_llm_key: str | None = Header(default=None),
) -> LLMConfig:
    try:
        return resolve_config(x_llm_provider, x_llm_model, x_llm_key)
    except LLMConfigError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _stream(events) -> StreamingResponse:
    async def body():
        async for event in events:
            yield _sse(event)

    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _workspace(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value or ""):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid workspace id.")
    return value


@router.post("", summary="Tailor the resume to a JD (streamed as Server-Sent Events)")
async def tailor(req: TailorRequest, cfg: LLMConfig = Depends(llm_config)) -> StreamingResponse:
    thread_id = f"{_workspace(req.workspace)}:tailor:{uuid.uuid4().hex[:12]}"  # one thread per run
    return _stream(tailor_graph.run(cfg, req.jd_text, req.current_resume, req.master_profile, thread_id))


@router.post("/chat", summary="Chat about the resume: edit, answer, or record a fact (SSE)")
async def chat(req: ChatRequest, cfg: LLMConfig = Depends(llm_config)) -> StreamingResponse:
    thread_id = f"{_workspace(req.workspace)}:chat"  # one remembered conversation per workspace
    return _stream(chat_graph.run(
        cfg, thread_id, req.message, req.resume, req.original or req.resume, req.master_profile, req.jd_analysis,
    ))


@router.post("/resume/sample", summary="Load the built-in sample resume into a workspace")
def load_sample_resume(req: WorkspaceRequest) -> dict:
    """Lets new users try the product before uploading their own resume (no AI call)."""
    resume = assign_ids(json.loads(_SAMPLE_RESUME.read_text(encoding="utf-8")))
    master = build_master_profile(resume)
    try:
        store.save_resume_and_profile(req.workspace, resume, master)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"current_resume": resume, "master_profile": master, "sample": True}


@router.post("/resume", summary="Upload a resume and build current_resume + master_profile")
async def upload_resume(
    workspace: str = Form(...),
    file: UploadFile = File(...),
    cfg: LLMConfig = Depends(llm_config),
) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported file type '{ext}'. Upload a PDF or DOCX.")
    content = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Resume file is larger than 10 MB.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        resume = await parse_resume_file(cfg, tmp_path)
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Could not parse resume: {exc}") from exc
    finally:
        os.unlink(tmp_path)

    if not resume["experience"] and not resume["projects"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Couldn't find any experience or projects in this resume. Is it a text-based PDF?",
        )

    master = build_master_profile(resume)
    try:
        store.save_resume_and_profile(workspace, resume, master)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"current_resume": resume, "master_profile": master}


@router.get("/workspace", summary="Load the saved tailor workspace for a user")
def get_workspace(workspace: str = Query(...)) -> dict:
    try:
        return store.load_workspace(workspace)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.put("/master-profile", summary="Save the master profile")
def put_master_profile(req: MasterProfileRequest) -> dict:
    try:
        store.save_master_profile(req.workspace, req.master_profile)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"ok": True}


@router.post("/versions", summary="Save a tailored resume version")
def post_version(req: SaveVersionRequest) -> dict:
    try:
        return store.save_version(req.workspace, req.version)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/versions/{version_id}", summary="Load one tailored resume version")
def get_version(version_id: str, workspace: str = Query(...)) -> dict:
    try:
        version = store.get_version(workspace, version_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


@router.get("/llm/providers", summary="AI providers and suggested models for the settings UI")
def get_providers() -> dict:
    return {"providers": describe_providers()}


@router.post("/llm/verify", summary="Verify the configured key and list models it can use")
async def verify_llm(cfg: LLMConfig = Depends(llm_config)) -> dict:
    try:
        models = await list_models(cfg)
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc), "models": [], "key_source": cfg.key_source}
    return {
        "ok": True,
        "models": models,
        "model_available": cfg.model in models if models else None,
        "key_source": cfg.key_source,
    }


@router.get("/threads/{thread_id}/history", summary="Every LangGraph checkpoint of a tailoring run or chat")
async def thread_history(thread_id: str) -> dict:
    """The run log: one entry per graph step, with the state saved after it.

    Thread ids look like "<workspace>:chat" or "<workspace>:tailor:<run id>".
    """
    match = _THREAD_RE.match(thread_id)
    if not match:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid thread id.")
    graph_module = chat_graph if match.group(1) == "chat" else tailor_graph
    graph = graph_module.build_graph().compile(checkpointer=checkpoints.get_checkpointer())
    steps = await checkpoints.thread_history(graph, thread_id)
    if not steps:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No checkpoints for this thread.")
    return {"thread_id": thread_id, "steps": steps}
