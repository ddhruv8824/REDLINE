"""
ai/chat_graph.py
────────────────────
The chat assistant, as a LangGraph graph with a branch:

    START → decide ─┬─ edit ────────────→ (record_facts →) review_edits → END
                    ├─ profile_update ──→ record_facts → END
                    └─ answer / tailor_request ───────→ END

    decide        AI   Read the message + conversation, pick an action, draft a reply
    record_facts  code Save facts the user stated to their master profile
    review_edits  code Check the proposed edits against the profile (flag, don't block)

Memory: the conversation is the `messages` list in the state. Each workspace has
one chat thread ("<workspace>:chat"); LangGraph's checkpointer saves the state
after every turn, so the next turn starts with the whole conversation.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Annotated, AsyncIterator, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.runtime import Runtime

from app.services.profile import apply_profile_facts, facts_user_stated
from app.services.validation import validate_changes
from . import checkpoints, models, prompts
from .schemas import ChatDecision

MAX_HISTORY = 12  # conversation messages the model sees (the checkpoint keeps them all)


# ── State and context ─────────────────────────────────────────────────────────


class ChatState(TypedDict, total=False):
    # the conversation — `add_messages` appends new messages instead of replacing the list
    messages: Annotated[list[AnyMessage], add_messages]
    # context, refreshed every turn
    resume: dict  # the resume as currently shown
    original: dict  # the uploaded resume (bullet-count checks compare against it)
    master: dict
    jd_analysis: dict | None
    # this turn's results
    decision: dict  # decide — the AI's ChatDecision
    facts_added: list[dict]  # record_facts
    master_updated: dict | None  # record_facts — profile including the new facts
    changes: list[dict]  # review_edits
    rejected: list[dict]  # review_edits


@dataclass
class ChatContext:
    llm: models.LLMConfig  # runtime-only, never checkpointed


# ── Nodes ─────────────────────────────────────────────────────────────────────


async def decide(state: ChatState, runtime: Runtime[ChatContext]) -> dict:
    get_stream_writer()({"type": "status", "stage": "thinking", "message": "Working on it…"})
    conversation = state["messages"][-MAX_HISTORY:]
    decision = await models.ask(
        runtime.context.llm,
        ChatDecision,
        prompts.chat(state["resume"], state["master"], state.get("jd_analysis"), conversation),
        temperature=0.2,
    )
    return {
        "decision": decision.model_dump(),
        "messages": [AIMessage(decision.reply)],  # remembered for the next turn
        # clear last turn's results so they don't leak into this one
        "facts_added": [],
        "master_updated": None,
        "changes": [],
        "rejected": [],
    }


def record_facts(state: ChatState) -> dict:
    user_message = next(m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage))
    stated = facts_user_stated(state["decision"]["profile_facts"], str(user_message))
    updated, added = apply_profile_facts(state["master"], stated)
    return {"facts_added": added, "master_updated": updated if added else None}


def review_edits(state: ChatState) -> dict:
    decision = ChatDecision.model_validate(state["decision"])
    batch = secrets.token_hex(2)  # unique ids, so this turn's edits never clash with earlier ones
    changes, rejected = validate_changes(
        decision.to_changes(),
        state["resume"],
        state.get("master_updated") or state["master"],
        state.get("jd_analysis") or {},
        original=state.get("original") or state["resume"],
        id_prefix=f"e{batch}_",
        bullet_prefix=f"e{batch}n",
    )
    return {"changes": changes, "rejected": rejected}


# ── Routing (the branches after each node) ────────────────────────────────────


def after_decide(state: ChatState) -> str:
    decision = state["decision"]
    if decision["action"] in ("edit", "profile_update") and decision["profile_facts"]:
        return "record_facts"
    if decision["action"] == "edit":
        return "review_edits"
    return END


def after_facts(state: ChatState) -> str:
    return "review_edits" if state["decision"]["action"] == "edit" else END


# ── The graph ─────────────────────────────────────────────────────────────────


def build_graph() -> StateGraph:
    graph = StateGraph(ChatState, context_schema=ChatContext)
    graph.add_node("decide", decide)
    graph.add_node("record_facts", record_facts)
    graph.add_node("review_edits", review_edits)
    graph.add_edge(START, "decide")
    graph.add_conditional_edges("decide", after_decide, ["record_facts", "review_edits", END])
    graph.add_conditional_edges("record_facts", after_facts, ["review_edits", END])
    graph.add_edge("review_edits", END)
    return graph


async def run(
    llm: models.LLMConfig,
    thread_id: str,
    message: str,
    resume: dict,
    original: dict,
    master: dict,
    jd_analysis: dict | None,
) -> AsyncIterator[dict]:
    """One chat turn. Yields a status event, then the result the browser expects."""
    graph = build_graph().compile(checkpointer=checkpoints.get_checkpointer())
    config = checkpoints.thread_config(thread_id)
    inputs: ChatState = {
        "messages": [HumanMessage(message)],  # appended to the saved conversation
        "resume": resume,
        "original": original,
        "master": master,
        "jd_analysis": jd_analysis,
    }
    try:
        async for chunk in graph.astream(inputs, config, context=ChatContext(llm=llm), stream_mode="custom"):
            yield chunk

        final: ChatState = (await graph.aget_state(config)).values
        decision = final["decision"]
        result = {
            "type": "result",
            "thread_id": thread_id,
            "action": decision["action"],
            "reply": decision["reply"].strip(),
            "changes": final.get("changes") or [],
            "rejected": final.get("rejected") or [],
            "facts_added": final.get("facts_added") or [],
        }
        if final.get("master_updated"):
            result["master_profile"] = final["master_updated"]
        yield result
    except Exception as exc:
        yield {"type": "error", "message": str(exc) or exc.__class__.__name__}
