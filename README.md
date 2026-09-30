# Redline

Paste a job description, get your resume tailored to it — with every edit shown as a
reviewable card, the resume re-rendered live, and a clean PDF to download. Every AI edit is a
redline you accept or reject.

- **Tailor to a JD** — the AI analyses the JD (cached per JD), rewrites/reorders/adds/removes
  bullets, rewrites the summary and skills, and asks about gaps ("The JD asks for Azure — have you used it?").
- **Chat** — "rewrite my intro for this role", "what's missing?", "I used Terraform at Acme for 12 services".
- **Review** — accept/reject each change; edits stay highlighted on the paper preview.
  Unverified skills or numbers are flagged (not blocked) against your **master profile**.
- **Versions** — one per JD, switchable from a dropdown; download any as PDF.
- **Bring your own AI** — Gemini, OpenAI, Claude or Groq; the user's key stays in the browser.

## Run it

Requirements: Python 3.11+, Node 20.19+.

```bash
python start.py
```

Opens the API on http://127.0.0.1:8100 (docs at `/docs`) and the app on http://127.0.0.1:5173.
First run creates `backend/.venv` and installs npm packages. Then open **AI settings** in the
app, pick a provider and paste your key.

Or run the parts separately. The backend imports the `ai/` package, so the project root
goes on `PYTHONPATH` (`start.py` does this for you):

```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
PYTHONPATH=.. .venv/Scripts/python -m uvicorn app.main:app --port 8100
```

```bash
cd frontend && npm install && npm run dev
```

Tests (backend and ai): `cd backend && .venv/Scripts/pip install -r requirements-dev.txt && .venv/Scripts/python -m pytest`

## Layout

Three parts, side by side:

```
redline/
├── start.py                   dev launcher (backend + frontend, restarts the API on changes)
│
├── ai/                        AI — LangChain models + LangGraph graphs
│   ├── models.py              chat model per provider + ask() (structured output)
│   ├── schemas.py             Pydantic classes the model must return
│   ├── prompts.py             the messages each step sends
│   ├── system_prompts/        the long system prompts, as Markdown
│   ├── resume_parser.py       resume file → resume JSON (one AI call)
│   ├── tailor_graph.py        LangGraph: analyze_jd → write_edits → review → score
│   ├── chat_graph.py          LangGraph: decide → (record_facts) → review_edits, with memory
│   ├── checkpoints.py         SQLite checkpointer: chat memory + run logs
│   ├── requirements.txt       LangChain / LangGraph / provider packages
│   └── tests/                 the graphs run end-to-end with a fake model
│
├── backend/                   API — FastAPI, plain code, storage
│   ├── app/
│   │   ├── main.py            app, CORS, opens the checkpoint DB
│   │   ├── config.py          env settings (DATA_DIR, CORS)
│   │   ├── routers/tailor.py  HTTP endpoints — validate, call ai/, stream results
│   │   ├── services/          deterministic code, no AI
│   │   │   ├── validation.py  review checks (flag unverified claims, skip impossible edits)
│   │   │   ├── patch.py       apply changes to resume JSON (mirrored in the frontend)
│   │   │   ├── ats.py         ATS keyword score (mirrored in the frontend)
│   │   │   ├── structure.py   ids for every item/bullet + the initial master profile
│   │   │   ├── profile.py     add user-stated facts to the master profile
│   │   │   ├── extract.py     column-aware PDF/DOCX text extraction
│   │   │   └── store.py       JSON files per workspace
│   │   └── samples/           the "Try a sample" resume
│   ├── data/                  workspaces + checkpoints.sqlite (gitignored)
│   ├── .venv/                 one virtualenv for backend and ai
│   └── tests/
│
└── frontend/                  UI — Vite + React + Tailwind v4
```

**Who calls whom:** `frontend → backend (HTTP) → ai (graphs) → backend/app/services (plain checks)`.
The `ai/` graphs reuse the backend's plain-code checks rather than duplicating them.

## How it works

### The AI layer: LangChain + LangGraph

