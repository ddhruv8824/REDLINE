"""
ai/checkpoints.py
─────────────────────
LangGraph checkpoints: after every step (node) of a graph, LangGraph saves the
graph's whole state. We keep them in SQLite (the backend passes the file path —
backend/data/checkpoints.sqlite), which gives:

- **Memory** — the chat graph reloads its conversation from the last checkpoint
  of the workspace's chat thread, so the AI remembers earlier turns.
- **A run log** — every tailoring run is its own thread; `thread_history` lists
  each step with the data it produced (GET /api/v1/tailor/threads/{id}/history).

A "thread" is one conversation or run, named by `thread_id`, e.g.
    "<workspace>:chat"                → the workspace's chat
    "<workspace>:tailor:<run id>"     → one tailoring run

Only graph *state* is saved. The API key travels in the runtime context, which
LangGraph never checkpoints.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from langchain_core.messages import BaseMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

_saver: BaseCheckpointSaver | None = None
_fallback = InMemorySaver()  # used when the app wasn't started via lifespan (e.g. tests)


@asynccontextmanager
async def open_checkpointer(db_path: Path) -> AsyncIterator[None]:
    """Open the SQLite checkpointer for the app's lifetime (see backend/app/main.py)."""
    global _saver
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        _saver = saver
        try:
            yield
        finally:
            _saver = None


def get_checkpointer() -> BaseCheckpointSaver:
    return _saver or _fallback


def thread_config(thread_id: str) -> dict:
    """The config LangGraph uses to find a thread's checkpoints."""
    return {"configurable": {"thread_id": thread_id}}


# ── Reading a thread back ─────────────────────────────────────────────────────


def _jsonable(value: Any) -> Any:
    """State values → plain JSON (LangChain messages become {role, content})."""
    if isinstance(value, BaseMessage):
        return {"role": value.type, "content": value.content}
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


async def thread_history(graph: Any, thread_id: str) -> list[dict]:
    """Every checkpoint of a thread, oldest first: which step ran, what's next, and the state."""
    steps = []
    async for snapshot in graph.aget_state_history(thread_config(thread_id)):
        steps.append({
            "checkpoint_id": snapshot.config["configurable"].get("checkpoint_id"),
            "step": snapshot.metadata.get("step"),
            "source": snapshot.metadata.get("source"),  # "input" | "loop" | "update"
            "next": list(snapshot.next),  # node(s) that run after this checkpoint
            "created_at": snapshot.created_at,
            "state": _jsonable(snapshot.values),
        })
    return list(reversed(steps))
