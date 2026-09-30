// AI provider settings for Redline (bring your own key).
//
// Provider + model are remembered in localStorage. The API key stays in
// sessionStorage (cleared when the tab closes) unless the user ticks
// "Remember on this device". It is sent to our backend per request in the
// X-LLM-Key header and never stored server-side.

import { getApiUrl } from "@/lib/api";

export type ProviderId = "gemini" | "openai" | "anthropic" | "groq";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: string[];
  default_model: string;
  key_url: string;
  /** Known key formats, e.g. Gemini's classic "AIza…" keys and newer "AQ.…" auth keys. */
  key_prefixes: string[];
  server_key_available: boolean;
}

export interface LlmSettings {
  provider: ProviderId;
  model: string;
  apiKey: string;
  rememberKey: boolean;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  models: string[];
  model_available?: boolean | null;
  key_source: "user" | "server";
}

const PREFS_KEY = "redline_llm";
const KEY_PREFIX = "redline_llm_key_";
// Pre-rename keys — moved to the new names once, so saved settings and keys survive.
const LEGACY_PREFS_KEY = "resume_tailor_llm";
const LEGACY_KEY_PREFIX = "resume_tailor_llm_key_";

function migrateLegacyKeys(): void {
  for (const kind of ["local", "session"] as const) {
    const store = storage(kind);
    if (!store) continue;
    try {
      const legacy: Array<[string, string]> = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k === LEGACY_PREFS_KEY) legacy.push([k, PREFS_KEY]);
        else if (k?.startsWith(LEGACY_KEY_PREFIX)) legacy.push([k, KEY_PREFIX + k.slice(LEGACY_KEY_PREFIX.length)]);
      }
      for (const [from, to] of legacy) {
        const value = store.getItem(from);
        if (value !== null && store.getItem(to) === null) store.setItem(to, value);
        store.removeItem(from);
      }
    } catch {
      /* storage unavailable */
    }
  }
}

export const DEFAULT_SETTINGS: LlmSettings = {
  provider: "gemini",
  model: "",
  apiKey: "",
  rememberKey: false,
};

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadLlmSettings(): LlmSettings {
  migrateLegacyKeys();
  try {
    const prefs = JSON.parse(storage("local")?.getItem(PREFS_KEY) ?? "{}");
    const provider: ProviderId = prefs.provider ?? DEFAULT_SETTINGS.provider;
    const saved = storage("local")?.getItem(KEY_PREFIX + provider);
    const session = storage("session")?.getItem(KEY_PREFIX + provider);
    return {
      provider,
      model: prefs.model ?? "",
      apiKey: saved ?? session ?? "",
      rememberKey: !!saved,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Stored key for a provider (used when switching providers in the dialog). */
export function storedKeyFor(provider: ProviderId): { apiKey: string; rememberKey: boolean } {
  try {
    const saved = storage("local")?.getItem(KEY_PREFIX + provider);
    const session = storage("session")?.getItem(KEY_PREFIX + provider);
    return { apiKey: saved ?? session ?? "", rememberKey: !!saved };
  } catch {
    return { apiKey: "", rememberKey: false };
  }
}

export function saveLlmSettings(s: LlmSettings): void {
  try {
    storage("local")?.setItem(PREFS_KEY, JSON.stringify({ provider: s.provider, model: s.model }));
    const k = KEY_PREFIX + s.provider;
    storage("local")?.removeItem(k);
    storage("session")?.removeItem(k);
    if (s.apiKey) storage(s.rememberKey ? "local" : "session")?.setItem(k, s.apiKey);
  } catch {
    /* storage unavailable — settings still live in memory for this page */
  }
}

export function forgetKey(provider: ProviderId): void {
  try {
    storage("local")?.removeItem(KEY_PREFIX + provider);
    storage("session")?.removeItem(KEY_PREFIX + provider);
  } catch {
    /* ignore */
  }
}

export function llmHeaders(s: LlmSettings): Record<string, string> {
  const h: Record<string, string> = { "X-LLM-Provider": s.provider };
  if (s.model) h["X-LLM-Model"] = s.model;
  if (s.apiKey) h["X-LLM-Key"] = s.apiKey;
  return h;
}

export function maskKey(key: string): string {
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await fetch(getApiUrl("/api/v1/tailor/llm/providers"));
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return (await res.json()).providers;
}

export async function verifyLlm(s: LlmSettings): Promise<VerifyResult> {
  const res = await fetch(getApiUrl("/api/v1/tailor/llm/verify"), { method: "POST", headers: llmHeaders(s) });
  if (!res.ok) {
    let detail = `Server returned ${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    return { ok: false, error: detail, models: [], key_source: "user" };
  }
  return res.json();
}
