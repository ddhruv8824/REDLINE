"""
ai/tailor_graph.py
──────────────────────
Tailoring a resume to a job description, as a LangGraph graph:

    START → analyze_jd → write_edits → review → score → END

    analyze_jd   AI   What does the job want? (ATS keywords + aliases; cached per JD)
    write_edits  AI   Propose edits: bullets, summary, skills, gap questions
    review       code Check each edit against the master profile (flag, don't block)
    score        code Apply the edits and compute the ATS score before → after

Each node receives the current state and returns only the keys it changes;
LangGraph merges them in and saves a checkpoint after every node.

The two AI nodes read the model config from the *runtime context* (never saved);
everything else lives in the *state* (saved to the checkpoint).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime

from app.services import store
from app.services.ats import ats_score
from app.services.patch import apply_changes
from app.services.validation import supported_skill, validate_changes
from . import checkpoints, models, prompts
from .schemas import JDAnalysis, TailorPlan

JD_ANALYSIS_VERSION = "v2"  # bump when the JD-analysis prompt/schema changes, to skip stale cache


# ── State and context ─────────────────────────────────────────────────────────


class TailorState(TypedDict, total=False):
    # inputs
    jd_text: str
    resume: dict  # the resume being tailored (id-tagged JSON)
    master: dict  # the master profile — the candidate's verified facts
    # filled in by the nodes
    jd_analysis: dict  # analyze_jd
    jd_cached: bool  # analyze_jd
    plan: dict  # write_edits — the AI's raw TailorPlan
    changes: list[dict]  # review — edits, each with review warnings
    rejected: list[dict]  # review — edits that couldn't be applied
    gaps: list[dict]  # review — questions about missing requirements
    tailored_resume: dict  # score
    ats: dict  # score — {"before": …, "after": …}


@dataclass
class TailorContext:
    llm: models.LLMConfig  # which model + key; runtime-only, never checkpointed


def status(stage: str, message: str) -> None:
    """Send a live status line to the browser (LangGraph "custom" stream)."""
    get_stream_writer()({"type": "status", "stage": stage, "message": message})


# ── Nodes ─────────────────────────────────────────────────────────────────────


async def analyze_jd(state: TailorState, runtime: Runtime[TailorContext]) -> dict:
    status("analyzing", "Analyzing JD…")
    cache_key = f"{JD_ANALYSIS_VERSION}-{store.jd_hash(state['jd_text'])}"
    if cached := store.get_cached_jd_analysis(cache_key):
        return {"jd_analysis": cached, "jd_cached": True}

    analysis = await models.ask(runtime.context.llm, JDAnalysis, prompts.jd_analysis(state["jd_text"]))
    store.cache_jd_analysis(cache_key, analysis.model_dump())
    return {"jd_analysis": analysis.model_dump(), "jd_cached": False}


async def write_edits(state: TailorState, runtime: Runtime[TailorContext]) -> dict:
    status("tailoring", "Tailoring resume…")
    plan = await models.ask(
        runtime.context.llm,
        TailorPlan,
        prompts.tailoring(state["jd_analysis"], state["resume"], state["master"]),
        temperature=0.2,
    )
    return {"plan": plan.model_dump()}


def review(state: TailorState) -> dict:
    status("validating", "Checking changes against your profile…")
    plan = TailorPlan.model_validate(state["plan"])
    changes, rejected = validate_changes(plan.to_changes(), state["resume"], state["master"], state["jd_analysis"])
    return {"changes": changes, "rejected": rejected, "gaps": _useful_gaps(plan, state["master"])}


def score(state: TailorState) -> dict:
    tailored = apply_changes(state["resume"], state["changes"])
    jd = state["jd_analysis"]
    return {"tailored_resume": tailored, "ats": {"before": ats_score(state["resume"], jd), "after": ats_score(tailored, jd)}}


def _useful_gaps(plan: TailorPlan, master: dict) -> list[dict]:
    """Drop duplicate gap questions and ones the master profile already answers."""
    gaps, seen = [], set()
    for gap in plan.gaps:
        skill = gap.skill.strip()
        if not skill or skill.lower() in seen or supported_skill(master, skill):
            continue
        seen.add(skill.lower())
        gaps.append({"id": f"g{len(gaps) + 1}", "skill": skill, "question": gap.question, "importance": gap.importance})
    return gaps


# ── The graph ─────────────────────────────────────────────────────────────────


def build_graph() -> StateGraph:
    graph = StateGraph(TailorState, context_schema=TailorContext)
    graph.add_node("analyze_jd", analyze_jd)
    graph.add_node("write_edits", write_edits)
    graph.add_node("review", review)
    graph.add_node("score", score)
    graph.add_edge(START, "analyze_jd")
    graph.add_edge("analyze_jd", "write_edits")
    graph.add_edge("write_edits", "review")
    graph.add_edge("review", "score")
    graph.add_edge("score", END)
    return graph


async def run(llm: models.LLMConfig, jd_text: str, resume: dict, master: dict, thread_id: str) -> AsyncIterator[dict]:
    """Run the graph and yield the events the browser expects (status → jd_analysis → result)."""
    graph = build_graph().compile(checkpointer=checkpoints.get_checkpointer())
    config = checkpoints.thread_config(thread_id)
    inputs: TailorState = {"jd_text": jd_text, "resume": resume, "master": master}
    try:
        # "custom" = our status() lines, "updates" = what each node returned
        async for mode, chunk in graph.astream(
            inputs, config, context=TailorContext(llm=llm), stream_mode=["custom", "updates"]
        ):
            if mode == "custom":
                yield chunk
            elif "analyze_jd" in chunk:
                yield {"type": "jd_analysis", "jd_analysis": chunk["analyze_jd"]["jd_analysis"],
                       "cached": chunk["analyze_jd"]["jd_cached"]}

        final: TailorState = (await graph.aget_state(config)).values
        changes = final["changes"]
        summary = next((c["after"] for c in changes if c["op"] == "rewrite_summary"), resume.get("summary", {}).get("text", ""))
        skills = next((c["skills_after"] for c in changes if c["op"] == "update_skills"), resume.get("skills", []))
        yield {
            "type": "result",
            "thread_id": thread_id,
            "jd_hash": store.jd_hash(jd_text),
            "jd_analysis": final["jd_analysis"],
            "summary": summary,
            "changes": changes,
            "rejected": final["rejected"],
            "skills": skills,
            "gaps": final["gaps"],
            "ats": final["ats"],
            "tailored_resume": final["tailored_resume"],
        }
    except Exception as exc:
        yield {"type": "error", "message": str(exc) or exc.__class__.__name__}
