"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { makeSeedProjects } from "@/lib/studio/seed";
import { briefAiFieldsAfter, completePhase, newProject } from "@/lib/studio/transitions";
import { ProjectSync } from "@/lib/studio/sync";
import { addDays, daysBetween, phaseSpans } from "@/lib/studio/timeline";
import type { ProjectMutation } from "@/lib/projects/mutations";
import type { Viewer } from "@/lib/studio/viewer";
import { trackAction } from "@/lib/analytics/client";
import { issuesApi, LEGACY_ISSUES_KEY, normaliseIssue } from "@/lib/studio/issues";
import { startServerViewSettings } from "@/lib/view-settings/client";
import type { Brief, BriefField, IssueReport, Project, ProjectDocument, ProjectStatus, SwatchKey, TaskRecord, WaitingOn } from "@/lib/studio/types";

const STORAGE_KEY = "fundur.studio.v1";

/** Loading, saving and other people's changes arriving are not something this person did. */
const UNTRACKED_ACTIONS = new Set<Action["type"]>([
  "hydrate", "loadProjects", "setIssues", "saved", "applyRemoteBrief", "issueSaved", "addAiSpend",
]);

/**
 * Where projects are kept: "server" is the database, for the signed-in
 * person's workspace; "local" is demo data in this browser, used while the
 * database or sign-in is not set up.
 */
export type Persistence = "server" | "local";

export interface State {
  ready: boolean;
  projects: Project[];
  issues: IssueReport[];
}

type Action =
  | { type: "hydrate"; state: State }
  | { type: "loadProjects"; projects: Project[] }
  | { type: "setIssues"; issues: IssueReport[] }
  | { type: "saved"; saved: { project: Project; previousId: string }[] }
  | { type: "setCheck"; projectId: string; itemId: string; done: boolean }
  | { type: "setWaitingOn"; projectId: string; waitingOn: WaitingOn }
  | { type: "setStatus"; projectId: string; status: ProjectStatus }
  | { type: "updateBrief"; projectId: string; patch: Brief; fromAi: boolean }
  | { type: "applyRemoteBrief"; projectId: string; patch: Brief }
  | { type: "addDocuments"; projectId: string; documents: ProjectDocument[] }
  | { type: "toggleClientVisible"; projectId: string; documentId: string }
  | { type: "completePhase"; projectId: string; phaseKey: string }
  | { type: "addTask"; projectId: string; task: TaskRecord }
  | { type: "changeTask"; projectId: string; taskId: string; patch: Partial<TaskRecord> }
  | { type: "deleteTask"; projectId: string; taskId: string }
  | { type: "setPhaseStart"; projectId: string; phaseKey: string; start: string | null }
  | { type: "setStepTask"; projectId: string; itemId: string; phaseKey: string; patch: Partial<TaskRecord> }
  | { type: "createProject"; project: Project }
  | { type: "addAiSpend"; projectId: string; zar: number }
  | { type: "reportIssue"; issue: IssueReport }
  /** Replaces the report with this id (a report saved under a new id comes back with previousId). */
  | { type: "issueSaved"; issue: IssueReport; previousId?: string }
  | { type: "removeIssue"; issueId: string };

function touch(p: Project): Project {
  return { ...p, lastActivity: new Date().toISOString() };
}

