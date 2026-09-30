"""
app/services/store.py
────────────────────────
File-backed storage, one folder per workspace:

    data/workspaces/<workspace>/current_resume.json
    data/workspaces/<workspace>/master_profile.json
    data/workspaces/<workspace>/versions/<version_id>.json
    data/jd_cache/<sha256 of JD>.json                 (shared jd_analysis cache)
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Optional

from ..config import DATA_DIR

_ROOT = Path(DATA_DIR)
_JD_CACHE_DIR = _ROOT / "jd_cache"
_WORKSPACES_DIR = _ROOT / "workspaces"
_jd_memory_cache: dict[str, dict] = {}

_VERSION_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _read(path: Path) -> Optional[Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


_WORKSPACE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _workspace_dir(workspace: str) -> Path:
    workspace = (workspace or "").strip()
    if not _WORKSPACE_RE.match(workspace):
        raise ValueError("workspace must be 1–64 letters, digits, '-' or '_'")
    return _WORKSPACES_DIR / workspace


# ── JD analysis cache ──────────────────────────────────────────────────────────

def jd_hash(jd_text: str) -> str:
    normalized = re.sub(r"\s+", " ", jd_text.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def get_cached_jd_analysis(digest: str) -> Optional[dict]:
    if digest in _jd_memory_cache:
        return _jd_memory_cache[digest]
    data = _read(_JD_CACHE_DIR / f"{digest}.json")
    if data is not None:
        _jd_memory_cache[digest] = data
    return data


def cache_jd_analysis(digest: str, analysis: dict) -> None:
    _jd_memory_cache[digest] = analysis
    _write(_JD_CACHE_DIR / f"{digest}.json", analysis)


# ── workspace ──────────────────────────────────────────────────────────────────

def save_resume_and_profile(workspace: str, resume: dict, master_profile: dict) -> None:
    d = _workspace_dir(workspace)
    _write(d / "current_resume.json", resume)
    _write(d / "master_profile.json", master_profile)


def save_master_profile(workspace: str, master_profile: dict) -> None:
    _write(_workspace_dir(workspace) / "master_profile.json", master_profile)


def load_workspace(workspace: str) -> dict:
    d = _workspace_dir(workspace)
    return {
        "current_resume": _read(d / "current_resume.json"),
        "master_profile": _read(d / "master_profile.json"),
        "versions": list_versions(workspace),
    }


def _version_meta(v: dict) -> dict:
    return {k: v.get(k) for k in ("id", "label", "company", "role_title", "created_at", "updated_at")}


def list_versions(workspace: str) -> list[dict]:
    vdir = _workspace_dir(workspace) / "versions"
    if not vdir.exists():
        return []
    versions = [v for v in (_read(p) for p in vdir.glob("*.json")) if isinstance(v, dict)]
    versions.sort(key=lambda v: v.get("updated_at") or v.get("created_at") or "", reverse=True)
    return [_version_meta(v) for v in versions]


def save_version(workspace: str, version: dict) -> dict:
    vid = str(version.get("id") or "")
    if not _VERSION_ID_RE.match(vid):
        raise ValueError("invalid version id")
    _write(_workspace_dir(workspace) / "versions" / f"{vid}.json", version)
    return _version_meta(version)


def get_version(workspace: str, version_id: str) -> Optional[dict]:
    if not _VERSION_ID_RE.match(version_id):
        return None
    return _read(_workspace_dir(workspace) / "versions" / f"{version_id}.json")
