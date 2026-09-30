"""Deterministic core: ids, review checks, patching, ATS, extraction, storage, API. (AI flows: test_graphs.py)"""

from __future__ import annotations

import pytest

from ai.models import LLMConfigError, resolve_config
from app.services import apply_changes, assign_ids, ats_score, build_master_profile, store, validate_changes

RAW = {
    "contact": {"name": "Alex"},
    "summary": "Backend developer with Python.",
    "experience": [
        {
            "company": "Acme",
            "title": "SWE",
            "start_date": "2022",
            "end_date": "Present",
            "tools": ["Python", "Docker", "AWS"],
            "bullets": ["Built REST APIs in Python serving 2,000 users", "Containerised services with Docker", "Wrote docs"],
        }
    ],
    "projects": [{"name": "Bot", "tech": ["React"], "bullets": ["Made a chat bot"]}],
    "skills": ["Python", "Docker"],
    "education": [{"institution": "X", "degree": "BCA"}],
}
JD = {
    "company": "Beta",
    "role_title": "Backend Engineer",
    "must_have_skills": ["Python", "AWS", "Kubernetes"],
    "nice_to_have_skills": ["Azure"],
    "keywords": ["REST APIs", "scalable"],
}


@pytest.fixture
def resume():
    return assign_ids(RAW)


@pytest.fixture
def master(resume):
    return build_master_profile(resume)


def by_op(changes, op):
    return [c for c in changes if c["op"] == op]


# ── ids ────────────────────────────────────────────────────────────────────────

def test_ids_are_assigned_in_code(resume):
    assert resume["summary"]["id"] == "summary"
    assert [b["id"] for b in resume["experience"][0]["bullets"]] == ["exp1_b1", "exp1_b2", "exp1_b3"]
    assert resume["projects"][0]["bullets"][0]["id"] == "proj1_b1"
    assert resume["education"][0]["id"] == "edu1"


# ── review checks: flag, don't block ───────────────────────────────────────────

def test_unverified_skill_and_number_are_flagged_not_blocked(resume, master):
    ok, skipped = validate_changes(
        [
            {"op": "rewrite_bullet", "item_id": "exp1", "bullet_id": "exp1_b2",
             "after": "Containerised services with Docker and Kubernetes", "reason": "r"},
            {"op": "add_bullet", "item_id": "exp1", "after": "Cut latency by 40%", "reason": "r"},
        ],
        resume, master, JD,
    )
    assert not skipped
    assert "Kubernetes" in ok[0]["warnings"][0]
    assert "40" in ok[1]["warnings"][0]


def test_soft_phrases_are_not_treated_as_skills(resume, master):
    ok, _ = validate_changes(
        [{"op": "rewrite_summary", "after": "Backend developer building scalable Python APIs with strong client communication.",
          "reason": "r", "keywords_added": ["scalable", "client communication"]}],
        resume, master, JD,
    )
    assert ok[0]["warnings"] == []


def test_backed_changes_have_no_warnings(resume, master):
    ok, _ = validate_changes(
        [{"op": "rewrite_bullet", "item_id": "exp1", "bullet_id": "exp1_b1",
          "after": "Built Python REST APIs on AWS serving 2000 users", "reason": "r", "keywords_added": ["AWS"]}],
        resume, master, JD,
    )
    assert ok[0]["warnings"] == []
    assert ok[0]["before"] == "Built REST APIs in Python serving 2,000 users"


@pytest.mark.parametrize(
    "change, reason",
    [
        ({"op": "rewrite_bullet", "item_id": "edu1", "bullet_id": "x", "after": "y"}, "education"),
        ({"op": "rewrite_bullet", "item_id": "exp1", "bullet_id": "exp1_b1", "company": "Google", "after": "y"}, "protected"),
        ({"op": "rewrite_bullet", "item_id": "exp1", "bullet_id": "nope", "after": "y"}, "unknown bullet"),
        ({"op": "teleport", "item_id": "exp1"}, "unknown operation"),
        ({"op": "reorder_bullets", "item_id": "exp1", "new_order": ["exp1_b9"]}, "unknown or duplicate"),
    ],
)
def test_changes_that_cannot_apply_are_skipped(resume, master, change, reason):
    ok, skipped = validate_changes([{**change, "reason": "r"}], resume, master, JD)
    assert not ok
    assert reason in skipped[0]["rejection_reason"]


def test_partial_reorder_keeps_unlisted_bullets(resume, master):
    ok, _ = validate_changes(
        [{"op": "reorder_bullets", "item_id": "exp1", "new_order": ["exp1_b3"], "reason": "r"}], resume, master, JD
    )
    assert ok[0]["new_order"] == ["exp1_b3", "exp1_b1", "exp1_b2"]


def test_second_add_across_batches_is_flagged(resume, master):
    first = apply_changes(resume, [{"op": "add_bullet", "item_id": "exp1", "new_bullet_id": "exp1_new1", "after": "x"}])
    ok, _ = validate_changes(
        [{"op": "add_bullet", "item_id": "exp1", "after": "Documented APIs", "reason": "r"}],
        first, master, JD, original=resume, id_prefix="e1_", bullet_prefix="e1n",
    )
    assert ok[0]["id"] == "e1_1" and ok[0]["new_bullet_id"] == "exp1_e1n1"
    assert "more than one bullet" in ok[0]["warnings"][0]


# ── patching + ATS ─────────────────────────────────────────────────────────────

