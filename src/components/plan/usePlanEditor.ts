"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { localPlans, PlanConflict, planDrafts, serverPlans, type PlanBackend } from "@/lib/plan/client";
import type { EditResult, Plan } from "@/lib/plan/geometry";
import type { PlanState } from "@/lib/plan/types";

/**
 * The plan being edited, and keeping it saved (P3-06).
 *
 * Every edit lands in this browser at once (so closing it mid-edit loses
 * nothing), then the plan is saved to the server a moment after the last
 * edit, with one corrections-log line per change. A save made against a plan
 * that changed elsewhere is not forced through: the editor says so and lets
 * the person choose which to keep.
 */

export type PlanSaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

const SAVE_AFTER_MS = 700;
const RETRY_AFTER_MS = 5_000;
const HISTORY = 100;

interface Step {
  plan: Plan | null;
  summary: string;
}

export function usePlanEditor(projectId: string) {
  const { persistence, viewer, toast } = useStudio();
  const backend: PlanBackend = useMemo(
    () => (persistence === "server" ? serverPlans : localPlans(viewer.name)),
    [persistence, viewer.name]
  );

  // Drafts are kept per account and workspace: project slugs repeat across workspaces, and a browser can be shared.
  const draftId = `${persistence}.${viewer.userId ?? viewer.email ?? "demo"}.${viewer.workspaceId ?? viewer.workspace}.${projectId}`;

  const [loaded, setLoaded] = useState<"loading" | "ready" | "failed">("loading");
  const [stored, setStored] = useState<PlanState | null>(null);
  const [plan, setPlanState] = useState<Plan | null>(null);
  const [status, setStatus] = useState<PlanSaveStatus>("saved");
  const [conflict, setConflict] = useState<PlanState | null>(null);
  // Undo and redo live in refs, so stepping through them never runs twice.
  const undoRef = useRef<Step[]>([]);
  const redoRef = useRef<Step[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const touchHistory = () => setHistory({ undo: undoRef.current.length, redo: redoRef.current.length });

  // Kept in refs so the save loop always works from the latest values.
  const planRef = useRef<Plan | null>(null);
  const revisionRef = useRef(0);
  const pendingRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  // Timers call the latest save through this, since save schedules itself.
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const setPlan = (next: Plan | null) => {
    planRef.current = next;
    setPlanState(next);
  };

  const keepDraft = useCallback(() => {
    if (!planRef.current) return;
    planDrafts.write(draftId, {
      baseRevision: revisionRef.current,
      plan: planRef.current,
      changes: pendingRef.current,
      at: new Date().toISOString(),
    });
  }, [draftId]);

  const save = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (savingRef.current || conflictRef.current || !planRef.current) return;
    const sentPlan = planRef.current;
    const sentChanges = pendingRef.current;
    if (!sentChanges.length && revisionRef.current > 0) {
      setStatus("saved");
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      const { revision } = await backend.save(projectId, {
        plan: sentPlan,
        baseRevision: revisionRef.current || null,
        changes: sentChanges,
      });
      revisionRef.current = revision;
      // Edits made while the save was on its way stay pending.
      pendingRef.current = pendingRef.current.slice(sentChanges.length);
      const now = new Date().toISOString();
      setStored((s) => ({
        ...(s ?? { versions: [], corrections: [] }),
        plan: sentPlan,
        revision,
        updatedAt: now,
        updatedBy: viewer.name,
        corrections: [
          ...sentChanges.map((summary, i) => ({ id: `${revision}-${i}`, summary, at: now, by: viewer.name })).reverse(),
          ...(s?.corrections ?? []),
        ],
      }));
      if (pendingRef.current.length || planRef.current !== sentPlan) {
        keepDraft();
        setStatus("dirty");
        timerRef.current = setTimeout(() => void saveRef.current(), SAVE_AFTER_MS);
      } else {
        planDrafts.clear(draftId);
        setStatus("saved");
      }
    } catch (err) {
      if (err instanceof PlanConflict) {
        conflictRef.current = true;
        setConflict(err.current);
        setStatus("conflict");
      } else {
        setStatus("error");
        timerRef.current = setTimeout(() => void saveRef.current(), RETRY_AFTER_MS);
      }
    } finally {
      savingRef.current = false;
    }
  }, [backend, draftId, keepDraft, projectId, viewer.name]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const schedule = useCallback(() => {
    keepDraft();
    setStatus((s) => (s === "conflict" ? s : "dirty"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void saveRef.current(), SAVE_AFTER_MS);
  }, [keepDraft]);

  // Load the stored plan, then put back any edits this browser had not yet saved.
  useEffect(() => {
    let cancelled = false;
    backend
      .load(projectId)
      .then((state) => {
        if (cancelled) return;
        revisionRef.current = state.revision;
        setStored(state);
        const draft = planDrafts.read(draftId);
        if (draft && draft.baseRevision === state.revision) {
          setPlan(draft.plan);
          pendingRef.current = draft.changes.length ? draft.changes : ["Unsaved changes recovered"];
          toast("Your unsaved changes to the plan were put back");
          schedule();
        } else if (draft) {
          // Edits made on an older copy: show them, and let the person choose.
          setPlan(draft.plan);
          pendingRef.current = draft.changes;
          conflictRef.current = true;
          setConflict(state);
          setStatus("conflict");
        } else {
          setPlan(state.plan);
        }
        setLoaded("ready");
      })
      .catch(() => !cancelled && setLoaded("failed"));
    return () => {
      cancelled = true;
    };
    // Loading runs once per project; schedule and toast are stable enough not to reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, draftId, projectId]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  /** Applies an edit that already passed its checks; returns the reason when it did not. */
  const apply = useCallback(
    (result: EditResult): string | null => {
      if (!result.ok) return result.error;
      if (!result.summary && result.plan === planRef.current) return null;
      undoRef.current = [...undoRef.current.slice(-HISTORY + 1), { plan: planRef.current, summary: result.summary }];
      redoRef.current = [];
      touchHistory();
      setPlan(result.plan);
      if (result.summary) pendingRef.current = [...pendingRef.current, result.summary];
      schedule();
      return null;
    },
    [schedule]
  );

  /** Swaps in a whole plan: an import, the sample, or a fresh start. */
  const replace = useCallback(
    (next: Plan, summary: string) => {
      undoRef.current = [...undoRef.current.slice(-HISTORY + 1), { plan: planRef.current, summary }];
      redoRef.current = [];
      touchHistory();
      setPlan(next);
      pendingRef.current = [...pendingRef.current, summary];
      schedule();
    },
    [schedule]
  );

  const step = useCallback(
    (from: React.MutableRefObject<Step[]>, to: React.MutableRefObject<Step[]>, word: string) => {
      const last = from.current[from.current.length - 1];
      if (!last) return;
      from.current = from.current.slice(0, -1);
      to.current = [...to.current, { plan: planRef.current, summary: last.summary }];
      touchHistory();
      setPlan(last.plan);
      pendingRef.current = [...pendingRef.current, `${word}: ${last.summary || "an edit"}`];
      schedule();
    },
    [schedule]
  );
  const undo = useCallback(() => step(undoRef, redoRef, "Undone"), [step]);
  const redo = useCallback(() => step(redoRef, undoRef, "Redone"), [step]);

  /** After a conflict: keep the plan as it is here, saved over the other copy. */
  const keepMine = useCallback(() => {
    if (!conflict) return;
    revisionRef.current = conflict.revision;
    conflictRef.current = false;
    setConflict(null);
    if (!pendingRef.current.length) pendingRef.current = ["Kept this copy over a change made elsewhere"];
    void save();
  }, [conflict, save]);

  /** After a conflict: drop the edits here and take the stored plan. */
  const takeTheirs = useCallback(() => {
    if (!conflict) return;
    revisionRef.current = conflict.revision;
    conflictRef.current = false;
    pendingRef.current = [];
    planDrafts.clear(draftId);
    setStored(conflict);
    setPlan(conflict.plan);
    undoRef.current = [];
    redoRef.current = [];
    touchHistory();
    setConflict(null);
    setStatus("saved");
  }, [conflict, draftId]);

  /** Saves now, so a version or a restore works from what is on screen. */
  const flush = useCallback(async () => {
    if (pendingRef.current.length || status !== "saved") await save();
    return !conflictRef.current && !pendingRef.current.length;
  }, [save, status]);

  const createVersion = useCallback(
    async (label: string) => {
      if (!(await flush())) throw new Error("Save the plan before keeping a version of it");
      const version = await backend.createVersion(projectId, label);
      setStored((s) => (s ? { ...s, versions: [version, ...s.versions] } : s));
      return version;
    },
    [backend, flush, projectId]
  );

  const restore = useCallback(
    async (versionId: string) => {
      if (!(await flush())) throw new Error("Save the plan before restoring a version");
      try {
        const state = await backend.restore(projectId, versionId, revisionRef.current);
        revisionRef.current = state.revision;
        setStored(state);
        undoRef.current = [];
        redoRef.current = [];
        touchHistory();
        setPlan(state.plan);
        planDrafts.clear(draftId);
        setStatus("saved");
      } catch (err) {
        if (err instanceof PlanConflict) {
          conflictRef.current = true;
          setConflict(err.current);
          setStatus("conflict");
          return;
        }
        throw err;
      }
    },
    [backend, draftId, flush, projectId]
  );

  const getVersion = useCallback((versionId: string) => backend.getVersion(projectId, versionId), [backend, projectId]);

  return {
    loaded,
    plan,
    stored,
    status,
    conflict,
    apply,
    replace,
    undo,
    redo,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
    keepMine,
    takeTheirs,
    createVersion,
    restore,
    getVersion,
    retry: () => void save(),
  };
}
