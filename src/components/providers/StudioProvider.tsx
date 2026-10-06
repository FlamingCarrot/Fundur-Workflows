"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { getWorkflow } from "@/lib/workflow";
import { makeSeedProjects, emptyBrief } from "@/lib/studio/seed";
import { phaseProgress } from "@/lib/studio/selectors";
import type { Brief, BriefField, IssueReport, Project, ProjectDocument, ProjectStatus, SwatchKey, WaitingOn } from "@/lib/studio/types";

const STORAGE_KEY = "fundur.studio.v1";

export interface State {
  ready: boolean;
  projects: Project[];
  issues: IssueReport[];
}

type Action =
  | { type: "hydrate"; state: State }
  | { type: "setCheck"; projectId: string; itemId: string; done: boolean }
  | { type: "setWaitingOn"; projectId: string; waitingOn: WaitingOn }
  | { type: "setStatus"; projectId: string; status: ProjectStatus }
  | { type: "updateBrief"; projectId: string; patch: Brief; fromAi: boolean }
  | { type: "applyRemoteBrief"; projectId: string; brief: Brief }
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
      return updateProject(state, action.projectId, (p) => {
        const fields = Object.keys(action.patch) as BriefField[];
        const briefAiFields = action.fromAi
          ? Array.from(new Set([...p.briefAiFields, ...fields]))
          : p.briefAiFields.filter((f) => !fields.includes(f));
        return { ...p, brief: { ...p.brief, ...action.patch }, briefAiFields };
      });
    case "applyRemoteBrief":
      return updateProject(state, action.projectId, (p) => {
        // A collaborator's save: fields they changed are no longer an untouched AI draft.
        const changed = Object.keys(action.brief).filter((k) => action.brief[k] !== p.brief[k]);
        if (!changed.length) return p;
        return { ...p, brief: { ...p.brief, ...action.brief }, briefAiFields: p.briefAiFields.filter((f) => !changed.includes(f)) };
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
      return updateProject(state, action.projectId, (p) => {
        // Only the open phase can be completed, and only once its essentials are ticked.
        if (p.currentPhase !== action.phaseKey || p.status === "complete" || !phaseProgress(p, action.phaseKey).ready) return p;
        const phases = getWorkflow(p).phases;
        const idx = phases.findIndex((ph) => ph.key === action.phaseKey);
        const next = phases[idx + 1];
        return {
          ...p,
          completedPhases: Array.from(new Set([...p.completedPhases, action.phaseKey])),
          currentPhase: next ? next.key : p.currentPhase,
          status: next ? p.status : "complete",
        };
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
  projects: Project[];
  issues: IssueReport[];
  getProject: (id: string) => Project | undefined;
  setCheck: (projectId: string, itemId: string, done: boolean) => void;
  setWaitingOn: (projectId: string, waitingOn: WaitingOn) => void;
  setStatus: (projectId: string, status: ProjectStatus) => void;
  updateBrief: (projectId: string, patch: Brief, fromAi?: boolean) => void;
  applyRemoteBrief: (projectId: string, brief: Brief) => void;
  addDocuments: (projectId: string, documents: ProjectDocument[]) => void;
  toggleClientVisible: (projectId: string, documentId: string) => void;
  completePhase: (projectId: string, phaseKey: string) => void;
  createProject: (input: NewProjectInput) => string;
  addAiSpend: (projectId: string, zar: number) => void;
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

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ready: false, projects: [], issues: [] });
  const ready = state.ready;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [issueSheetOpen, setIssueSheetOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Load once on the client. Demo data stands in until projects persist server side.
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: state.projects, issues: state.issues }));
    } catch {
      // Storage can be unavailable (private mode); the session still works in memory.
    }
  }, [state, ready]);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const value = useMemo<StudioContextValue>(() => {
    const getProject = (id: string) => state.projects.find((p) => p.id === id);
    return {
      ready,
      projects: state.projects,
      issues: state.issues,
      getProject,
      setCheck: (projectId, itemId, done) => dispatch({ type: "setCheck", projectId, itemId, done }),
      setWaitingOn: (projectId, waitingOn) => dispatch({ type: "setWaitingOn", projectId, waitingOn }),
      setStatus: (projectId, status) => dispatch({ type: "setStatus", projectId, status }),
      updateBrief: (projectId, patch, fromAi = false) => dispatch({ type: "updateBrief", projectId, patch, fromAi }),
      applyRemoteBrief: (projectId, brief) => dispatch({ type: "applyRemoteBrief", projectId, brief }),
      addDocuments: (projectId, documents) => dispatch({ type: "addDocuments", projectId, documents }),
      toggleClientVisible: (projectId, documentId) => dispatch({ type: "toggleClientVisible", projectId, documentId }),
      completePhase: (projectId, phaseKey) => dispatch({ type: "completePhase", projectId, phaseKey }),
      createProject: (input) => {
        const base = slugify(input.name);
        const id = state.projects.some((p) => p.id === base) ? `${base}-${Date.now().toString(36)}` : base;
        const workflow = getWorkflow(input.workflowId);
        const ref = { workflowId: workflow.id, workflowVersion: workflow.version };
        const brief = emptyBrief(ref);
        if ("clientName" in brief) brief.clientName = input.client;
        dispatch({
          type: "createProject",
          project: {
            id,
            name: input.name,
            client: input.client,
            swatch: input.swatch,
            ...ref,
            status: "active",
            waitingOn: "me",
            startDate: input.startDate,
            currentPhase: workflow.phases[0].key,
            completedPhases: [],
            checks: {},
            brief,
            briefAiFields: [],
            documents: [],
            aiSpendZar: 0,
            lastActivity: new Date().toISOString(),
          },
        });
        return id;
      },
      addAiSpend: (projectId, zar) => dispatch({ type: "addAiSpend", projectId, zar }),
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
  }, [state, ready, assistantOpen, issueSheetOpen, toasts, toast]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside StudioProvider");
  return ctx;
}
