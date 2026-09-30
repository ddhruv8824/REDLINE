import { getApiUrl } from "@/lib/api";
import { llmHeaders, type LlmSettings } from "./llm";
import type {
  ChatEvent,
  JdAnalysis,
  MasterProfile,
  Resume,
  ResumeVersion,
  TailorEvent,
  VersionMeta,
  Workspace,
} from "./types";

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    /* not JSON */
  }
  return `Server returned ${res.status}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

export async function getWorkspace(workspace: string): Promise<Workspace> {
  return json(await fetch(getApiUrl(`/api/v1/tailor/workspace?workspace=${encodeURIComponent(workspace)}`)));
}

export async function uploadTailorResume(
  workspace: string,
  file: File,
  llm: LlmSettings,
): Promise<{ current_resume: Resume; master_profile: MasterProfile }> {
  const form = new FormData();
  form.append("workspace", workspace);
  form.append("file", file);
  return json(
    await fetch(getApiUrl("/api/v1/tailor/resume"), { method: "POST", body: form, headers: llmHeaders(llm) }),
  );
}

/** Load the built-in sample resume — lets people try Redline before uploading their own. */
export async function loadSampleResume(
  workspace: string,
): Promise<{ current_resume: Resume; master_profile: MasterProfile }> {
  return json(
    await fetch(getApiUrl("/api/v1/tailor/resume/sample"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    }),
  );
}

export async function saveMasterProfile(workspace: string, masterProfile: MasterProfile): Promise<void> {
  await json(
    await fetch(getApiUrl("/api/v1/tailor/master-profile"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace, master_profile: masterProfile }),
    }),
  );
}

export async function saveVersion(workspace: string, version: ResumeVersion): Promise<VersionMeta> {
  return json(
    await fetch(getApiUrl("/api/v1/tailor/versions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace, version }),
    }),
  );
}

export async function getVersion(workspace: string, id: string): Promise<ResumeVersion> {
  return json(
    await fetch(getApiUrl(`/api/v1/tailor/versions/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`)),
  );
}

/** POST JSON and yield the Server-Sent Events of the response as they arrive. */
async function* streamSse<T>(path: string, body: unknown, llm: LlmSettings, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await fetch(getApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...llmHeaders(llm) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as T;
    }
  }
}

/** Tailor the resume to a JD — POST /api/v1/tailor. */
export function streamTailor(
  body: { workspace: string; jd_text: string; current_resume: Resume; master_profile: MasterProfile },
  llm: LlmSettings,
  signal?: AbortSignal,
): AsyncGenerator<TailorEvent> {
  return streamSse<TailorEvent>("/api/v1/tailor", body, llm, signal);
}

/** Free-form chat request (edit / question / fact) — POST /api/v1/tailor/chat. */
export function streamChat(
  body: {
    /** The chat thread — the backend remembers the conversation per workspace. */
    workspace: string;
    message: string;
    resume: Resume;
    original: Resume;
    master_profile: MasterProfile;
    jd_analysis: JdAnalysis | null;
  },
  llm: LlmSettings,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  return streamSse<ChatEvent>("/api/v1/tailor/chat", body, llm, signal);
}