function updateProject(state: State, id: string, fn: (p: Project) => Project): State {
  return { ...state, projects: state.projects.map((p) => (p.id === id ? touch(fn(p)) : p)) };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return {
        ...action.state,
        // Projects saved before versions were recorded all started on version 1.
        projects: action.state.projects.map((p) => ({ ...p, workflowVersion: p.workflowVersion ?? 1 })),
        issues: (action.state.issues ?? []).map(normaliseIssue),
        ready: true,
      };
    case "loadProjects":
      return { ...state, projects: action.projects, ready: true };
    case "setIssues":
      return { ...state, issues: action.issues };
    case "saved": {
      // The server's copy wins; a project created under a taken id comes back under its new one.
      const byPrevious = new Map(action.saved.map((s) => [s.previousId, s.project]));
      return { ...state, projects: state.projects.map((p) => byPrevious.get(p.id) ?? p) };
    }
    case "setCheck":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        checks: { ...p.checks, [action.itemId]: action.done },
      }));
    case "setWaitingOn":
      return updateProject(state, action.projectId, (p) => ({ ...p, waitingOn: action.waitingOn }));
    case "setStatus":
      return updateProject(state, action.projectId, (p) => ({ ...p, status: action.status }));
    case "updateBrief":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        brief: { ...p.brief, ...action.patch },
        briefAiFields: briefAiFieldsAfter(p.briefAiFields, Object.keys(action.patch) as BriefField[], action.fromAi),
      }));
    case "applyRemoteBrief":
      return updateProject(state, action.projectId, (p) => {
        // A collaborator's save carries only the fields they changed; those are no longer an untouched AI draft.
        const changed = Object.keys(action.patch).filter((k) => action.patch[k] !== p.brief[k]);
        if (!changed.length) return p;
        return { ...p, brief: { ...p.brief, ...action.patch }, briefAiFields: p.briefAiFields.filter((f) => !changed.includes(f)) };
      });
    case "addDocuments":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        documents: [...action.documents, ...p.documents],
      }));
    case "toggleClientVisible":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        documents: p.documents.map((d) =>
          d.id === action.documentId ? { ...d, clientVisible: !d.clientVisible } : d
        ),
      }));
    case "completePhase":
      return updateProject(state, action.projectId, (p) => completePhase(p, action.phaseKey));
    case "addTask":
      return updateProject(state, action.projectId, (p) => ({ ...p, tasks: [...p.tasks, action.task] }));
    case "changeTask":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === action.taskId ? { ...t, ...action.patch } : t)),
      }));
    case "deleteTask":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        tasks: p.tasks.filter((t) => t.id !== action.taskId),
      }));
    case "setPhaseStart":
      return updateProject(state, action.projectId, (p) => {
        const dates = { ...(p.phaseDates ?? {}) };
        if (!action.start) {
          delete dates[action.phaseKey];
          return { ...p, phaseDates: dates };
        }
        // The phases after it come along, as they do on the server.
        const spans = phaseSpans(p);
        const index = spans.findIndex((s) => s.key === action.phaseKey);
        if (index < 0) return p;
        const delta = daysBetween(spans[index].start, action.start);
        for (const span of spans.slice(index)) dates[span.key] = addDays(span.start, delta);
        return { ...p, phaseDates: dates };
      });
    case "setStepTask":
      return updateProject(state, action.projectId, (p) => {
        const existing = p.tasks.find((t) => t.stepItemId === action.itemId);
        if (existing) {
          return { ...p, tasks: p.tasks.map((t) => (t === existing ? { ...t, ...action.patch } : t)) };
        }
        const record: TaskRecord = {
          id: `step-${action.itemId}`,
          stepItemId: action.itemId,
          phaseKey: action.phaseKey,
          title: "",
          done: false,
          ...action.patch,
        };
        return { ...p, tasks: [...p.tasks, record] };
      });
    case "createProject":
      return { ...state, projects: [action.project, ...state.projects] };
    case "addAiSpend":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        aiSpendZar: Math.round((p.aiSpendZar + action.zar) * 100) / 100,
      }));
    case "reportIssue":
      return { ...state, issues: [action.issue, ...state.issues] };
    case "issueSaved": {
      const id = action.previousId ?? action.issue.id;
      return { ...state, issues: state.issues.map((i) => (i.id === id ? action.issue : i)) };
    }
    case "removeIssue":
      return { ...state, issues: state.issues.filter((i) => i.id !== action.issueId) };
  }
}

export interface NewProjectInput {
  name: string;
  client: string;
  workflowId: string;
  startDate: string;
  swatch: SwatchKey;
}

interface Toast {
  id: number;
  message: string;
}

