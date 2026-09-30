"""
ai/models.py
────────────────
Everything about *which* AI model we talk to.

    LLMConfig        which provider + model + key a request uses
    resolve_config   build an LLMConfig from the request headers (or server env keys)
    chat_model       LLMConfig → a LangChain chat model (Gemini, OpenAI, Claude or Groq)
    ask              send messages, get back a validated Pydantic object
    list_models      check a key works and list the models it can use

Bring your own key: the user's key arrives per request (X-LLM-Key header) and is
only ever passed to the model object — never stored, logged or checkpointed.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, TypeVar

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from pydantic import BaseModel

# ── Provider catalogue ────────────────────────────────────────────────────────

PROVIDERS: dict[str, dict[str, Any]] = {
    "gemini": {
        "label": "Google Gemini",
        "key_env": ("GEMINI_API_KEY", "API_KEY"),
        "models": ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-pro"],
        "default_model": "gemini-flash-latest",
        "key_url": "https://aistudio.google.com/apikey",
        "key_prefixes": ["AIza", "AQ."],  # classic API keys and newer auth keys
        "reads_pdf": True,
    },
    "openai": {
        "label": "OpenAI",
        "key_env": ("OPENAI_API_KEY",),
        "models": ["gpt-5-mini", "gpt-5", "gpt-4.1-mini"],
        "default_model": "gpt-5-mini",
        "key_url": "https://platform.openai.com/api-keys",
        "key_prefixes": ["sk-"],
        "reads_pdf": True,
    },
    "anthropic": {
        "label": "Anthropic Claude",
        "key_env": ("ANTHROPIC_API_KEY",),
        "models": ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
        "default_model": "claude-opus-5",
        "key_url": "https://console.anthropic.com/settings/keys",
        "key_prefixes": ["sk-ant-"],
        "reads_pdf": True,
    },
    "groq": {
        "label": "Groq",
        "key_env": ("GROQ_API_KEY",),
        "models": ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct"],
        "default_model": "llama-3.3-70b-versatile",
        "key_url": "https://console.groq.com/keys",
        "key_prefixes": ["gsk_"],
        "reads_pdf": False,  # Groq models get the extracted text instead
    },
}

DEFAULT_PROVIDER = "gemini"
_MODEL_RE = re.compile(r"^[A-Za-z0-9._:/\-]{1,100}$")


class LLMConfigError(ValueError):
    """Bad or missing provider / model / key — shown to the user as-is."""


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    model: str
    api_key: str
    key_source: str  # "user" (from the browser) | "server" (from backend/.env)

    def __repr__(self) -> str:  # keep the key out of logs and tracebacks
        return f"LLMConfig(provider={self.provider!r}, model={self.model!r}, key_source={self.key_source!r})"


def _server_key(provider: str) -> str:
    return next((os.environ[n] for n in PROVIDERS[provider]["key_env"] if os.getenv(n)), "")


def describe_providers() -> list[dict[str, Any]]:
    """Provider list for the AI settings dialog (no secrets)."""
    return [
        {
            "id": pid,
            "label": p["label"],
            "models": p["models"],
            "default_model": p["default_model"],
            "key_url": p["key_url"],
            "key_prefixes": p["key_prefixes"],
            "server_key_available": bool(_server_key(pid)),
        }
        for pid, p in PROVIDERS.items()
    ]


def resolve_config(provider: str | None, model: str | None, api_key: str | None) -> LLMConfig:
    provider = (provider or DEFAULT_PROVIDER).strip().lower()
    if provider not in PROVIDERS:
        raise LLMConfigError(f"Unknown AI provider '{provider}'.")
    model = (model or PROVIDERS[provider]["default_model"]).strip()
    if not _MODEL_RE.match(model):
        raise LLMConfigError("Model name contains unsupported characters.")
    key, source = (api_key or "").strip(), "user"
    if not key:
        key, source = _server_key(provider), "server"
    if not key:
        raise LLMConfigError(f"No API key for {PROVIDERS[provider]['label']}. Add your key in AI settings.")
    return LLMConfig(provider=provider, model=model, api_key=key, key_source=source)


# ── LangChain chat models ─────────────────────────────────────────────────────


def chat_model(cfg: LLMConfig, temperature: float = 0.0) -> BaseChatModel:
    """The LangChain chat model for this config. Imports are lazy so unused SDKs aren't loaded."""
    if cfg.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=cfg.model, api_key=cfg.api_key, temperature=temperature)

    if cfg.provider == "openai":
        from langchain_openai import ChatOpenAI

        # Reasoning models (gpt-5*, o-series) only accept their default temperature.
        reasoning = bool(re.match(r"^(gpt-5|o\d)", cfg.model))
        return ChatOpenAI(model=cfg.model, api_key=cfg.api_key, **({} if reasoning else {"temperature": temperature}))

    if cfg.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        # Current Claude models don't accept sampling parameters, so no temperature.
        return ChatAnthropic(model=cfg.model, api_key=cfg.api_key, max_tokens=16000)

    from langchain_groq import ChatGroq

    return ChatGroq(model=cfg.model, api_key=cfg.api_key, temperature=temperature)


