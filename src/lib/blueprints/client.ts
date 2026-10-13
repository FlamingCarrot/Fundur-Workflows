"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { blueprintBody, materialBody } from "./schema";
import { resolver, type Resolver } from "./resolve";
import type { Blueprint, Library, Material } from "./types";

/**
 * The design library in the browser: one copy shared by every screen that
 * shows blueprints (the plan editor, its 3D view, the library and blueprint
 * editor), so a change saved in one shows in the others at once. On the server
 * it is the practice's library; in the demo it is kept in this browser.
 */

export type Kind = "blueprint" | "material";
type Entry = Blueprint | Material;

export class LibraryConflict extends Error {
  constructor(public readonly current: Entry) {
    super("Someone else saved this since you opened it.");
  }
}

interface Backend {
  list(): Promise<Library>;
  create(kind: Kind, body: unknown): Promise<Entry>;
  update(id: string, baseRevision: number, body: unknown): Promise<Entry>;
  remove(id: string): Promise<void>;
  versions(id: string): Promise<{ revision: number; createdAt: string; createdBy?: string; body: unknown }[]>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data.current) throw new LibraryConflict(data.current);
  if (!res.ok) throw new Error(data.error ?? "The design library could not be reached.");
  return data as T;
}

const serverBackend: Backend = {
  list: () => call<Library>("/api/library"),
  create: async (kind, body) => (await call<{ entry: Entry }>("/api/library", { method: "POST", body: JSON.stringify({ kind, body }) })).entry,
  update: async (id, baseRevision, body) => (await call<{ entry: Entry }>(`/api/library/${id}`, { method: "PUT", body: JSON.stringify({ baseRevision, body }) })).entry,
  remove: async (id) => void (await call(`/api/library/${id}`, { method: "DELETE" })),
  versions: async (id) => (await call<{ versions: { revision: number; createdAt: string; createdBy?: string; body: unknown }[] }>(`/api/library/${id}/versions`)).versions,
};

interface DemoRow {
  kind: Kind;
  entry: Entry;
  history: { revision: number; createdAt: string; body: unknown }[];
}

function demoBackend(scope: string): Backend {
  const key = `fundur.designLibrary.v1.${scope}`;
  const read = (): DemoRow[] => {
    try {
      const rows: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(rows) ? (rows as DemoRow[]).filter((r) => r && r.entry && typeof r.entry.id === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (rows: DemoRow[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(rows));
    } catch {
      throw new Error("This browser's storage is full. Remove a texture or two from the library.");
    }
  };
  const bodyOf = (kind: Kind, body: unknown) => (kind === "blueprint" ? blueprintBody.parse(body) : materialBody.parse(body));
  return {
    list: async () => {
      const rows = read();
      return { blueprints: rows.filter((r) => r.kind === "blueprint").map((r) => r.entry as Blueprint), materials: rows.filter((r) => r.kind === "material").map((r) => r.entry as Material) };
    },
    create: async (kind, raw) => {
      const body = bodyOf(kind, raw);
      const rows = read();
      if (rows.length >= 300) throw new Error("The demo library is full.");
      const now = new Date().toISOString();
      const entry = { ...body, id: crypto.randomUUID(), revision: 1, updatedAt: now } as Entry;
      write([{ kind, entry, history: [{ revision: 1, createdAt: now, body }] }, ...rows]);
      return entry;
    },
    update: async (id, baseRevision, raw) => {
      const rows = read();
      const row = rows.find((r) => r.entry.id === id);
      if (!row) throw new Error("That is no longer in the library.");
      if (row.entry.revision !== baseRevision) throw new LibraryConflict(row.entry);
      const body = bodyOf(row.kind, raw);
      const now = new Date().toISOString();
      row.entry = { ...body, id, revision: baseRevision + 1, updatedAt: now } as Entry;
      row.history = [{ revision: baseRevision + 1, createdAt: now, body }, ...row.history].slice(0, 30);
      write([row, ...rows.filter((r) => r !== row)]);
      return row.entry;
    },
    remove: async (id) => write(read().filter((r) => r.entry.id !== id)),
    versions: async (id) => read().find((r) => r.entry.id === id)?.history ?? [],
  };
}

interface State {
  library: Library;
  resolver: Resolver;
  status: "loading" | "ready" | "failed";
  error?: string;
}

const empty: Library = { blueprints: [], materials: [] };
let state: State = { library: empty, resolver: resolver(empty), status: "loading" };
let backend: Backend | null = null;
let backendKey = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(library: Library, status: State["status"] = "ready", error?: string) {
  state = { library, resolver: resolver(library), status, ...(error ? { error } : {}) };
  emit();
}

let loading: Promise<void> | null = null;
export function refreshLibrary(): Promise<void> {
  if (!backend) return Promise.resolve();
  const b = backend;
  loading = b
    .list()
    .then((lib) => {
      if (b === backend) set(lib);
    })
    .catch((err: Error) => {
      if (b === backend) set(state.library, state.status === "ready" ? "ready" : "failed", err.message);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function useBackend(server: boolean, scope: string) {
  useEffect(() => {
    const key = `${server ? "server" : "demo"}:${scope}`;
    if (key !== backendKey) {
      backendKey = key;
      backend = server ? serverBackend : demoBackend(scope);
      state = { library: empty, resolver: resolver(empty), status: "loading" };
      emit();
      void refreshLibrary();
    } else if (state.status !== "ready" && !loading) void refreshLibrary();
    // A teammate's change shows when this tab is looked at again.
    const onFocus = () => document.visibilityState === "visible" && void refreshLibrary();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [server, scope]);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER_STATE: State = { library: empty, resolver: resolver(empty), status: "loading" };

export interface DesignLibrary extends State {
  create(kind: Kind, body: unknown): Promise<Entry>;
  update(id: string, baseRevision: number, body: unknown): Promise<Entry>;
  remove(id: string): Promise<void>;
  versions(id: string): ReturnType<Backend["versions"]>;
  refresh(): Promise<void>;
}

/** The library, live. `server` and `scope` pick where it is kept (the workspace, or this browser in the demo). */
export function useDesignLibrary(server: boolean, scope: string): DesignLibrary {
  useBackend(server, scope);
  const current = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  return useMemo(() => {
    const need = () => {
      if (!backend) throw new Error("The design library is still loading.");
      return backend;
    };
    const merge = (kind: Kind, entry: Entry) => {
      const list = kind === "blueprint" ? "blueprints" : "materials";
      const rest = (state.library[list] as Entry[]).filter((e) => e.id !== entry.id);
      set({ ...state.library, [list]: [entry, ...rest] });
    };
    return {
      ...current,
      async create(kind, body) {
        const entry = await need().create(kind, body);
        merge(kind, entry);
        return entry;
      },
      async update(id, baseRevision, body) {
        const kind: Kind = state.library.blueprints.some((b) => b.id === id) ? "blueprint" : "material";
        try {
          const entry = await need().update(id, baseRevision, body);
          merge(kind, entry);
          return entry;
        } catch (err) {
          if (err instanceof LibraryConflict) merge(kind, err.current);
          throw err;
        }
      },
      async remove(id) {
        await need().remove(id);
        set({ blueprints: state.library.blueprints.filter((b) => b.id !== id), materials: state.library.materials.filter((m) => m.id !== id) });
      },
      versions: (id) => need().versions(id),
      refresh: refreshLibrary,
    };
  }, [current]);
}

export { bodyOf } from "./body";