- **LangChain** gives one interface over four providers. `ai/models.py → chat_model()`
  returns `ChatGoogleGenerativeAI`, `ChatOpenAI`, `ChatAnthropic` or `ChatGroq`, and
  `ask()` calls `model.with_structured_output(SomeSchema)` so every answer comes back
  as a validated Pydantic object (`ai/schemas.py`).
- **LangGraph** runs the multi-step flows as graphs of small functions ("nodes"). Each
  node gets the current **state** and returns the keys it changes.

**Tailoring** (`ai/tailor_graph.py`):

```
START → analyze_jd → write_edits → review → score → END
          (AI)          (AI)        (code)   (code)
```

**Chat** (`ai/chat_graph.py`) branches on what you asked:

```
START → decide ─┬─ edit ───────────→ (record_facts →) review_edits → END
                ├─ profile_update ─→ record_facts → END
                └─ answer ─────────────────────────────────────────→ END
```

### Checkpoints

After every node, LangGraph saves the full state to `backend/data/checkpoints.sqlite`
(`ai/checkpoints.py`). A **thread** is one conversation or run:

- `<workspace>:chat` — the chat. Each turn reloads the conversation from the last
  checkpoint, so the assistant remembers earlier messages.
- `<workspace>:tailor:<run id>` — one tailoring run. Open **Run log** on a result (or
  `GET /api/v1/tailor/threads/<thread id>/history`) to see every step and the data it
  produced.

The API key is passed as LangGraph **runtime context**, which is never checkpointed —
only state is saved (the tests check the key never reaches the database).

### The request flow

1. **Upload** → `POST /api/v1/tailor/resume` → `ai/resume_parser.py` sends the PDF itself
   (Gemini, OpenAI, Claude) or column-aware text (Groq) and gets a `ResumeExtraction`;
   `backend/app/services/structure.py` gives every item and bullet a stable id and seeds the
   **master profile** (your verified facts).
2. **Paste a JD** → `POST /api/v1/tailor` streams Server-Sent Events from the tailor graph:
   `status` lines → `jd_analysis` → `result` (changes, gaps, ATS before/after, thread id).
3. **Anything shorter** → `POST /api/v1/tailor/chat` runs one turn of the chat graph.
4. The frontend applies changes as a **patch** to the original resume JSON, so rejecting
   one re-applies the rest. The PDF is always rendered from JSON — the upload is never edited.

**Review checks** (`backend/app/services/validation.py`) flag numbers or hard skills your master
profile doesn't show, bullets over 30 words and more than ±1 bullet per item. Only edits
that can't apply (unknown ids, education/contact edits) are skipped.

## AI providers & keys

The provider, model and optional key travel per request in `X-LLM-Provider`, `X-LLM-Model`,
`X-LLM-Key`. The key is used for that request only and never stored or logged. In the
browser it lives in `sessionStorage` (or `localStorage` with "Remember on this device").
Without a user key the server falls back to `GEMINI_API_KEY` / `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY` / `GROQ_API_KEY` from `backend/.env` (see `.env.example`).

Models are called through LangChain (`ai/models.py`); structured output uses each provider's native method (JSON schema for OpenAI and Gemini, tool calling for Claude and Groq).

## Workspaces

Each browser gets its own private workspace: a random id created on first visit and
kept in `localStorage`, so nobody opens the app to someone else's resume. New visitors
land on a welcome screen — connect an AI model, then upload a resume or **try the
built-in sample** (a fictional profile in `backend/app/samples/`, no AI call needed).

The header's **Workspace** menu copies a link back to the current workspace
(`?workspace=<id>`, works from any browser) or starts a fresh one; old workspaces stay
saved. Files live in `backend/data/workspaces/<id>/`: `current_resume.json`,
`master_profile.json`, `versions/*.json`. The id is the only key — there are no accounts
yet — so keep workspace links private.

## Design

"Architectural Monolith": ink chrome around a light paper resume, one coral accent, Sora /
Manrope / JetBrains Mono, hairline borders. Tokens are `am-*` in `frontend/src/index.css`
(`bg-am-ink`, `text-am-coral`, `border-am-border`, `rounded-am-lg`, `font-am-mono`, …) —
use those rather than raw colours. Printing prints only the resume (`#resume-document`).
