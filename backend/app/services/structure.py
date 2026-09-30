"""
app/services/structure.py
────────────────────────────
Structured resume data → id-tagged resume JSON (``current_resume.json``) and the
initial ``master_profile.json``. The AI extraction itself is in ai/resume_parser.py.

Resume shape
────────────
    {
      "contact":   {name, email, phone, location, linkedin, github, website},
      "summary":   {"id": "summary", "text": str},
      "experience": [{id: "exp1", company, title, location, start_date, end_date,
                      tools: [...], bullets: [{id: "exp1_b1", text}]}],
      "projects":  [{id: "proj1", name, tech: [...], link, start_date, end_date,
                      bullets: [{id: "proj1_b1", text}]}],
      "skills":    [str],
      "education": [{id: "edu1", institution, degree, field_of_study, dates, gpa}],
      "certifications": [str]
    }

Ids are assigned here in code (never by the LLM) so they are stable and unique.
"""

from __future__ import annotations

from typing import Any


def _s(value: Any) -> str:
    return str(value).strip() if value not in (None, "null") else ""


def _str_list(values: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values or []:
        s = _s(v).lstrip("•-–* ").strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def assign_ids(raw: dict) -> dict:
    """Normalise extracted data and give every item and bullet a stable id."""
    contact = raw.get("contact") or {}
    resume: dict[str, Any] = {
        "contact": {k: _s(contact.get(k)) for k in (
            "name", "email", "phone", "location", "linkedin", "github", "website"
        )},
        "summary": {"id": "summary", "text": _s(raw.get("summary"))},
        "experience": [],
        "projects": [],
        "skills": _str_list(raw.get("skills")),
        "education": [],
        "certifications": _str_list(raw.get("certifications")),
    }

    for i, exp in enumerate(raw.get("experience") or [], start=1):
        item_id = f"exp{i}"
        resume["experience"].append({
            "id": item_id,
            "company": _s(exp.get("company")),
            "title": _s(exp.get("title")),
            "location": _s(exp.get("location")),
            "start_date": _s(exp.get("start_date")),
            "end_date": _s(exp.get("end_date")),
            "tools": _str_list(exp.get("tools")),
            "bullets": [
                {"id": f"{item_id}_b{j}", "text": text}
                for j, text in enumerate(_str_list(exp.get("bullets")), start=1)
            ],
        })

    for i, proj in enumerate(raw.get("projects") or [], start=1):
        item_id = f"proj{i}"
        resume["projects"].append({
            "id": item_id,
            "name": _s(proj.get("name")),
            "tech": _str_list(proj.get("tech")),
            "link": _s(proj.get("link")),
            "start_date": _s(proj.get("start_date")),
            "end_date": _s(proj.get("end_date")),
            "bullets": [
                {"id": f"{item_id}_b{j}", "text": text}
                for j, text in enumerate(_str_list(proj.get("bullets")), start=1)
            ],
        })

    for i, edu in enumerate(raw.get("education") or [], start=1):
        resume["education"].append({
            "id": f"edu{i}",
            "institution": _s(edu.get("institution")),
            "degree": _s(edu.get("degree")),
            "field_of_study": _s(edu.get("field_of_study")),
            "dates": _s(edu.get("dates") or edu.get("graduation_date")),
            "gpa": _s(edu.get("gpa")),
        })

    return resume


def build_master_profile(resume: dict) -> dict:
    """Seed the master profile — the candidate's full truth — from a parsed resume."""
    return {
        "contact": dict(resume.get("contact") or {}),
        "jobs": [
            {
                "id": e["id"],
                "company": e["company"],
                "title": e["title"],
                "start_date": e["start_date"],
                "end_date": e["end_date"],
                "bullets": [b["text"] for b in e["bullets"]],
                "tools": list(e.get("tools") or []),
                "notes": "",
            }
            for e in resume.get("experience", [])
        ],
        "projects": [
            {
                "id": p["id"],
                "name": p["name"],
                "bullets": [b["text"] for b in p["bullets"]],
                "tech": list(p.get("tech") or []),
                "notes": "",
            }
            for p in resume.get("projects", [])
        ],
        "education": [dict(e) for e in resume.get("education", [])],
        "certifications": list(resume.get("certifications") or []),
        "confirmed_skills": list(resume.get("skills") or []),
        "summary": (resume.get("summary") or {}).get("text", ""),
        "notes": "",
    }
