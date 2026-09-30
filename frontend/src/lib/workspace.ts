// Every browser gets its own private workspace — a random id kept in localStorage —
// so nobody opens the app to someone else's resume. `?workspace=<id>` opens a
// specific one (that's how "Copy link to this workspace" works).

const STORAGE_KEY = "redline_workspace";
const WORKSPACE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function resolveWorkspace(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("workspace")?.trim() ?? "";
  if (WORKSPACE_RE.test(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && WORKSPACE_RE.test(saved)) return saved;
    const id = newId();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return newId(); // storage blocked — a fresh workspace for this visit
  }
}

/** Switch this browser to a brand-new, empty workspace (the old one stays saved). */
export function startNewWorkspace(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, newId());
  } catch {
    /* storage blocked — reload still gives a fresh id */
  }
  window.location.assign(window.location.pathname);
}

/** A link that reopens this workspace in any browser. */
export function workspaceLink(workspace: string): string {
  return `${window.location.origin}${window.location.pathname}?workspace=${encodeURIComponent(workspace)}`;
}
