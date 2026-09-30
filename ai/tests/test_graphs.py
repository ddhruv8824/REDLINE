"""The LangGraph flows, with the AI replaced by a fake `ask()`.

Real graphs, real checkpoints (SQLite in a temp dir), real review/scoring code —
only the model call is scripted, so these run without an API key.
"""

from __future__ import annotations

import asyncio
import sqlite3

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from ai import chat_graph, checkpoints, models, tailor_graph
from ai.models import resolve_config
from ai.schemas import ChatDecision, JDAnalysis, TailorPlan
from app.services import assign_ids, build_master_profile, store

SECRET = "sk-test-SECRET-KEY-123"
LLM = resolve_config("openai", "gpt-4.1-mini", SECRET)

RESUME = assign_ids({
    "contact": {"name": "Alex"},
    "summary": "Backend developer with Python.",
    "experience": [{
        "company": "Acme", "title": "SWE", "tools": ["Python", "AWS"],
        "bullets": ["Built APIs in Python", "Wrote docs"],
    }],
    "skills": ["Python"],
})
MASTER = build_master_profile(RESUME)
JD = {"company": "Beta", "role_title": "Backend Engineer",
      "must_have_skills": ["Python", "AWS", "Kubernetes"], "nice_to_have_skills": [], "keywords": []}


def fake_ask(answers: dict[type, list]):
    """Replace models.ask: return the next scripted answer for the requested schema."""
    calls: list[type] = []

    async def ask(cfg, schema, messages, temperature=0.0):
        assert cfg.api_key == SECRET  # the key reached the node through the runtime context
        calls.append(schema)
        return schema.model_validate(answers[schema].pop(0))

    return ask, calls


@pytest.fixture
def sqlite_checkpoints(tmp_path, monkeypatch):
    """Run graphs against a real SQLite checkpointer in a temp dir."""
    monkeypatch.setattr(store, "_JD_CACHE_DIR", tmp_path / "jd_cache")
    monkeypatch.setattr(store, "_jd_memory_cache", {})
    db = tmp_path / "checkpoints.sqlite"

    async def run(coro_factory):
        async with AsyncSqliteSaver.from_conn_string(str(db)) as saver:
            monkeypatch.setattr(checkpoints, "_saver", saver)
            return await coro_factory()

    return run, db


async def collect(events):
    return [e async for e in events]


def test_tailor_graph_runs_every_step_and_checkpoints_them(monkeypatch, sqlite_checkpoints):
    run, db = sqlite_checkpoints
    ask, calls = fake_ask({
        JDAnalysis: [JD],
        TailorPlan: [{
            "summary": {"after": "Python developer shipping APIs on AWS.", "reason": "r"},
            "changes": [{"op": "rewrite_bullet", "item_id": "exp1", "bullet_id": "exp1_b1",
                         "after": "Built APIs in Python on AWS", "reason": "r", "keywords_added": ["AWS"]}],
            "gaps": [{"skill": "Kubernetes", "question": "Used Kubernetes?"}, {"skill": "Python", "question": "dup"}],
        }],
    })
    monkeypatch.setattr(models, "ask", ask)

    thread = "ws1:tailor:abc123def456"
    events = asyncio.run(run(lambda: collect(tailor_graph.run(LLM, "JD " * 60, RESUME, MASTER, thread))))

    assert [e["type"] for e in events] == ["status", "jd_analysis", "status", "status", "result"]
    result = events[-1]
    assert calls == [JDAnalysis, TailorPlan]
    assert {c["op"] for c in result["changes"]} == {"rewrite_bullet", "rewrite_summary"}
    assert result["skills"] == ["Python"]  # the plan had no skills list, so skills are unchanged
    assert [g["skill"] for g in result["gaps"]] == ["Kubernetes"]  # Python is already backed by the profile
    assert result["ats"]["after"]["score"] > result["ats"]["before"]["score"]

    # every node left a checkpoint, and the run log reads them back in order
    graph = tailor_graph.build_graph()
    steps = asyncio.run(run(lambda: checkpoints.thread_history(graph.compile(checkpointer=checkpoints.get_checkpointer()), thread)))
    assert [s["next"] for s in steps] == [["__start__"], ["analyze_jd"], ["write_edits"], ["review"], ["score"], []]
    assert steps[-1]["state"]["ats"] == result["ats"]

    # the API key travelled in the runtime context — it is not in the checkpoint database
    assert SECRET.encode() not in db.read_bytes()


def test_jd_analysis_is_cached_per_job_description(monkeypatch, sqlite_checkpoints):
    run, _ = sqlite_checkpoints
    plan = {"changes": []}
    ask, calls = fake_ask({JDAnalysis: [JD], TailorPlan: [plan, plan]})
    monkeypatch.setattr(models, "ask", ask)
    for n in range(2):
        events = asyncio.run(run(lambda: collect(tailor_graph.run(LLM, "Same JD " * 40, RESUME, MASTER, f"ws1:tailor:{n}aaaaaaaa"))))
    assert calls == [JDAnalysis, TailorPlan, TailorPlan]  # second run skipped the analysis
    assert events[1]["cached"] is True


