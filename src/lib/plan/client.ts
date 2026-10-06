import { newId, type Plan } from "./geometry";
import type { Correction, PlanState, PlanVersionSummary } from "./types";

/**
 * The editor's calls for a project's plan. With the server set up they go to
 * the API; in the demo they are kept in this browser, with the same rules
 * (revisions, versions, corrections log), so the editor behaves the same.
 */

export class PlanConflict extends Error {
  constructor(public readonly current: PlanState) {
    super("This plan was changed in another window since you opened it.");
  }
}

export interface SaveRequest {
  plan: Plan;
  baseRevision: number | null;
  changes: string[];
}

export interface PlanVersion {
  id: string;
  label: string;
  createdAt: string;
  plan: Plan;
}

export interface PlanBackend {
  load(projectId: string): Promise<PlanState>;
  save(projectId: string, request: SaveRequest): Promise<{ revision: number }>;
  createVersion(projectId: string, label: string): Promise<PlanVersionSummary>;
  getVersion(projectId: string, versionId: string): Promise<PlanVersion>;
  restore(projectId: string, versionId: string, baseRevision: number): Promise<PlanState>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body.current) throw new PlanConflict(body.current as PlanState);
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/plan`;

export const serverPlans: PlanBackend = {
  load: (projectId) => call<PlanState>(base(projectId)),
  save: (projectId, request) => call(base(projectId), { method: "PUT", body: JSON.stringify(request) }),
  createVersion: (projectId, label) =>
    call<{ version: PlanVersionSummary }>(`${base(projectId)}/versions`, { method: "POST", body: JSON.stringify({ label }) }).then(
      (b) => b.version
    ),
  getVersion: (projectId, versionId) =>
    call<{ version: PlanVersion }>(`${base(projectId)}/versions/${versionId}`).then((b) => b.version),
  restore: (projectId, versionId, baseRevision) =>
    call<PlanState>(`${base(projectId)}/versions/${versionId}/restore`, { method: "POST", body: JSON.stringify({ baseRevision }) }),
};

// ---------------------------------------------------------------------------
// The demo: kept in this browser
// ---------------------------------------------------------------------------

interface LocalRecord {
  plan: Plan | null;
  revision: number;
  updatedAt?: string;
  versions: PlanVersion[];
  corrections: Correction[];
}

const localKey = (projectId: string) => `fundur.plan.v1.${projectId}`;

function readLocal(projectId: string): LocalRecord {
  try {
    const raw = localStorage.getItem(localKey(projectId));
    if (raw) return JSON.parse(raw) as LocalRecord;
  } catch {
    // Storage blocked or the record unreadable: start empty.
  }
  return { plan: null, revision: 0, versions: [], corrections: [] };
}

function writeLocal(projectId: string, record: LocalRecord) {
  localStorage.setItem(localKey(projectId), JSON.stringify(record));
}

function toState(record: LocalRecord, by: string): PlanState {
  return {
    plan: record.plan,
    revision: record.revision,
    ...(record.updatedAt ? { updatedAt: record.updatedAt, updatedBy: by } : {}),
    versions: record.versions.map(({ id, label, createdAt }) => ({ id, label, createdAt, createdBy: by })),
    corrections: record.corrections.slice(0, 200),
  };
}

export function localPlans(by: string): PlanBackend {
  const save = async (projectId: string, request: SaveRequest) => {
    const record = readLocal(projectId);
    if ((request.baseRevision ?? 0) !== record.revision) throw new PlanConflict(toState(record, by));
    const at = new Date().toISOString();
    const corrections = request.changes.map((summary) => ({ id: newId(), summary, at, by }));
    const next: LocalRecord = {
      ...record,
      plan: request.plan,
      revision: record.revision + 1,
      updatedAt: at,
      corrections: [...corrections.reverse(), ...record.corrections].slice(0, 500),
    };
    writeLocal(projectId, next);
    return { revision: next.revision };
  };

  const createVersion = async (projectId: string, label: string) => {
    const record = readLocal(projectId);
    if (!record.plan) throw new Error("There is no plan to keep a version of yet");
    const version: PlanVersion = { id: newId(), label, createdAt: new Date().toISOString(), plan: record.plan };
    writeLocal(projectId, { ...record, versions: [version, ...record.versions] });
    return { id: version.id, label, createdAt: version.createdAt, createdBy: by };
  };

  return {
    load: async (projectId) => toState(readLocal(projectId), by),
    save,
    createVersion,
    getVersion: async (projectId, versionId) => {
      const version = readLocal(projectId).versions.find((v) => v.id === versionId);
      if (!version) throw new Error("That version no longer exists");
      return version;
    },
    restore: async (projectId, versionId, baseRevision) => {
      const record = readLocal(projectId);
      const version = record.versions.find((v) => v.id === versionId);
      if (!version) throw new Error("That version no longer exists");
      if (record.revision !== baseRevision) throw new PlanConflict(toState(record, by));
      await createVersion(projectId, `Before restoring "${version.label}"`);
      await save(projectId, { plan: version.plan, baseRevision, changes: [`Restored version "${version.label}"`] });
      return toState(readLocal(projectId), by);
    },
  };
}

// ---------------------------------------------------------------------------
// Unsaved edits, kept in this browser until the server has them
// ---------------------------------------------------------------------------

/**
 * Every edit is written here at once, before the debounced save, so closing
 * the browser mid-edit loses nothing: the next time the plan opens, edits made
 * on top of the plan as it is stored are put back and saved.
 */
export interface PlanDraft {
  baseRevision: number;
  plan: Plan;
  changes: string[];
  at: string;
}

const draftKey = (projectId: string) => `fundur.plan.draft.v1.${projectId}`;

export const planDrafts = {
  read(projectId: string): PlanDraft | null {
    try {
      const raw = localStorage.getItem(draftKey(projectId));
      return raw ? (JSON.parse(raw) as PlanDraft) : null;
    } catch {
      return null;
    }
  },
  write(projectId: string, draft: PlanDraft) {
    try {
      localStorage.setItem(draftKey(projectId), JSON.stringify(draft));
    } catch {
      // A full or blocked store: the debounced save still runs.
    }
  },
  clear(projectId: string) {
    try {
      localStorage.removeItem(draftKey(projectId));
    } catch {
      // Nothing to clear.
    }
  },
};
