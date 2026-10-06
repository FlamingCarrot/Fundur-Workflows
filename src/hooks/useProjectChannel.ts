"use client";

import { useCallback } from "react";
import { useRealtimeChannel } from "./useRealtimeChannel";
import { useStudio } from "@/components/providers/StudioProvider";
import type { WaitingOn } from "@/lib/studio/types";

/**
 * Live sync for one project: applies collaborators' changes as they arrive and
 * broadcasts local ones, so nobody needs to reload.
 */
export function useProjectChannel(projectId: string) {
  const { setCheck, setWaitingOn } = useStudio();

  const { status, broadcast } = useRealtimeChannel({
    projectId,
    onEvent: (event) => {
      if (event.type === "TASK_TOGGLED") {
        const { taskId, done } = event.data as { taskId: string; done: boolean };
        setCheck(projectId, taskId, done);
      }
      if (event.type === "WAITING_ON_TOGGLED") {
        setWaitingOn(projectId, event.data as WaitingOn);
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
