"""
app/main.py
───────────
Redline API — FastAPI application.

    uvicorn app.main:app --reload --port 8100      (run from backend/)
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ai.checkpoints import open_checkpointer

from .config import CORS_ORIGIN_REGEX, CORS_ORIGINS, DATA_DIR
from .routers import tailor

CHECKPOINT_DB = DATA_DIR / "checkpoints.sqlite"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # LangGraph checkpoints (chat memory + run logs) — see ai/checkpoints.py
    async with open_checkpointer(CHECKPOINT_DB):
        yield

app = FastAPI(
    lifespan=lifespan,
    title="Redline API",
    version="0.1.0",
    description=(
        "Parse a resume into id-tagged JSON, tailor it to a job description with the "
        "AI provider of your choice, and chat about edits. See /docs."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tailor.router, prefix="/api/v1")


@app.get("/api/v1/health", tags=["Health"])
def health() -> dict:
    return {"status": "ok", "service": "redline"}
