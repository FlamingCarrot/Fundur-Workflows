"use client";

import { useEffect, useMemo, useRef } from "react";
import { assistantBridge } from "@/lib/assistant/bridge";
import { selectionSummary } from "@/lib/ai/context";
import type { Plan, PlanItem } from "@/lib/plan/geometry";

/**
 * Links the plan editor to the assistant: it tells the chat which floor is
 * shown and what is selected, saves before a message goes, and draws the
 * assistant's plan edits the moment they are saved.
 */
export function useAssistantLink(
  projectId: string,
  editor: { flush: () => Promise<boolean>; adopt: (plan: Plan, revision: number, summary: string) => boolean },
  plan: Plan | null,
  levelId: string,
  levelName: string,
  selection: PlanItem[]
) {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  });

  useEffect(() => {
    assistantBridge.setHost({
      projectId,
      flush: () => editorRef.current.flush(),
      adopt: (next, revision, summary) => editorRef.current.adopt(next, revision, summary),
    });
    return () => assistantBridge.release(projectId);
  }, [projectId]);

  const key = selection.map((s) => `${s.kind}:${s.id}`).join(",");
  const label = useMemo(() => (plan && selection.length ? selectionSummary(plan, selection) : ""), [plan, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    assistantBridge.setFocus({ projectId, levelId, levelName, selection: key ? selection : [], selectionLabel: label });
  }, [projectId, levelId, levelName, key, label]); // eslint-disable-line react-hooks/exhaustive-deps
}
