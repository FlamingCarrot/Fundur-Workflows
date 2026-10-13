"use client";

import useSWR from "swr";
import { useStudio } from "@/components/providers/StudioProvider";
import type { AgendaItem } from "@/lib/autopilot/model";
import type { Inbox } from "@/lib/autopilot/inbox";
import type { AskView, AutopilotPatch, AutopilotState, RunView } from "@/lib/autopilot/store";
import type { Project } from "@/lib/studio/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not load");
  return body as T;
};

/** Her inbox across projects. Only on the server: the demo has no autopilot. */
export function useInbox() {
  const { persistence, viewer } = useStudio();
  const on = persistence === "server" && viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  return useSWR<Inbox>(on ? "/api/inbox" : null, fetcher, { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true });
}

export interface ProjectAutopilot {
  state: AutopilotState;
  agenda: AgendaItem[];
  runs: RunView[];
  asks: AskView[];
  canEdit: boolean;
}

export function useProjectAutopilot(slug: string) {
  const { persistence, viewer } = useStudio();
  const on = persistence === "server" && viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  return useSWR<ProjectAutopilot>(on ? `/api/projects/${encodeURIComponent(slug)}/autopilot` : null, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
    // While a run is going, look again soon.
    refreshInterval: (data) => (data?.state.running ? 5_000 : 60_000),
  });
}

export async function saveAutopilotSettings(slug: string, patch: AutopilotPatch): Promise<AutopilotState> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/autopilot`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not save");
  return body.state;
}

export interface RunProgress {
  /** Tools it is running or ran, in order. */
  steps: { id: string; label: string; status: "running" | "done" | "failed" }[];
  text: string;
}

export type RunEnd =
  | { status: "skipped" | "idle"; reason: string }
  | { status: "done" | "failed"; summary: string; applied: number; review: number; asked: number }
  | { status: "error"; reason: string };

/** Run now, streaming what it does. Changed projects are handed to `onProject` as they are saved. */
export async function runNow(slug: string, onProgress: (p: RunProgress) => void, onProject: (p: Project) => void): Promise<RunEnd> {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/autopilot/run`, { method: "POST" });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    return { status: "error", reason: body.error || "Could not start the autopilot" };
  }
  const progress: RunProgress = { steps: [], text: "" };
  let end: RunEnd = { status: "error", reason: "The run ended without saying how it went" };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "text") progress.text += e.delta;
      else if (e.type === "tool") {
        const at = progress.steps.findIndex((s) => s.id === e.id);
        const step = { id: e.id, label: e.label, status: e.status };
        if (at >= 0) progress.steps[at] = step;
        else progress.steps.push(step);
      } else if (e.type === "project") onProject(e.project);
      else if (e.type === "error") end = { status: "error", reason: e.error };
      else if (e.type === "outcome") end = e.outcome;
      onProgress({ steps: [...progress.steps], text: progress.text });
    }
  }
  return end;
}

export async function answer(askId: string, input: { action: "answer" | "dismiss"; answer?: string; files?: { storageKey: string; name: string }[] }) {
  const res = await fetch(`/api/inbox/asks/${askId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not save your answer");
  return body as { status: string; carryOn: boolean };
}

/** Confirms, dismisses or undoes a change, through the chat's own endpoint. */
export async function resolveChange(slug: string, proposalId: string, action: "apply" | "dismiss" | "undo") {
  const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/chat/proposals/${proposalId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not save that");
  return body as { status: string; project?: Project };
}
