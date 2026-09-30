import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  storedKeyFor,
  verifyLlm,
  type LlmSettings,
  type ProviderId,
  type ProviderInfo,
  type VerifyResult,
} from "@/lib/tailor/llm";

const CUSTOM = "__custom__";

interface AiSettingsDialogProps {
  providers: ProviderInfo[];
  settings: LlmSettings;
  onSave: (settings: LlmSettings) => void;
  onForgetKey: (provider: ProviderId) => void;
  onClose: () => void;
}

export function AiSettingsDialog({ providers, settings, onSave, onForgetKey, onClose }: AiSettingsDialogProps) {
  const [draft, setDraft] = useState<LlmSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loadedModels, setLoadedModels] = useState<Record<string, string[]>>({});

  const provider = providers.find((p) => p.id === draft.provider) ?? providers[0];
  const model = draft.model || provider?.default_model || "";
  const modelOptions = useMemo(() => {
    const list = [...(provider?.models ?? []), ...(loadedModels[draft.provider] ?? [])];
    return [...new Set(list)];
  }, [provider, loadedModels, draft.provider]);
  const [customModel, setCustomModel] = useState(!modelOptions.includes(model));

  if (!provider) return null;

  const choose = (id: ProviderId) => {
    if (id === draft.provider) return;
    const stored = storedKeyFor(id);
    setDraft({ provider: id, model: "", apiKey: stored.apiKey, rememberKey: stored.rememberKey });
    setCustomModel(false);
    setResult(null);
  };

  const effective: LlmSettings = { ...draft, model };
  const canUse = !!draft.apiKey.trim() || provider.server_key_available;

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await verifyLlm(effective);
      setResult(r);
      if (r.ok && r.models.length) setLoadedModels((m) => ({ ...m, [draft.provider]: r.models }));
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message, models: [], key_source: "user" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-am-xl border border-am-border bg-am-ink shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="AI settings"
      >
        <header className="flex items-start justify-between gap-4 border-b border-am-border px-6 py-4">
          <div>
            <h3 className="flex items-center gap-2 font-am-display text-lg font-semibold text-am-canvas">
              <KeyRound className="h-4 w-4" /> AI settings
            </h3>
            <p className="text-xs text-am-muted">
              Pick the AI that parses and tailors your resume, and use your own API key.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-am-md p-1 text-am-muted hover:bg-am-accent">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Provider */}
          <div>
            <p className="mb-2 font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted">Provider</p>
            <div className="grid grid-cols-2 gap-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p.id)}
                  className={cn(
                    "rounded-am-lg border px-3 py-2.5 text-left transition-colors",
                    p.id === draft.provider
                      ? "border-am-coral bg-am-surface ring-1 ring-am-coral"
                      : "border-am-border bg-am-surface/50 hover:bg-am-accent",
                  )}
                >
                  <span className="block text-sm font-semibold text-am-canvas">{p.label}</span>
                  <span className="block text-[11px] text-am-muted">
                    {p.server_key_available ? "Server key available" : "Needs your key"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* API key */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="llm-key" className="font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted">
                {provider.label} API key {provider.server_key_available && <span className="font-normal text-am-muted">(optional)</span>}
              </label>
              <a
                href={provider.key_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-am-muted hover:text-am-canvas"
              >
                Get a key <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex items-center gap-2 rounded-am-md border border-am-border bg-am-surface px-3 focus-within:border-am-coral">
              <input
                id="llm-key"
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, apiKey: e.target.value }));
                  setResult(null);
                }}
                placeholder={
                  provider.server_key_available ? "Leave empty to use the server's key" : `${provider.key_prefixes[0] ?? ""}…`
                }
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent py-2 font-mono text-xs text-am-canvas outline-none placeholder:font-sans placeholder:text-am-muted"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="text-am-muted hover:text-am-canvas"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {draft.apiKey && provider.key_prefixes.length > 0 && !provider.key_prefixes.some((p) => draft.apiKey.trim().startsWith(p)) && (
              <p className="mt-1 text-[11px] text-am-coral">
                {provider.label} keys usually start with {provider.key_prefixes.map((p) => `“${p}”`).join(" or ")}. Check you pasted the right one.
              </p>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs text-am-canvas">
              <input
                type="checkbox"
                checked={draft.rememberKey}
                onChange={(e) => setDraft((d) => ({ ...d, rememberKey: e.target.checked }))}
              />
              Remember key on this device
            </label>
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-am-muted">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
              Your key stays in this browser ({draft.rememberKey ? "saved until you remove it" : "cleared when you close the tab"}
              ). It&apos;s sent to the Redline server only to make each request and is never stored there.
            </p>
          </div>

          {/* Model */}
          <div>
            <label htmlFor="llm-model" className="mb-1.5 block font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted">
              Model
            </label>
            <select
              id="llm-model"
              value={customModel ? CUSTOM : model}
              onChange={(e) => {
                const v = e.target.value;
                if (v === CUSTOM) {
                  setCustomModel(true);
                } else {
                  setCustomModel(false);
                  setDraft((d) => ({ ...d, model: v }));
                }
                setResult(null);
              }}
              className="w-full rounded-am-md border border-am-border bg-am-surface px-3 py-2 text-xs text-am-canvas"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === provider.default_model ? "  (recommended)" : ""}
                </option>
              ))}
              <option value={CUSTOM}>Custom model id…</option>
            </select>
            {customModel && (
              <input
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value.trim() }))}
                placeholder="e.g. gemini-2.5-flash"
                className="mt-2 w-full rounded-am-md border border-am-border bg-am-surface px-3 py-2 font-mono text-xs text-am-canvas"
              />
            )}
            {!loadedModels[draft.provider] && (
              <p className="mt-1 text-[11px] text-am-muted">
                Test the connection to load every model your key can use.
              </p>
            )}
          </div>

          {/* Test */}
          <div className="rounded-am-lg border border-am-border bg-am-surface/50 p-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={test}
                disabled={testing || !canUse || !model}
                className="flex items-center gap-1.5 rounded-am-md border border-am-coral px-3 py-1.5 font-am-mono text-[10px] font-medium uppercase tracking-[0.12em] text-am-muted hover:bg-am-accent disabled:opacity-50"
              >
                {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Test connection
              </button>
              {result &&
                (result.ok ? (
                  <span className="flex items-center gap-1.5 text-xs text-am-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Connected{result.key_source === "server" ? " with the server's key" : ""} ·{" "}
                    {result.models.length} models
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-am-destructive">
                    <XCircle className="h-4 w-4 shrink-0" />
                    {result.error}
                  </span>
                ))}
            </div>
            {result?.ok && result.model_available === false && (
              <p className="mt-2 text-[11px] text-am-coral">
                “{model}” isn&apos;t in this key&apos;s model list — pick one from the dropdown.
              </p>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-am-border px-6 py-3">
          {settings.apiKey && settings.provider === draft.provider && (
            <button
              type="button"
              onClick={() => {
                onForgetKey(draft.provider);
                setDraft((d) => ({ ...d, apiKey: "", rememberKey: false }));
                setResult(null);
              }}
              className="rounded-am-md px-3 py-2 text-xs font-medium text-am-destructive hover:bg-am-destructive/10"
            >
              Remove saved key
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-am-md px-4 py-2 text-xs font-medium text-am-muted hover:bg-am-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave({ ...effective, apiKey: draft.apiKey.trim() })}
              disabled={!canUse || !model}
              className="rounded-am-md bg-am-coral px-4 py-2 text-xs font-semibold text-am-ink disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
