"use client";

import { useMemo } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { hasFeature, moduleAccess, moduleAllows, moduleCap, type PlanSummary } from "@/lib/billing/plans";

/** Where people see and change their plan. */
export const PLAN_PAGE = "/subscription";

/**
 * The signed-in workspace's plan, for screens to hide or lock what it leaves
 * out. The server checks the same rules; this only keeps people from
 * reaching a refusal.
 */
export function usePlan() {
  const { viewer } = useStudio();
  return useMemo(() => planHelpers(viewer.plan), [viewer.plan]);
}

export function planHelpers(plan: PlanSummary) {
  return {
    plan,
    feature: (key: string) => hasFeature(plan.limits, key),
    access: (moduleRef: string, workflowId?: string) => moduleAccess(plan.limits, moduleRef, workflowId),
    allows: (moduleRef: string, name: string, workflowId?: string) => moduleAllows(plan.limits, moduleRef, name, workflowId),
    cap: (moduleRef: string, name: string, workflowId?: string) => moduleCap(plan.limits, moduleRef, name, workflowId),
  };
}
