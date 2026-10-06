"use client";

import { upload } from "@vercel/blob/client";

/** The largest file the app takes; the server enforces the same limit. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const prefixes = new Map<string, Promise<string>>();

/** The project's storage folder, asked once per project. */
function projectPrefix(projectId: string): Promise<string> {
  let prefix = prefixes.get(projectId);
  if (!prefix) {
    prefix = fetch(`/api/projects/${encodeURIComponent(projectId)}/uploads`, { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "File storage is not available");
      return body.prefix as string;
    });
    prefix.catch(() => prefixes.delete(projectId));
    prefixes.set(projectId, prefix);
  }
  return prefix;
}

/** A file name that is safe as the last part of a storage path. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()]+/g, "_").replace(/^[.\s]+/, "").trim();
  return (cleaned || "file").slice(-150);
}

/**
 * Uploads a file straight from the browser into the project's private
 * storage folder and returns where it landed. Large files go up in parts.
 */
export async function uploadToProject(
  projectId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is over the 200 MB limit`);
  const prefix = await projectPrefix(projectId);
  const blob = await upload(`${prefix}${safeName(file.name)}`, file, {
    access: "private",
    handleUploadUrl: `/api/projects/${encodeURIComponent(projectId)}/uploads`,
    multipart: file.size > 20 * 1024 * 1024,
    contentType: file.type || undefined,
    abortSignal: signal,
    onUploadProgress: (e) => onProgress?.(e.percentage / 100),
  });
  return blob.pathname;
}

export function downloadHref(projectId: string, documentId: string, version?: number): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/documents/${documentId}/file`;
  return version == null ? base : `${base}?version=${version}`;
}
