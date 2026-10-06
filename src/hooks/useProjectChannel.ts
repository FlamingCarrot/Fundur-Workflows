"use client";

import { useCallback } from "react";
import { useRealtimeChannel } from "./useRealtimeChannel";
import { useStudio } from "@/components/providers/StudioProvider";
import type { Brief, WaitingOn } from "@/lib/studio/types";

/**
 * Live sync for one project: applies collaborators' changes as they arrive and
 * broadcasts local ones, so nobody needs to reload. The sender saves each
 * change, so received ones are only shown here, not saved again.
 */
export function useProjectChannel(projectId: string, options: { onBriefPatch?: (patch: Brief) => void } = {}) {
  const { setCheck, setWaitingOn, applyRemoteCheck, applyRemoteWaitingOn, applyRemoteBrief } = useStudio();
  const { onBriefPatch } = options;

  const { status, broadcast } = useRealtimeChannel({
    projectId,
    onEvent: (event) => {
      if (event.type === "TASK_TOGGLED") {
        const { taskId, done } = event.data as { taskId: string; done: boolean };
        applyRemoteCheck(projectId, taskId, done);
      }
      if (event.type === "WAITING_ON_TOGGLED") {
        applyRemoteWaitingOn(projectId, event.data as WaitingOn);
      }
      if (event.type === "RECORD_AUTOSAVED") {
        // Only the fields the collaborator changed, so fields being edited here are left alone.
        const patch = event.data as Brief;
        onBriefPatch?.(patch);
        applyRemoteBrief(projectId, patch);
      }
    },
  });

  const toggleCheck = useCallback(
    (taskId: string, done: boolean, phaseKey: string) => {
      setCheck(projectId, taskId, done);
      broadcast("TASK_TOGGLED", { taskId, done, phaseKey }, phaseKey);
    },
    [projectId, setCheck, broadcast]
  );

  const changeWaitingOn = useCallback(
    (waitingOn: WaitingOn) => {
      setWaitingOn(projectId, waitingOn);
      broadcast("WAITING_ON_TOGGLED", waitingOn);
    },
    [projectId, setWaitingOn, broadcast]
  );

  return { status, broadcast, toggleCheck, changeWaitingOn };
}
