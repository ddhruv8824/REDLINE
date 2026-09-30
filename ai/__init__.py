"""
ai/ — everything that talks to an AI model (LangChain + LangGraph).

    models.py         LangChain chat model for Gemini / OpenAI / Claude / Groq + ask()
    schemas.py        Pydantic classes the models must return (structured output)
    prompts.py        the messages each step sends
    resume_parser.py  uploaded file → resume JSON (one AI call)
    tailor_graph.py   LangGraph: analyze_jd → write_edits → review → score
    chat_graph.py     LangGraph: decide → (record_facts) → review_edits, with memory
    checkpoints.py    SQLite checkpointer: chat memory + a log of every run's steps

    system_prompts/   the long system prompts, as Markdown
    tests/            the graphs run end-to-end with a fake model

The graphs reuse the backend's plain-code checks (review, patching, ATS scoring,
storage) from backend/app/services/ — imported as `app.services`. The backend
imports this package as `ai` (start.py puts the project root on PYTHONPATH).
"""
