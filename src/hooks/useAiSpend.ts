"use client";

import useSWR from "swr";
import { useStudio } from "@/components/providers/StudioProvider";

export interface CostLine {
  key: string;
  label: string;
  zar: number;
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ToolLine {
  key: string;
  label: string;
  calls: number;
  failed: number;
  avgMs: number;
}

export interface AiSpend {
  costs: {
    totalZar: number;
    totalUsd: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
    failedCalls: number;
    byPhase: CostLine[];
    byTask: CostLine[];
    byTaskType: CostLine[];
    byModel: CostLine[];
    byRole: CostLine[];
    byTool: ToolLine[];
  };
  budget: { budgetZar: number | null; alertPercent: number; pauseAtLimit: boolean; spentZar: number; usedShare: number | null };
  alerts: { id: string; level: "threshold" | "limit"; spendZar: number; budgetZar: number; createdAt: string }[];
  canSetBudget: boolean;
  /** Only the Admin sees money; everyone else sees tokens. */
  showMoney: boolean;
}

const fetcher = async (url: string): Promise<AiSpend> => {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not load AI spend");
  return body;
};

/**
 * A project's AI spend by phase, task, kind of work and model (P4-15), with
 * its budget. Only on the server: the demo has no call log. It refreshes
 * whenever the project's own total moves.
 */
export function useAiSpend(projectId: string, aiSpendZar: number) {
  const { persistence, viewer } = useStudio();
  const key: [string, number] | null =
    persistence === "server" && viewer.workspaceRole !== "collaborator" ? [`/api/projects/${encodeURIComponent(projectId)}/ai`, aiSpendZar] : null;
  return useSWR(key, ([url]: [string, number]) => fetcher(url), { revalidateOnFocus: true, keepPreviousData: true });
}
