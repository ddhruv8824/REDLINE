"""
app/config.py
─────────────
Settings for the Redline backend. Values come from environment variables,
optionally loaded from ``backend/.env``.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # python-dotenv is optional
    pass

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Per-workspace resumes, master profiles, versions and the JD-analysis cache.
# RESUME_TAILOR_DATA_DIR is the pre-rename name, still honoured.
DATA_DIR = Path(os.getenv("REDLINE_DATA_DIR") or os.getenv("RESUME_TAILOR_DATA_DIR") or BACKEND_DIR / "data")

# Browser origins allowed to call the API. Any localhost / 127.0.0.1 port is allowed
# by default (the dev server may not get 5173); add deployed origins via CORS_ORIGINS.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