def test_chat_graph_routes_by_action_and_remembers_the_conversation(monkeypatch, sqlite_checkpoints):
    run, db = sqlite_checkpoints
    seen_conversations: list[list[str]] = []
    answers = [
        {"action": "answer", "reply": "Kubernetes is the main gap."},
        {"action": "edit", "reply": "Added.",
         "profile_facts": [{"skill": "Terraform", "item_id": "exp1", "note": "Used Terraform for 12 services"},
                           {"skill": "Azure", "item_id": "exp1", "note": "Cut costs 40% with Azure"}],
         "changes": [{"op": "add_bullet", "item_id": "exp1", "after": "Provisioned 12 services with Terraform",
                      "reason": "r", "keywords_added": ["Terraform"]}]},
    ]

    async def ask(cfg, schema, messages, temperature=0.0):
        assert schema is ChatDecision
        seen_conversations.append([m.content for m in messages[1:]])  # skip the system prompt
        return ChatDecision.model_validate(answers.pop(0))

    monkeypatch.setattr(models, "ask", ask)
    thread = "ws1:chat"
    turn = lambda text: collect(chat_graph.run(LLM, thread, text, RESUME, RESUME, MASTER, JD))  # noqa: E731

    first = asyncio.run(run(lambda: turn("What's missing?")))[-1]
    assert first["action"] == "answer" and first["changes"] == []

    second = asyncio.run(run(lambda: turn("I used Terraform at Acme for 12 services, add it")))[-1]
    # memory: the second turn saw the first question and answer from the checkpoint
    assert seen_conversations[1] == ["What's missing?", "Kubernetes is the main gap.",
                                      "I used Terraform at Acme for 12 services, add it"]
    # routing: edit + facts → record_facts → review_edits
    assert [f["skill"] for f in second["facts_added"]] == ["Terraform"]  # the invented Azure/40% fact was dropped
    assert "Terraform" in second["master_profile"]["jobs"][0]["tools"]
    assert second["changes"][0]["warnings"] == []  # the stated fact backs the new bullet
    assert SECRET.encode() not in db.read_bytes()


def test_run_log_endpoint(monkeypatch, sqlite_checkpoints):
    from fastapi.testclient import TestClient

    import app.main as backend_main

    run, _ = sqlite_checkpoints
    ask, _ = fake_ask({JDAnalysis: [JD], TailorPlan: [{"changes": []}]})
    monkeypatch.setattr(models, "ask", ask)
    thread = "ws2:tailor:0123456789ab"
    asyncio.run(run(lambda: collect(tailor_graph.run(LLM, "JD text " * 40, RESUME, MASTER, thread))))

    # TestClient opens the app's own SQLite checkpointer via lifespan — point it at the test db
    monkeypatch.setattr(backend_main, "CHECKPOINT_DB", sqlite_checkpoints[1])
    with TestClient(backend_main.app) as client:
        body = client.get(f"/api/v1/tailor/threads/{thread}/history").json()
        assert [s["next"] for s in body["steps"]][1:4] == [["analyze_jd"], ["write_edits"], ["review"]]
        assert client.get("/api/v1/tailor/threads/../../etc/history").status_code in (400, 404)
        assert client.get("/api/v1/tailor/threads/ws2:tailor:ffffffffffff/history").status_code == 404
    assert sqlite3.connect(sqlite_checkpoints[1]).execute("select count(*) from checkpoints").fetchone()[0] > 0


def test_gemini_key_check_keeps_the_client_open_while_paging(monkeypatch):
    """google-genai closes its connection when the Client is garbage-collected;
    listing models must keep the client alive until every page is read."""
    import gc

    from google import genai

    state = {"closed": False}

    class FakePager:
        def __init__(self):
            self.names = ["models/gemini-flash-latest", "models/gemini-2.5-pro"]

        def __aiter__(self):
            return self

        async def __anext__(self):
            gc.collect()  # the moment an unreferenced client would be closed
            if state["closed"]:
                raise RuntimeError("Cannot send a request, as the client has been closed.")
            if not self.names:
                raise StopAsyncIteration
            return type("M", (), {"name": self.names.pop(0), "supported_actions": ["generateContent"]})()

    class FakeAio:
        models = type("Models", (), {"list": staticmethod(lambda: _async(FakePager()))})()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            state["closed"] = True

    class FakeClient:
        def __init__(self, api_key):
            self.aio = FakeAio()

        def __del__(self):
            state["closed"] = True

    async def _async(value):
        return value

    monkeypatch.setattr(genai, "Client", FakeClient)
    ids = asyncio.run(models.list_models(resolve_config("gemini", None, "AQ.test-key")))
    assert ids == ["gemini-2.5-pro", "gemini-flash-latest"]
