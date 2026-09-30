import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  getVersion,
  getWorkspace,
  loadSampleResume,
  saveMasterProfile,
  saveVersion,
  streamChat,
  streamTailor,
  uploadTailorResume,
} from "@/lib/tailor/api";
import {
  fetchProviders,
  forgetKey,
  loadLlmSettings,
  saveLlmSettings,
  type LlmSettings,
  type ProviderId,
  type ProviderInfo,
} from "@/lib/tailor/llm";
import { atsScore, hasKeywords } from "@/lib/tailor/ats";
import { applyActiveChanges, highlightIdsFor } from "@/lib/tailor/patch";
import type {
  ChangeStatus,
  JdAnalysis,
  Gap,
  MasterProfile,
  Resume,
  ResumeVersion,
  TailorChange,
  VersionMeta,
} from "@/lib/tailor/types";
import { AiSettingsDialog } from "./AiSettingsDialog";
import { AnimatedNumber } from "./AnimatedNumber";
import type { KeywordTarget } from "./AtsPanel";
import { Onboarding } from "./Onboarding";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { SplitHandle } from "./SplitHandle";
import { ChatPanel, type ChatMessage } from "./ChatPanel";
import { MasterProfileDialog } from "./MasterProfileDialog";
import { ResumePreview } from "./ResumePreview";
import type { GapConfirmation } from "./TailorResultMessage";
import { AmButton, MonoLabel } from "./ui";

const HIGHLIGHT_MS = 4000;
const EMPTY_JD: JdAnalysis = { company: "", role_title: "", must_have_skills: [], nice_to_have_skills: [], keywords: [] };
const JD_MARKERS =
  /responsibilit|requirements|qualifications|what you.ll do|about the role|job description|we are looking|must.have|nice.to.have|years of experience/i;

/** A pasted JD gets the full tailoring run; anything else is a chat request. */
function looksLikeJd(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words >= 120 || (words >= 40 && JD_MARKERS.test(text));
}
const ORIGINAL = "original";
const CHAT_WIDTH_KEY = "redline_chat_width";
const LEGACY_CHAT_WIDTH_KEY = "resume_tailor_chat_width"; // pre-rename
const CHAT_DEFAULT = 460;
const CHAT_MIN = 340;
const PREVIEW_MIN = 420;

let msgSeq = 0;
const nextId = () => `m${Date.now().toString(36)}${(msgSeq++).toString(36)}`;

interface WorkspaceProps {
  /** Storage key on the backend — "default" unless ?workspace=… is in the URL. */
  workspace: string;
}

function resumeStats(r: Resume) {
  const parts = [
    `${r.experience.length} role${r.experience.length === 1 ? "" : "s"}`,
    `${r.projects.length} project${r.projects.length === 1 ? "" : "s"}`,
    `${r.skills.length} skills`,
  ];
  return parts.join(", ");
}