interface StudioContextValue {
  ready: boolean;
  persistence: Persistence;
  /** The signed-in person (or the demo user). */
  viewer: Viewer;
  /** True when files are uploaded to storage; otherwise only their names are recorded. */
  fileStorage: boolean;
  projects: Project[];
  issues: IssueReport[];
  getProject: (id: string) => Project | undefined;
  // These resolve true once the change is saved (straight away on demo data), so it can then be shared live.
  setCheck: (projectId: string, itemId: string, done: boolean) => Promise<boolean>;
  setWaitingOn: (projectId: string, waitingOn: WaitingOn) => Promise<boolean>;
  setStatus: (projectId: string, status: ProjectStatus) => void;
  updateBrief: (projectId: string, patch: Brief, fromAi?: boolean) => void;
  /** Resolves once the project's brief edits are saved; rejects if saving failed. */
  saveBrief: (projectId: string) => Promise<void>;
  // Collaborators' changes, received live: shown here, already saved by them.
  applyRemoteCheck: (projectId: string, itemId: string, done: boolean) => void;
  applyRemoteWaitingOn: (projectId: string, waitingOn: WaitingOn) => void;
  applyRemoteBrief: (projectId: string, patch: Brief) => void;
  addDocuments: (projectId: string, documents: ProjectDocument[]) => void;
  toggleClientVisible: (projectId: string, documentId: string) => void;
  // Versions and restores happen on the server only; each resolves true once saved.
  replaceDocumentFile: (
    projectId: string,
    documentId: string,
    file: { storageKey: string; name: string; sizeBytes: number }
  ) => Promise<boolean>;
  restoreDocumentVersion: (projectId: string, documentId: string, version: number) => Promise<boolean>;
  restoreBrief: (projectId: string, snapshotId: string) => Promise<boolean>;
  completePhase: (projectId: string, phaseKey: string) => void;
  // Tasks: her own, and the dates and outputs she sets on the workflow's steps.
  addTask: (projectId: string, input: { phaseKey: string; title: string; due?: string }) => void;
  updateTask: (projectId: string, taskId: string, patch: { title?: string; due?: string | null; done?: boolean; outputDocumentId?: string | null }) => void;
  deleteTask: (projectId: string, taskId: string) => void;
  /** Moves a phase on the timeline; null puts it back on the workflow's own plan. */
  setPhaseStart: (projectId: string, phaseKey: string, start: string | null) => void;
  setStepDue: (projectId: string, itemId: string, phaseKey: string, due: string | null) => void;
  setStepOutput: (projectId: string, itemId: string, phaseKey: string, documentId: string | null) => void;
  /** Resolves with the new project's id once it is saved, or null if saving failed. */
  createProject: (input: NewProjectInput) => Promise<string | null>;
  /** Demo data only: on the server, AI spend comes from the logged calls. */
  addAiSpend: (projectId: string, zar: number) => void;
  /** Shows a copy of a project the server just returned (for example after an AI call logged its cost). */
  receiveProject: (project: Project) => void;
  /** The person's own reports that are not closed. */
  reportIssue: (input: { moduleKey: string; note: string; projectId?: string }) => void;
  editIssue: (issueId: string, note: string) => void;
  closeIssue: (issueId: string) => void;
  // Interface state shared across screens.
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  /** The task the assistant was opened on, so its AI cost counts against that task. */
  assistantTask: { projectId: string; taskId: string; title: string } | null;
  /** Opens the assistant on one task of a project. */
  askAboutTask: (task: { projectId: string; taskId: string; title: string }) => void;
  /** The report sheet: a new report, or the person's own reports (optionally for one module). */
  issueSheet: IssueSheetView | null;
  /** The search box across projects, clients, documents and tasks. */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  setIssueSheetOpen: (open: boolean) => void;
  showMyIssues: (filter?: { moduleKey?: string; projectId?: string }) => void;
  toasts: Toast[];
  toast: (message: string) => void;
}

export type IssueSheetView = { mode: "report" } | { mode: "mine"; moduleKey?: string; projectId?: string };

const StudioContext = createContext<StudioContextValue | null>(null);

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project";
}

