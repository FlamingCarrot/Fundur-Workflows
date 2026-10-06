"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { makeSeedProjects } from "@/lib/studio/seed";
import { briefAiFieldsAfter, completePhase, newProject } from "@/lib/studio/transitions";
import { ProjectSync } from "@/lib/studio/sync";
import type { ProjectMutation } from "@/lib/projects/mutations";
import type { Viewer } from "@/lib/studio/viewer";
import type { Brief, BriefField, IssueReport, Project, ProjectDocument, ProjectStatus, SwatchKey, WaitingOn } from "@/lib/studio/types";

const STORAGE_KEY = "fundur.studio.v1";
/** Issue reports stay in the browser until the admin ticket queue exists, also when projects are on the server. */
const ISSUES_KEY = "fundur.studio.issues.v1";

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
  | { type: "createProject"; project: Project }
  | { type: "addAiSpend"; projectId: string; zar: number }
  | { type: "reportIssue"; issue: IssueReport };

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
    case "createProject":
      return { ...state, projects: [action.project, ...state.projects] };
    case "addAiSpend":
      return updateProject(state, action.projectId, (p) => ({
        ...p,
        aiSpendZar: Math.round((p.aiSpendZar + action.zar) * 100) / 100,
      }));
    case "reportIssue":
      return { ...state, issues: [action.issue, ...state.issues] };
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
  /** Resolves with the new project's id once it is saved, or null if saving failed. */
  createProject: (input: NewProjectInput) => Promise<string | null>;
  /** Demo data only: on the server, AI spend comes from the logged calls. */
  addAiSpend: (projectId: string, zar: number) => void;
  /** Shows a copy of a project the server just returned (for example after an AI call logged its cost). */
  receiveProject: (project: Project) => void;
  reportIssue: (moduleKey: string, note: string) => void;
  // Interface state shared across screens.
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  issueSheetOpen: boolean;
  setIssueSheetOpen: (open: boolean) => void;
  toasts: Toast[];
  toast: (message: string) => void;
}

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

function readIssues(): IssueReport[] {
  try {
    return JSON.parse(window.localStorage.getItem(ISSUES_KEY) ?? "[]") as IssueReport[];
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
  const [state, dispatch] = useReducer(reducer, { ready: false, projects: [], issues: [] });
  const ready = state.ready;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [issueSheetOpen, setIssueSheetOpen] = useState(false);
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
      dispatch({ type: "setIssues", issues: readIssues() });
      void load();
      // Live sync is best effort, so coming back to the tab picks up what others changed meanwhile.
      // Leaving it sends any brief edits still waiting.
      const onVisibility = () => {
        if (document.visibilityState === "visible") void load();
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
  }, [sync, toast]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (server) window.localStorage.setItem(ISSUES_KEY, JSON.stringify(state.issues));
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: state.projects, issues: state.issues }));
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
      applyRemoteCheck: (projectId, itemId, done) => dispatch({ type: "setCheck", projectId, itemId, done }),
      applyRemoteWaitingOn: (projectId, waitingOn) => dispatch({ type: "setWaitingOn", projectId, waitingOn }),
      applyRemoteBrief: (projectId, patch) => dispatch({ type: "applyRemoteBrief", projectId, patch }),
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
      reportIssue: (moduleKey, note) =>
        dispatch({
          type: "reportIssue",
          issue: {
            id: `iss-${Date.now()}`,
            moduleKey,
            note,
            path: typeof window !== "undefined" ? window.location.pathname : "",
            createdAt: new Date().toISOString(),
          },
        }),
      assistantOpen,
      setAssistantOpen,
      issueSheetOpen,
      setIssueSheetOpen,
      toasts,
      toast,
    };
  }, [state, ready, persistence, server, viewer, fileStorage, sync, assistantOpen, issueSheetOpen, toasts, toast]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside StudioProvider");
  return ctx;
}