Schema = TypeVar("Schema", bound=BaseModel)


async def ask(cfg: LLMConfig, schema: type[Schema], messages: list[BaseMessage], temperature: float = 0.0) -> Schema:
    """Send `messages` and get back a validated `schema` instance.

    `with_structured_output` picks each provider's native way of returning
    structured data (JSON schema for OpenAI / Gemini, tool calling for Claude / Groq).
    """
    model = chat_model(cfg, temperature).with_structured_output(schema)
    try:
        result = await model.ainvoke(messages)
    except Exception as exc:
        raise RuntimeError(friendly_error(cfg, exc)) from exc
    if result is None:
        raise RuntimeError("The model returned no usable answer. Try again or pick another model.")
    return result  # type: ignore[return-value]


def friendly_error(cfg: LLMConfig, exc: Exception) -> str:
    """Turn SDK errors into messages a user can act on."""
    label = PROVIDERS[cfg.provider]["label"]
    text = str(exc)
    lowered = text.lower()
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status in (401, 403) or ("api key" in lowered and ("invalid" in lowered or "incorrect" in lowered)):
        return f"{label} rejected the API key. Check it in AI settings."
    if status == 404 or ("not found" in lowered and "model" in lowered):
        return f"{label} doesn't recognise the model '{cfg.model}' for this key."
    if status == 429 or "rate limit" in lowered or "quota" in lowered:
        return f"{label} rate limit or quota reached. Wait a moment or check your plan."
    return f"{label} error: {text[:300]}"


# ── Key check ─────────────────────────────────────────────────────────────────


async def list_models(cfg: LLMConfig) -> list[str]:
    """Model ids this key can use — doubles as a check that the key works.

    LangChain has no common "list models" call, so this uses each provider's SDK.
    """
    try:
        if cfg.provider == "gemini":
            from google import genai

            # Keep a reference to the client while paging: google-genai closes its
            # connection when the Client object is garbage-collected.
            client = genai.Client(api_key=cfg.api_key)
            async with client.aio as aio:
                pager = await aio.models.list()
                ids = [
                    m.name.removeprefix("models/")
                    async for m in pager
                    if "generateContent" in (getattr(m, "supported_actions", None) or []) and "gemini" in (m.name or "")
                ]
        elif cfg.provider == "anthropic":
            import anthropic

            async with anthropic.AsyncAnthropic(api_key=cfg.api_key) as client:
                ids = [m.id async for m in client.models.list()]
        elif cfg.provider == "groq":
            from groq import AsyncGroq

            async with AsyncGroq(api_key=cfg.api_key) as client:
                ids = [m.id for m in (await client.models.list()).data]
            ids = [i for i in ids if not re.search(r"whisper|tts|guard|playai", i)]
        else:
            from openai import AsyncOpenAI

            async with AsyncOpenAI(api_key=cfg.api_key) as client:
                ids = [m.id async for m in client.models.list()]
            ids = [
                i for i in ids
                if re.match(r"^(gpt-|o\d|chatgpt)", i) and not re.search(r"audio|realtime|transcribe|tts|image|search", i)
            ]
    except Exception as exc:
        raise RuntimeError(friendly_error(cfg, exc)) from exc
    return sorted(set(ids))