/** A saved copy with brief edits that are typed but not yet sent laid over it. */
function withPendingBrief(project: Project, pending: { patch: Brief; fromAi: boolean } | undefined): Project {
  if (!pending) return project;
  return {
    ...project,
    brief: { ...project.brief, ...pending.patch },
    briefAiFields: briefAiFieldsAfter(project.briefAiFields, Object.keys(pending.patch), pending.fromAi),
  };
}

/** Reports filed in this browser before they were kept on the server. */
function takeLegacyIssues(): IssueReport[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_ISSUES_KEY);
    return raw ? (JSON.parse(raw) as IssueReport[]) : [];
  } catch {
    return [];
  }
}

export function StudioProvider({
  children,
  persistence = "local",
  viewer,
  fileStorage = false,
}: {
  children: React.ReactNode;
  persistence?: Persistence;
  viewer: Viewer;
  fileStorage?: boolean;
}) {
  const [state, rawDispatch] = useReducer(reducer, { ready: false, projects: [], issues: [] });
  // Everything the person does to their work is counted for usage analytics, by kind only.
  const dispatch = useCallback((action: Action) => {
    if (!UNTRACKED_ACTIONS.has(action.type)) trackAction(action.type);
    rawDispatch(action);
  }, []);
  const ready = state.ready;
  const [assistantOpen, setAssistantOpenState] = useState(false);
  const [assistantTask, setAssistantTask] = useState<StudioContextValue["assistantTask"]>(null);
  const setAssistantOpen = useCallback((open: boolean) => {
    setAssistantOpenState(open);
    // Opened anywhere else, the assistant is about the project, not one task.
    setAssistantTask(null);
  }, []);
  const askAboutTask = useCallback((task: NonNullable<StudioContextValue["assistantTask"]>) => {
    setAssistantTask(task);
    setAssistantOpenState(true);
  }, []);
  const [issueSheet, setIssueSheet] = useState<IssueSheetView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const server = persistence === "server";

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const [sync] = useState(() => {
    if (!server) return null;
    const created: ProjectSync = new ProjectSync({
      onSaved: (saved) =>
        dispatch({
          type: "saved",
          saved: saved.map((s) => ({ ...s, project: withPendingBrief(s.project, created.pendingBrief(s.project.id)) })),
        }),
    });
    return created;
  });

  // Load once on the client: from the server, or demo data from this browser.
  useEffect(() => {
    if (sync) {
      let cancelled = false;
      const load = () =>
        sync.load().then(
          (projects) => {
            // Null when a change made here meanwhile would make this snapshot out of date.
            if (cancelled || !projects) return;
            dispatch({ type: "loadProjects", projects });
          },
          () => {
            if (cancelled) return;
            toast("Couldn't load your projects. Try reloading the page.");
            dispatch({ type: "loadProjects", projects: [] });
          }
        );
      sync.setErrorHandler(() => {
        toast("A change didn't save. Showing your latest saved work.");
        void load();
      });
      const loadIssues = () =>
        issuesApi.list().then(
          (issues) => !cancelled && dispatch({ type: "setIssues", issues }),
          () => undefined
        );
      // Reports filed in this browser before the ticket queue existed are sent to it once.
      const legacy = takeLegacyIssues();
      void Promise.all(
        legacy.map((i) =>
          issuesApi.create({ moduleKey: i.moduleKey, note: i.note, path: i.path }).catch(() => undefined)
        )
      ).then(() => {
        try {
          window.localStorage.removeItem(LEGACY_ISSUES_KEY);
        } catch {
          // Nothing kept; they are on the server now.
        }
        void loadIssues();
      });
      void load();
      // Live sync is best effort, so coming back to the tab picks up what others changed meanwhile.
      // Leaving it sends any brief edits still waiting.
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          void load();
          void loadIssues();
        }
        else sync.flushAll().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }

    let loaded: State | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw) as State;
    } catch {
      loaded = null;
    }
    dispatch({
      type: "hydrate",
      state: loaded?.projects?.length ? loaded : { ready: true, projects: makeSeedProjects(), issues: [] },
    });
  }, [sync, toast, dispatch]);

  // How each screen was left follows the signed-in person to any device.
  useEffect(() => (server && viewer.signedIn ? startServerViewSettings() : undefined), [server, viewer.signedIn]);

  useEffect(() => {
    if (!ready || server) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: state.projects, issues: state.issues }));
    } catch {
      // Storage can be unavailable (private mode); the session still works in memory.
    }
  }, [state, ready, server]);

  const value = useMemo<StudioContextValue>(() => {
    const getProject = (id: string) => state.projects.find((p) => p.id === id);
    // Failures are reported through the sync's onError, so fire-and-forget callers need not handle them.
    const save = (projectId: string, mutation: ProjectMutation): Promise<boolean> =>
      sync ? sync.mutate(projectId, mutation).then(() => true, () => false) : Promise.resolve(true);
    return {
      ready,
      persistence,
      viewer,
      fileStorage: server && fileStorage,
      projects: state.projects,
      issues: state.issues,
      getProject,
      setCheck: (projectId, itemId, done) => {
        dispatch({ type: "setCheck", projectId, itemId, done });
        return save(projectId, { type: "setCheck", itemId, done });
      },
      setWaitingOn: (projectId, waitingOn) => {
        dispatch({ type: "setWaitingOn", projectId, waitingOn });
        return save(projectId, { type: "setWaitingOn", waitingOn });
      },
      setStatus: (projectId, status) => {
        if (status === "complete") return;
        dispatch({ type: "setStatus", projectId, status });
        save(projectId, { type: "setStatus", status });
      },
      updateBrief: (projectId, patch, fromAi = false) => {
        dispatch({ type: "updateBrief", projectId, patch, fromAi });
        sync?.queueBrief(projectId, patch, fromAi);
      },
      saveBrief: (projectId) => sync?.flushBrief(projectId) ?? Promise.resolve(),
      applyRemoteCheck: (projectId, itemId, done) => rawDispatch({ type: "setCheck", projectId, itemId, done }),
      applyRemoteWaitingOn: (projectId, waitingOn) => rawDispatch({ type: "setWaitingOn", projectId, waitingOn }),
      applyRemoteBrief: (projectId, patch) => rawDispatch({ type: "applyRemoteBrief", projectId, patch }),
      addDocuments: (projectId, documents) => {
        dispatch({ type: "addDocuments", projectId, documents });
        save(projectId, { type: "addDocuments", documents });
      },
      toggleClientVisible: (projectId, documentId) => {
        const doc = getProject(projectId)?.documents.find((d) => d.id === documentId);
        dispatch({ type: "toggleClientVisible", projectId, documentId });
        if (doc) save(projectId, { type: "setClientVisible", documentId, clientVisible: !doc.clientVisible });
      },
      replaceDocumentFile: (projectId, documentId, file) =>
        sync ? save(projectId, { type: "replaceDocumentFile", documentId, ...file }) : Promise.resolve(false),
      restoreDocumentVersion: (projectId, documentId, version) =>
        sync ? save(projectId, { type: "restoreDocumentVersion", documentId, version }) : Promise.resolve(false),
      restoreBrief: (projectId, snapshotId) =>
        sync
          ? sync.flushBrief(projectId).then(() => save(projectId, { type: "restoreBrief", snapshotId }), () => false)
          : Promise.resolve(false),
      completePhase: (projectId, phaseKey) => {
        dispatch({ type: "completePhase", projectId, phaseKey });
        save(projectId, { type: "completePhase", phaseKey });
      },
      addTask: (projectId, input) => {
        const id = crypto.randomUUID();
        dispatch({
          type: "addTask",
          projectId,
          task: { id, phaseKey: input.phaseKey, title: input.title, done: false, ...(input.due ? { due: input.due } : {}) },
        });
        save(projectId, { type: "addTask", id, phaseKey: input.phaseKey, title: input.title, ...(input.due ? { due: input.due } : {}) });
      },
      updateTask: (projectId, taskId, patch) => {
        dispatch({
          type: "changeTask",
          projectId,
          taskId,
          patch: {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.due !== undefined ? { due: patch.due ?? undefined } : {}),
            ...(patch.done !== undefined ? { done: patch.done } : {}),
            ...(patch.outputDocumentId !== undefined ? { outputDocumentId: patch.outputDocumentId ?? undefined } : {}),
          },
        });
        save(projectId, { type: "updateTask", taskId, ...patch });
      },
      deleteTask: (projectId, taskId) => {
        dispatch({ type: "deleteTask", projectId, taskId });
        save(projectId, { type: "deleteTask", taskId });
      },
      setPhaseStart: (projectId, phaseKey, start) => {
        dispatch({ type: "setPhaseStart", projectId, phaseKey, start });
        save(projectId, { type: "setPhaseStart", phaseKey, start });
      },
      setStepDue: (projectId, itemId, phaseKey, due) => {
        dispatch({ type: "setStepTask", projectId, itemId, phaseKey, patch: { due: due ?? undefined } });
        save(projectId, { type: "setStepDue", itemId, due });
      },
      setStepOutput: (projectId, itemId, phaseKey, documentId) => {
        dispatch({ type: "setStepTask", projectId, itemId, phaseKey, patch: { outputDocumentId: documentId ?? undefined } });
        save(projectId, { type: "setStepOutput", itemId, documentId });
      },
      createProject: (input) => {
        const base = slugify(input.name);
        const id = state.projects.some((p) => p.id === base) ? `${base}-${Date.now().toString(36)}` : base;
        dispatch({ type: "createProject", project: newProject({ ...input, id }) });
        if (!sync) return Promise.resolve(id);
        // Another tab may have taken the id meanwhile; the server then saves it under a new one.
        return sync.create({ ...input, id }).then((saved) => saved.id, () => null);
      },
      addAiSpend: (projectId, zar) => {
        if (!server) dispatch({ type: "addAiSpend", projectId, zar });
      },
      receiveProject: (project) =>
        dispatch({
          type: "saved",
          saved: [{ project: withPendingBrief(project, sync?.pendingBrief(project.id)), previousId: project.id }],
        }),
      reportIssue: ({ moduleKey, note, projectId }) => {
        const issue: IssueReport = {
          id: `iss-${Date.now().toString(36)}`,
          moduleKey,
          ...(projectId ? { projectId } : {}),
          note,
          path: typeof window !== "undefined" ? window.location.pathname : "",
          status: "open",
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "reportIssue", issue });
        if (!server) return;
        issuesApi.create({ moduleKey, note, path: issue.path, projectId }).then(
          (saved) => dispatch({ type: "issueSaved", issue: saved, previousId: issue.id }),
          () => {
            dispatch({ type: "removeIssue", issueId: issue.id });
            toast("Your report didn't send. Please try again.");
          }
        );
      },
      editIssue: (issueId, note) => {
        const before = state.issues.find((i) => i.id === issueId);
        if (!before) return;
        dispatch({ type: "issueSaved", issue: { ...before, note, updatedAt: new Date().toISOString() } });
        if (!server) return;
        issuesApi.edit(issueId, note).then(
          (saved) => dispatch({ type: "issueSaved", issue: saved }),
          () => {
            dispatch({ type: "issueSaved", issue: before });
            toast("That change didn't save. Please try again.");
          }
        );
      },
      closeIssue: (issueId) => {
        const before = state.issues.find((i) => i.id === issueId);
        if (!before) return;
        dispatch({ type: "removeIssue", issueId });
        if (!server) return;
        issuesApi.close(issueId).catch(() => {
          dispatch({ type: "reportIssue", issue: before });
          toast("Couldn't close that report. Please try again.");
        });
      },
      assistantOpen,
      setAssistantOpen,
      assistantTask,
      askAboutTask,
      issueSheet,
      searchOpen,
      setSearchOpen,
      setIssueSheetOpen: (open) => setIssueSheet(open ? { mode: "report" } : null),
      showMyIssues: (filter) => setIssueSheet({ mode: "mine", ...filter }),
      toasts,
      toast,
    };
  }, [state, ready, persistence, server, viewer, fileStorage, sync, assistantOpen, setAssistantOpen, assistantTask, askAboutTask, issueSheet, searchOpen, toasts, toast, dispatch]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside StudioProvider");
  return ctx;
}
