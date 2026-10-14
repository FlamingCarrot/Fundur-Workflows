"use client";

import useSWR from "swr";
import { useStudio } from "@/components/providers/StudioProvider";
import type { BusinessOverview } from "@/lib/business/overview";
import type { BusinessDoc, BusinessSettings, DocKind, Lead, TimeEntry } from "@/lib/business/model";

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not load");
  return body as T;
};

/** Whether the business side is open to this person: on the server, and the studio's owner (time is everyone's). */
export function useBusinessAccess() {
  const { persistence, viewer } = useStudio();
  const server = persistence === "server";
  return { server, owner: server && (!viewer.workspaceRole || viewer.workspaceRole === "owner"), time: server && viewer.workspaceRole !== "collaborator" };
}

export function useOverview() {
  const { owner } = useBusinessAccess();
  return useSWR<BusinessOverview>(owner ? "/api/business/overview" : null, fetcher, { revalidateOnFocus: true });
}

export function useDocs(kind?: DocKind, project?: string) {
  const { owner } = useBusinessAccess();
  const q = new URLSearchParams();
  if (kind) q.set("kind", kind);
  if (project) q.set("project", project);
  return useSWR<{ docs: BusinessDoc[] }>(owner ? `/api/business/docs?${q}` : null, fetcher, { revalidateOnFocus: true });
}

export function useDoc(id: string) {
  const { owner } = useBusinessAccess();
  return useSWR<{ doc: BusinessDoc; settings: BusinessSettings }>(owner ? `/api/business/docs/${id}` : null, fetcher);
}

export function useLeads() {
  const { owner } = useBusinessAccess();
  return useSWR<{ leads: Lead[] }>(owner ? "/api/business/leads" : null, fetcher, { revalidateOnFocus: true });
}

export function useBusinessSettings() {
  const { owner } = useBusinessAccess();
  return useSWR<{ settings: BusinessSettings; enquiryLink: string }>(owner ? "/api/business/settings" : null, fetcher);
}

export function useTime(opts: { project?: string; all?: boolean } = {}) {
  const { time } = useBusinessAccess();
  const q = new URLSearchParams();
  if (opts.project) q.set("project", opts.project);
  if (opts.all) q.set("all", "1");
  return useSWR<{ entries: TimeEntry[]; running: TimeEntry | null; phase?: { name: string; loggedHours: number; expectedHours: number | null } | null }>(time ? `/api/business/time?${q}` : null, fetcher, { revalidateOnFocus: true });
}

export async function send<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "That didn't save");
  return out as T;
}

export function useExpenses(project?: string) {
  const { time } = useBusinessAccess();
  const q = new URLSearchParams();
  if (project) q.set("project", project);
  return useSWR<{ expenses: import("@/lib/business/model").Expense[] }>(time ? `/api/business/expenses?${q}` : null, fetcher, { revalidateOnFocus: true });
}