def test_apply_changes_is_pure_and_ordered(resume, master):
    ok, _ = validate_changes(
        [
            {"op": "rewrite_bullet", "item_id": "exp1", "bullet_id": "exp1_b1", "after": "Built APIs on AWS", "reason": "r"},
            {"op": "remove_bullet", "item_id": "exp1", "bullet_id": "exp1_b3", "reason": "r"},
            {"op": "update_skills", "skills_after": ["AWS", "Python", "Docker"], "reason": "r"},
        ],
        resume, master, JD,
    )
    tailored = apply_changes(resume, ok)
    assert [b["text"] for b in tailored["experience"][0]["bullets"]] == ["Built APIs on AWS", "Containerised services with Docker"]
    assert tailored["skills"] == ["AWS", "Python", "Docker"]
    assert len(resume["experience"][0]["bullets"]) == 3  # original untouched


def test_ats_score_counts_weighted_keywords(resume):
    before = ats_score(resume, JD)
    assert "Python" in before["matched"] and "Kubernetes" in before["missing"]
    tailored = apply_changes(resume, [{"op": "update_skills", "skills_after": ["Python", "AWS", "Kubernetes"]}])
    assert ats_score(tailored, JD)["score"] > before["score"]


# ── providers + storage ───────────────────────────────────────────────────────

def test_resolve_config_validates_input(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(LLMConfigError):
        resolve_config("openai", None, None)
    with pytest.raises(LLMConfigError):
        resolve_config("nope", None, "k")
    with pytest.raises(LLMConfigError):
        resolve_config("groq", "a b;c", "k")
    cfg = resolve_config("anthropic", None, "sk-ant-x")
    assert cfg.model == "claude-opus-5" and "sk-ant" not in repr(cfg)


def test_store_rejects_unsafe_workspace_ids(monkeypatch, tmp_path):
    monkeypatch.setattr(store, "_WORKSPACES_DIR", tmp_path)
    store.save_master_profile("default", {"notes": "x"})
    assert (tmp_path / "default" / "master_profile.json").exists()
    for bad in ("../etc", "a/b", "", "x" * 65):
        with pytest.raises(ValueError):
            store.save_master_profile(bad, {})
    assert store.get_version("default", "../../secret") is None


def test_sample_resume_loads_into_a_fresh_workspace(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import app

    monkeypatch.setattr(store, "_WORKSPACES_DIR", tmp_path)
    client = TestClient(app)
    empty = client.get("/api/v1/tailor/workspace", params={"workspace": "fresh-1"}).json()
    assert empty["current_resume"] is None and empty["versions"] == []

    r = client.post("/api/v1/tailor/resume/sample", json={"workspace": "fresh-1"})
    assert r.status_code == 200
    resume = r.json()["current_resume"]
    assert resume["contact"]["name"] == "Jordan Rivera"
    assert resume["experience"][0]["bullets"][0]["id"] == "exp1_b1"

    loaded = client.get("/api/v1/tailor/workspace", params={"workspace": "fresh-1"}).json()
    assert loaded["current_resume"]["contact"]["name"] == "Jordan Rivera"
    assert "FastAPI" in loaded["master_profile"]["jobs"][0]["tools"]
    assert client.post("/api/v1/tailor/resume/sample", json={"workspace": "../x"}).status_code == 400


def test_two_column_pdf_text_is_read_column_by_column():
    from app.services.extract import _reflow_columns

    page = "\n".join([
        "Jane Doe - Backend engineer who ships reliable systems and clean APIs for real users",
        "   CONTACT              WORK EXPERIENCE",
        "   jane@example.com     Acme Corp                         2023-Present",
        "   SKILLS               Built the billing API in Python.",
        "   Python               Cut deploy time by 50%.",
        "   Docker               Globex                            2021-2023",
        "   Kafka                Worked as a Frontend Engineer on the dashboard.",
        "   PROJECTS",
        "   Shelfie - a book-tracking app with AI recommendations, used by 1,200 readers.",
    ])
    lines = _reflow_columns(page).splitlines()
    # each column reads straight through instead of interleaving line by line
    assert lines.index("Python") < lines.index("Docker") < lines.index("Kafka")
    acme, globex = lines.index("Acme Corp                         2023-Present"), lines.index("Globex                            2021-2023")
    assert acme < globex and lines[globex + 1].startswith("Worked as a Frontend Engineer")
    assert not any("Docker" in l and "Globex" in l for l in lines)
    # a section heading stays with the full-width text under it
    assert lines.index("PROJECTS") == lines.index(next(l for l in lines if l.startswith("Shelfie"))) - 1


def test_ats_counts_aliases_and_plurals():
    resume = assign_ids({**RAW, "summary": "Built LLM apps and data pipeline tooling.", "skills": ["Python", "K8s"]})
    jd = {
        "must_have_skills": ["Generative AI", "Kubernetes"],
        "nice_to_have_skills": ["AI pipelines"],
        "keywords": ["data pipelines", "Rust"],
        "keyword_aliases": [
            {"term": "Generative AI", "aliases": ["GenAI", "LLM"]},
            {"term": "Kubernetes", "aliases": ["K8s"]},
        ],
    }
    result = ats_score(resume, jd)
    assert "Generative AI" in result["matched"]      # via alias "LLM"
    assert "Kubernetes" in result["matched"]         # via alias "K8s"
    assert "data pipelines" in result["matched"]     # plural of "data pipeline"
    assert "Rust" in result["missing"]
    assert result["groups"]["must_have_skills"] == {"matched": 2, "total": 2}
    # analyses without aliases (cached before v2) still score
    assert ats_score(resume, {k: v for k, v in jd.items() if k != "keyword_aliases"})["score"] >= 0
