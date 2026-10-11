import { designDataSchema, type DesignState, type DesignData } from "./schema";
import { emptyDesign } from "./model";
import { uploadToProject } from "@/lib/studio/uploads";
import type { Project, ProjectDocument } from "@/lib/studio/types";
export class SaveConflict extends Error {
  constructor(public current: DesignState) {
    super("This project changed in another window.");
  }
}
export async function designRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body.current) throw new SaveConflict(body.current);
  if (!res.ok)
    throw new Error(body.error || "Could not load this project. Please retry.");
  return body as T;
}
export interface DesignBackend {
  load(): Promise<DesignState>;
  save(data: DesignData, baseRevision: number): Promise<DesignState>;
}
export async function uploadDesignImage(
  projectId: string,
  file: File,
  phaseKey: string,
  onProgress?: (n: number) => void,
) {
  if (
    !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG, GIF or WebP image up to 20 MB.");
  const storageKey = await uploadToProject(projectId, file, onProgress);
  const doc: ProjectDocument = {
    id: crypto.randomUUID(),
    name: file.name,
    sizeBytes: file.size,
    phaseKey,
    uploadedAt: new Date().toISOString(),
    clientVisible: false,
    storageKey,
    stored: true,
    version: 1,
  };
  const result = await designRequest<{ project: Project }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ type: "addDocuments", documents: [doc] }),
    },
  );
  return { ...result, doc };
}
export function designBackend(
  projectId: string,
  scope: string,
  server: boolean,
): DesignBackend {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/design`;
  const key = `fundur.design.demo.${scope}.${projectId}`;
  const read = (): DesignState => {
    const raw = localStorage.getItem(key);
    if (!raw) return { data: emptyDesign(), revision: 0 };
    const state = JSON.parse(raw) as DesignState;
    return { ...state, data: designDataSchema.parse(state.data) };
  };
  return server
    ? {
        load: () => designRequest(endpoint),
        save: (data, baseRevision) =>
          designRequest(endpoint, {
            method: "PUT",
            body: JSON.stringify({ data, baseRevision }),
          }),
      }
    : {
        load: async () => read(),
        save: async (data, baseRevision) => {
          const current = read();
          if (current.revision !== baseRevision)
            throw new SaveConflict(current);
          const state = {
            data: designDataSchema.parse(data),
            revision: baseRevision + 1,
            updatedAt: new Date().toISOString(),
          };
          localStorage.setItem(key, JSON.stringify(state));
          return state;
        },
      };
}