export function Workspace({ workspace }: WorkspaceProps) {
  const [loading, setLoading] = useState(true);
  const [currentResume, setCurrentResume] = useState<Resume | null>(null);
  const [masterProfile, setMasterProfile] = useState<MasterProfile | null>(null);
  const [versionMetas, setVersionMetas] = useState<VersionMeta[]>([]);
  const [versions, setVersions] = useState<Record<string, ResumeVersion>>({});
  const [activeId, setActiveId] = useState<string>(ORIGINAL);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [showEdits, setShowEdits] = useState(true);
  const [chatWidth, setChatWidth] = useState(() => {
    try {
      const saved = Number(
        window.localStorage.getItem(CHAT_WIDTH_KEY) ?? window.localStorage.getItem(LEGACY_CHAT_WIDTH_KEY),
      );
      return saved > 0 ? saved : CHAT_DEFAULT;
    } catch {
      return CHAT_DEFAULT;
    }
  });
  const [splitWidth, setSplitWidth] = useState(0);
  const splitRef = useRef<HTMLDivElement>(null);

  // Keep the chat width valid as the workspace resizes (re-attach once the split view mounts).
  const hasResume = currentResume !== null;
  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSplitWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, hasResume]);
  const chatMax = Math.max(CHAT_MIN, (splitWidth || 1440) - PREVIEW_MIN);
  const chatW = Math.min(Math.max(chatWidth, CHAT_MIN), chatMax);
  const commitChatWidth = (w: number) => {
    try {
      window.localStorage.setItem(CHAT_WIDTH_KEY, String(Math.round(w)));
    } catch {
      /* storage unavailable */
    }
  };
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmSettings>(loadLlmSettings);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [aiOpen, setAiOpen] = useState(false);

  const highlightTimer = useRef<number | undefined>(undefined);
  const saveTimers = useRef<Record<string, number>>({});
  const versionsRef = useRef(versions);
  useLayoutEffect(() => {
    versionsRef.current = versions;
  });

  const push = useCallback((m: ChatMessage) => setMessages((ms) => [...ms, m]), []);
  const say = useCallback(
    (text: string, tone?: "error") =>
      push({ id: nextId(), role: "assistant", kind: "text", text, tone, animate: tone !== "error" }),
    [push],
  );

  const flash = useCallback((ids: string[]) => {
    window.clearTimeout(highlightTimer.current);
    setHighlight(new Set(ids));
    highlightTimer.current = window.setTimeout(() => setHighlight(new Set()), HIGHLIGHT_MS);
  }, []);

  // ── API reachability ────────────────────────────────────────────────────────
  // Bumped by "Retry" to re-run the initial loads below.
  const [attempt, setAttempt] = useState(0);
  const [apiDown, setApiDown] = useState(false);

  // ── AI provider settings ──────────────────────────────────────────────────
  useEffect(() => {
    fetchProviders()
      .then((list) => {
        setProviders(list);
        setApiDown(false);
      })
      .catch(() => setApiDown(true));
  }, [attempt]);

  const openAiSettings = () => {
    if (providers.length) setAiOpen(true);
    else setAttempt((n) => n + 1); // providers never loaded — retry (banner explains if it fails)
  };

  const providerInfo = providers.find((p) => p.id === llm.provider);
  const aiReady = !!providerInfo && (!!llm.apiKey || providerInfo.server_key_available);
  const aiModel = llm.model || providerInfo?.default_model || "";
  const activeLlm = useMemo<LlmSettings>(() => ({ ...llm, model: aiModel }), [llm, aiModel]);
  const aiLabel = providerInfo ? `${providerInfo.label.replace(/^(Google|Anthropic) /, "")} · ${aiModel}` : "AI";

  const handleSaveAi = (next: LlmSettings) => {
    saveLlmSettings(next);
    setLlm(next);
    setAiOpen(false);
    const label = providers.find((p) => p.id === next.provider)?.label ?? next.provider;
    say(`Using ${label} · ${next.model}${next.apiKey ? " with your API key" : " with the server's key"}.`);
  };

  const handleForgetKey = (provider: ProviderId) => {
    forgetKey(provider);
    if (provider === llm.provider) setLlm((s) => ({ ...s, apiKey: "", rememberKey: false }));
  };

  // ── load workspace ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    getWorkspace(workspace)
      .then((ws) => {
        if (cancelled) return;
        setCurrentResume(ws.current_resume);
        setMasterProfile(ws.master_profile);
        setVersionMetas(ws.versions);
        if (ws.current_resume) {
          say(
            `Welcome back. Your resume is loaded (${resumeStats(ws.current_resume)}).` +
              (ws.versions.length ? ` You have ${ws.versions.length} tailored version(s) in the dropdown.` : "") +
              "\n\nPaste a job description to tailor it, or ask me for a specific change.",
          );
        }
      })
      .catch(() => !cancelled && setApiDown(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspace, say, attempt]);

  useEffect(
    () => () => {
      window.clearTimeout(highlightTimer.current);
      Object.values(saveTimers.current).forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  // ── versions ────────────────────────────────────────────────────────────────
  const persistVersion = useCallback(
    (version: ResumeVersion, immediate = false) => {
      window.clearTimeout(saveTimers.current[version.id]);
      const run = () =>
        saveVersion(workspace, version)
          .then((meta) => setVersionMetas((ms) => [meta, ...ms.filter((m) => m.id !== meta.id)]))
          .catch((err) => say(`Couldn't save this version: ${err.message}`, "error"));
      if (immediate) run();
      else saveTimers.current[version.id] = window.setTimeout(run, 600);
    },
    [workspace, say],
  );

  const updateVersion = useCallback(
    (id: string, fn: (v: ResumeVersion) => ResumeVersion) => {
      const current = versionsRef.current[id];
      if (!current) return;
      const next = { ...fn(current), updated_at: new Date().toISOString() };
      setVersions((vs) => ({ ...vs, [id]: next }));
      persistVersion(next);
    },
    [persistVersion],
  );

  const displayedResume = useMemo(() => {
    if (activeId === ORIGINAL) return currentResume;
    const v = versions[activeId];
    return v ? applyActiveChanges(v.base_resume, v.changes, v.statuses) : currentResume;
  }, [activeId, versions, currentResume]);

  /** Everything edited in the version on screen — marked on the paper until rejected. */
  const changedIds = useMemo(() => {
    const v = activeId === ORIGINAL ? undefined : versions[activeId];
    if (!v) return new Set<string>();
    // Reorders touch every bullet of an item — they only flash when shown, or the whole job lights up.
    return new Set(
      v.changes
        .filter((c) => v.statuses[c.id] !== "rejected" && c.op !== "reorder_bullets")
        .flatMap(highlightIdsFor),
    );
  }, [activeId, versions]);

  const selectVersion = async (id: string) => {
    if (id === ORIGINAL) {
      setActiveId(ORIGINAL);
      return;
    }
    let version = versionsRef.current[id];
    if (!version) {
      try {
        version = await getVersion(workspace, id);
        setVersions((vs) => ({ ...vs, [id]: version }));
      } catch (err) {
        say(`Couldn't load that version: ${(err as Error).message}`, "error");
        return;
      }
    }
    setActiveId(id);
    setMessages((ms) =>
      ms.some((m) => m.kind === "result" && m.versionId === id)
        ? ms
        : [...ms, { id: nextId(), role: "assistant", kind: "result", versionId: id }],
    );
  };

  // ── upload ──────────────────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setUploading(true);
    setOnboardingError(null);
    try {
      const { current_resume, master_profile } = await uploadTailorResume(workspace, file, activeLlm);
      let master = master_profile;
      if (masterProfile) {
        // Keep what the user added to their profile across re-uploads.
        const skills = [...master.confirmed_skills];
        for (const s of masterProfile.confirmed_skills)
          if (!skills.some((x) => x.toLowerCase() === s.toLowerCase())) skills.push(s);
        master = { ...master, confirmed_skills: skills, notes: masterProfile.notes || master.notes };
        await saveMasterProfile(workspace, master);
      }
      setCurrentResume(current_resume);
      setMasterProfile(master);
      setActiveId(ORIGINAL);
      setMessages([]);
      say(
        `Parsed your resume: ${resumeStats(current_resume)}. I've also built your master profile from it — ` +
          "add anything that isn't on the resume there.\n\nNow paste a job description to tailor it — or just ask, e.g. “rewrite my intro for backend roles”.",
      );
    } catch (err) {
      const message = `Couldn't read that resume: ${(err as Error).message}`;
      if (currentResume) say(message, "error");
      else setOnboardingError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleSample = async () => {
    setLoadingSample(true);
    setOnboardingError(null);
    try {
      const { current_resume, master_profile } = await loadSampleResume(workspace);
      setCurrentResume(current_resume);
      setMasterProfile(master_profile);
      setActiveId(ORIGINAL);
      setMessages([]);
      say(
        `This is a sample resume for ${current_resume.contact.name}, a fictional software engineer, so you can see how Redline works.` +
          "\n\nPaste any job description to tailor it, or ask for a change like “make the summary more backend-focused”." +
          " When you're ready, use Replace (top right) to upload your own resume.",
      );
    } catch (err) {
      setOnboardingError(`Couldn't load the sample: ${(err as Error).message}`);
    } finally {
      setLoadingSample(false);
    }
  };

  // ── tailoring ───────────────────────────────────────────────────────────────
  const runTailor = useCallback(
    async (jdText: string, master: MasterProfile) => {
      if (!currentResume) return;
      setBusy(true);
      const runStatusIds: string[] = [];
      const setStatusText = (id: string, text: string, done = false) =>
        setMessages((ms) => ms.map((m) => (m.id === id && m.kind === "status" ? { ...m, text, done } : m)));
      const finishStatuses = () =>
        setMessages((ms) => ms.map((m) => (runStatusIds.includes(m.id) && m.kind === "status" ? { ...m, done: true } : m)));
      // On failure, drop the step that was in flight so it doesn't show a ✓.
      const dropPendingStatus = () =>
        setMessages((ms) => ms.filter((m) => !(runStatusIds.includes(m.id) && m.kind === "status" && !m.done)));
      const newStatus = (text: string) => {
        finishStatuses();
        const id = nextId();
        runStatusIds.push(id);
        push({ id, role: "assistant", kind: "status", text, done: false });
        return id;
      };

      let analyzingId = "";
      let tailoringId = "";
      try {
        for await (const ev of streamTailor(
          { workspace, jd_text: jdText, current_resume: currentResume, master_profile: master },
          activeLlm,
        )) {
          if (ev.type === "status") {
            const id = newStatus(ev.message);
            if (ev.stage === "analyzing") analyzingId = id;
            if (ev.stage === "tailoring") tailoringId = id;
          } else if (ev.type === "jd_analysis") {
            const role = [ev.jd_analysis.role_title, ev.jd_analysis.company].filter(Boolean).join(" at ");
            setStatusText(analyzingId, `Analyzed JD${role ? ` — ${role}` : ""}${ev.cached ? " (cached)" : ""}`, true);
          } else if (ev.type === "progress") {
            setStatusText(tailoringId, `Tailoring resume… ${(ev.chars / 1000).toFixed(1)}k chars`);
          } else if (ev.type === "error") {
            dropPendingStatus();
            say(`Tailoring failed: ${ev.message}`, "error");
          } else if (ev.type === "result") {
            finishStatuses();
            const id = ev.jd_hash.slice(0, 16);
            const previous = versionsRef.current[id];
            const now = new Date().toISOString();
            const a = ev.jd_analysis;
            const droppedChatEdits = previous?.changes.filter((c) => c.origin === "chat").length ?? 0;
            const version: ResumeVersion = {
              id,
              label: [a.company, a.role_title].filter(Boolean).join(" — ") || `JD ${id.slice(0, 6)}`,
              company: a.company,
              role_title: a.role_title,
              created_at: previous?.created_at ?? now,
              updated_at: now,
              jd_text: jdText,
              jd_hash: ev.jd_hash,
              jd_analysis: a,
              base_resume: currentResume,
              changes: ev.changes,
              statuses: {},
              rejected: ev.rejected,
              gaps: ev.gaps,
              gap_answers: {},
              thread_id: ev.thread_id,
            };
            setVersions((vs) => ({ ...vs, [id]: version }));
            versionsRef.current = { ...versionsRef.current, [id]: version };
            persistVersion(version, true);
            setActiveId(id);
            // One result card per version: a re-run replaces the old card.
            setMessages((ms) => [
              ...ms.filter((m) => !(m.kind === "result" && m.versionId === id)),
              { id: nextId(), role: "assistant", kind: "result", versionId: id },
            ]);
            flash(ev.changes.flatMap(highlightIdsFor));
            if (droppedChatEdits)
              say(`Re-tailoring replaced ${droppedChatEdits} earlier chat edit(s) for this JD — ask again if you still want them.`);
          }
        }
      } catch (err) {
        dropPendingStatus();
        say(`Tailoring failed: ${(err as Error).message}`, "error");
      } finally {
        setBusy(false);
      }
    },
    [currentResume, flash, persistVersion, push, say, activeLlm, workspace],
  );

  // ── chat requests ───────────────────────────────────────────────────────────
  const runChat = async (text: string, versionId: string = activeId) => {
    if (!currentResume || !masterProfile) return;
    const version = versionId === ORIGINAL ? undefined : versionsRef.current[versionId];
    const shown = version ? applyActiveChanges(version.base_resume, version.changes, version.statuses) : currentResume;
    setBusy(true);
    const statusId = nextId();
    push({ id: statusId, role: "assistant", kind: "status", text: "Working on it…", done: false });
    const dropStatus = () => setMessages((ms) => ms.filter((m) => m.id !== statusId));

    try {
      for await (const ev of streamChat(
        {
          workspace,
          message: text,
          resume: shown,
          original: version?.base_resume ?? currentResume,
          master_profile: masterProfile,
          jd_analysis: version?.jd_analysis?.role_title || version?.jd_analysis?.must_have_skills?.length ? version.jd_analysis : null,
        },
        activeLlm,
      )) {
        if (ev.type === "error") {
          dropStatus();
          say(`Couldn't do that: ${ev.message}`, "error");
        } else if (ev.type === "result") {
          dropStatus();
          if (ev.action === "tailor_request") {
            await runTailor(text, masterProfile);
            return;
          }
          if (ev.master_profile) {
            try {
              await saveMasterProfile(workspace, ev.master_profile);
              setMasterProfile(ev.master_profile);
            } catch (err) {
              say(`Couldn't save your profile: ${(err as Error).message}`, "error");
            }
          }
          if (ev.reply) say(ev.reply);

          let versionId = version?.id ?? "";
          if (ev.changes.length) {
            const chatChanges = ev.changes.map((c) => ({ ...c, origin: "chat" as const }));
            if (version) {
              updateVersion(version.id, (v) => ({ ...v, changes: [...v.changes, ...chatChanges] }));
            } else {
              const now = new Date().toISOString();
              const created: ResumeVersion = {
                id: `edits_${Date.now().toString(36)}`,
                label: "Custom edits",
                company: "",
                role_title: "",
                created_at: now,
                updated_at: now,
                jd_text: "",
                jd_hash: "",
                jd_analysis: EMPTY_JD,
                base_resume: currentResume,
                changes: chatChanges,
                statuses: {},
                rejected: [],
                gaps: [],
                gap_answers: {},
              };
              versionsRef.current = { ...versionsRef.current, [created.id]: created };
              setVersions((vs) => ({ ...vs, [created.id]: created }));
              persistVersion(created, true);
              versionId = created.id;
            }
            setActiveId(versionId);
            flash(chatChanges.flatMap(highlightIdsFor));
          }
          if (ev.changes.length || ev.rejected.length || ev.facts_added.length) {
            push({
              id: nextId(),
              role: "assistant",
              kind: "edits",
              versionId,
              changeIds: ev.changes.map((c) => c.id),
              rejected: ev.rejected,
              facts: ev.facts_added,
            });
          }
        }
      }
    } catch (err) {
      dropStatus();
      say(`Couldn't do that: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  /** "Add these missing keywords to …" from the ATS panel → a chat edit request. */
  const handleAddKeywords = (versionId: string, keywords: string[], target: KeywordTarget) => {
    if (!keywords.length || busy) return;
    if (!aiReady) {
      openAiSettings();
      return;
    }
    const list = keywords.map((k) => `"${k}"`).join(", ");
    const where =
      target.kind === "summary"
        ? "my professional summary"
        : target.kind === "skills"
          ? "my skills list"
          : `the bullets of ${target.label}`;
    const text =
      `Add these job keywords to ${where}: ${list}. ` +
      "Use the job's exact wording and keep it truthful to my experience.";
    setActiveId(versionId);
    push({ id: nextId(), role: "user", kind: "text", text });
    void runChat(text, versionId);
  };

  const handleSend = (text: string) => {
    push({ id: nextId(), role: "user", kind: "text", text });
    if (!masterProfile) return;
    if (looksLikeJd(text)) void runTailor(text, masterProfile);
    else void runChat(text);
  };

  // ── change review ───────────────────────────────────────────────────────────
  const handleSetStatus = (versionId: string, changeId: string, status: ChangeStatus) => {
    setActiveId(versionId);
    updateVersion(versionId, (v) => ({ ...v, statuses: { ...v.statuses, [changeId]: status } }));
    const change = versionsRef.current[versionId]?.changes.find((c) => c.id === changeId);
    if (change && status !== "rejected") flash(highlightIdsFor(change));
  };

  const handleAcceptAll = (versionId: string) => {
    setActiveId(versionId);
    updateVersion(versionId, (v) => ({
      ...v,
      statuses: {
        ...v.statuses,
        ...Object.fromEntries(
          v.changes
            .filter((c) => c.origin !== "chat")
            .map((c) => [c.id, v.statuses[c.id] === "rejected" ? "rejected" : "accepted"]),
        ),
      },
    }));
  };

  const handleShowChange = (versionId: string, change: TailorChange) => {
    setActiveId(versionId);
    setActiveChangeId(change.id);
    setShowEdits(true);
    flash(highlightIdsFor(change));
  };

  // ── gaps ────────────────────────────────────────────────────────────────────
  const handleGapYes = async (versionId: string, gap: Gap, { itemId, note }: GapConfirmation) => {
    const version = versionsRef.current[versionId];
    if (!masterProfile || !version) return;
    const hasSkill = (list: string[]) => list.some((s) => s.toLowerCase() === gap.skill.toLowerCase());
    const fact = `${gap.skill}: ${note}`;
    const appendNote = (notes: string) => (notes ? `${notes}\n${fact}` : fact);
    const next: MasterProfile = {
      ...masterProfile,
      confirmed_skills: hasSkill(masterProfile.confirmed_skills)
        ? masterProfile.confirmed_skills
        : [...masterProfile.confirmed_skills, gap.skill],
      jobs: masterProfile.jobs.map((j) =>
        j.id === itemId ? { ...j, tools: hasSkill(j.tools) ? j.tools : [...j.tools, gap.skill], notes: appendNote(j.notes) } : j,
      ),
      projects: masterProfile.projects.map((p) =>
        p.id === itemId ? { ...p, tech: hasSkill(p.tech) ? p.tech : [...p.tech, gap.skill], notes: appendNote(p.notes) } : p,
      ),
      notes: itemId ? masterProfile.notes : appendNote(masterProfile.notes),
    };

    const where =
      next.jobs.find((j) => j.id === itemId)?.company ?? next.projects.find((p) => p.id === itemId)?.name ?? "";
    push({ id: nextId(), role: "user", kind: "text", text: `Yes — I've used ${gap.skill}${where ? ` at ${where}` : ""}. ${note}` });

    try {
      await saveMasterProfile(workspace, next);
    } catch (err) {
      say(`Couldn't save your profile: ${(err as Error).message}`, "error");
      return;
    }
    setMasterProfile(next);
    updateVersion(versionId, (v) => ({ ...v, gap_answers: { ...v.gap_answers, [gap.id]: "yes" } }));
    say(`Added ${gap.skill} to your master profile. Re-tailoring with it…`);
    await runTailor(version.jd_text, next);
  };

  const handleGapNo = (versionId: string, gap: Gap) => {
    updateVersion(versionId, (v) => ({ ...v, gap_answers: { ...v.gap_answers, [gap.id]: "no" } }));
  };

  // ── profile, download, interview ────────────────────────────────────────────
  const handleSaveProfile = async (profile: MasterProfile) => {
    setSavingProfile(true);
    try {
      await saveMasterProfile(workspace, profile);
      setMasterProfile(profile);
      setProfileOpen(false);
      say("Master profile saved. Paste a JD (or the same one again) to tailor with the new facts.");
    } catch (err) {
      say(`Couldn't save your profile: ${(err as Error).message}`, "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDownload = async () => {
    if (!displayedResume) return;
    setDownloading(true);
    try {
      const { renderResumePdf } = await import("@/lib/renderPdf");
      const blob = await renderResumePdf(displayedResume);
      const url = URL.createObjectURL(blob);
      const v = activeId === ORIGINAL ? null : versions[activeId];
      const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(displayedResume.contact.name || "resume")}${v?.company ? `_${slug(v.company)}` : ""}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      say(`Couldn't generate the PDF: ${(err as Error).message}`, "error");
    } finally {
      setDownloading(false);
    }
  };

  const shownVersion = activeId === ORIGINAL ? undefined : versions[activeId];
  const liveAts =
    shownVersion && displayedResume && hasKeywords(shownVersion.jd_analysis)
      ? atsScore(displayedResume, shownVersion.jd_analysis).score
      : null;

  const toolbar = currentResume && (
    <div className="flex flex-wrap items-center gap-2">
      {liveAts !== null && (
        <span
          className="inline-flex h-7 items-center gap-1.5 rounded-am-md border border-am-coral/35 px-2.5 font-am-mono text-[10px] uppercase tracking-[0.12em] text-am-muted"
          title="ATS keyword match of the resume in the preview"
        >
          ATS
          <span className="font-am-display text-sm font-bold normal-case tracking-normal text-am-coral">
            <AnimatedNumber value={liveAts} />%
          </span>
        </span>
      )}
      <select
        value={activeId}
        onChange={(e) => void selectVersion(e.target.value)}
        aria-label="Resume version"
        className="h-7 max-w-[220px] rounded-am-md border border-am-input bg-am-surface px-2 font-am-body text-xs text-am-canvas outline-none transition-colors duration-150 focus:border-am-coral"
      >
        <option value={ORIGINAL}>Original resume</option>
        {versionMetas.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <label
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-am-md border border-am-border px-2.5 text-xs font-semibold text-am-canvas transition-colors duration-150 hover:bg-am-accent",
          (uploading || busy) && "pointer-events-none opacity-40",
        )}
        title="Upload a new resume"
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
        Replace
        <input
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          disabled={uploading || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
      </label>
      <AmButton variant="coral" size="sm" onClick={handleDownload} disabled={downloading}>
        {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Download PDF
      </AmButton>
    </div>
  );

  return (
    <div className="am-workspace flex h-screen flex-col bg-am-ink font-am-body text-am-canvas">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-am-border px-6">
        <span className="font-am-display text-lg font-bold tracking-tight">
          REDLINE<span className="text-am-coral">.</span>
        </span>
        <nav className="hidden items-center gap-1 text-[13px] text-am-muted md:flex">
          <span>Resume</span>
          <span className="px-1 text-am-muted/50">/</span>
          <WorkspaceMenu workspace={workspace} />
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            onClick={openAiSettings}
            title="AI settings"
            className="hidden max-w-[280px] items-center gap-2 font-am-mono text-[10px] uppercase tracking-[0.12em] text-am-muted transition-colors duration-150 hover:text-am-canvas sm:flex"
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", aiReady ? "bg-am-success" : "bg-am-coral")} />
            <span className="truncate">{aiReady ? aiLabel : "AI not connected"}</span>
          </button>
        </div>
      </header>

      {apiDown && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-am-destructive/30 bg-am-destructive/10 px-6 py-2.5 text-[13px] text-am-canvas"
        >
          <WifiOff className="h-4 w-4 shrink-0 text-am-coral" />
          <span>
            Can&apos;t reach the Redline API at <span className="font-am-mono text-xs">{getApiUrl("")}</span>. Start it
            with <span className="font-am-mono text-xs">python start.py</span> in <span className="font-am-mono text-xs">redline/</span>, then retry.
          </span>
          <AmButton variant="outline" size="sm" className="ml-auto" onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </AmButton>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-am-coral" />
          <MonoLabel>Loading workspace</MonoLabel>
        </div>
      ) : !currentResume ? (
        <>
          {onboardingError && (
            <div
              role="alert"
              className="border-b border-am-destructive/30 bg-am-destructive/10 px-6 py-2.5 text-[13px] text-am-canvas"
            >
              {onboardingError}
            </div>
          )}
          <Onboarding
            aiReady={aiReady}
            aiLabel={aiLabel}
            uploading={uploading}
            loadingSample={loadingSample}
            onConnectAi={openAiSettings}
            onUpload={handleUpload}
            onSample={handleSample}
          />
        </>
      ) : (
        <div
          ref={splitRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
          style={{ "--chat-w": `${chatW}px` } as React.CSSProperties}
        >
          <div className="h-[85vh] min-h-0 shrink-0 border-b border-am-border lg:h-auto lg:w-[var(--chat-w)] lg:border-b-0">
            <ChatPanel
              messages={messages}
              versions={versions}
              masterProfile={masterProfile}
              hasResume={!!currentResume}
              busy={busy}
              aiReady={aiReady}
              activeChangeId={activeChangeId}
              onSend={handleSend}
              onOpenProfile={() => setProfileOpen(true)}
              onOpenAiSettings={openAiSettings}
              onSetStatus={handleSetStatus}
              onAcceptAll={handleAcceptAll}
              onShowChange={handleShowChange}
              onGapYes={handleGapYes}
              onGapNo={handleGapNo}
              onAddKeywords={handleAddKeywords}
            />
          </div>
          <SplitHandle
            width={chatW}
            min={CHAT_MIN}
            max={chatMax}
            defaultWidth={CHAT_DEFAULT}
            getOffset={() => splitRef.current?.getBoundingClientRect().left ?? 0}
            onChange={setChatWidth}
            onCommit={commitChatWidth}
          />
          <div className="h-[90vh] min-h-0 min-w-0 flex-1 lg:h-auto">
            <ResumePreview
              resume={displayedResume}
              changed={changedIds}
              focus={highlight}
              showEdits={showEdits}
              onToggleEdits={setShowEdits}
              toolbar={toolbar}
              emptyState={
                <div className="mx-auto flex min-h-[600px] max-w-[800px] items-center justify-center rounded-am-sm border border-dashed border-am-border">
                  <MonoLabel>Your resume appears here</MonoLabel>
                </div>
              }
            />
          </div>
        </div>
      )}

      {aiOpen && providers.length > 0 && (
        <AiSettingsDialog
          providers={providers}
          settings={activeLlm}
          onSave={handleSaveAi}
          onForgetKey={handleForgetKey}
          onClose={() => setAiOpen(false)}
        />
      )}
      {profileOpen && masterProfile && (
        <MasterProfileDialog
          profile={masterProfile}
          saving={savingProfile}
          onClose={() => setProfileOpen(false)}
          onSave={handleSaveProfile}
        />
      )}
    </div>
  );
}
