"use client";

import { upload } from "@vercel/blob/client";

/** The largest file the app takes; the server enforces the same limit. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const prefixes = new Map<string, Promise<string>>();

/** The storage folder an upload endpoint hands out, asked once per endpoint. */
function folderOf(endpoint: string): Promise<string> {
  let prefix = prefixes.get(endpoint);
  if (!prefix) {
    prefix = fetch(endpoint, { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "File storage is not available");
      return body.prefix as string;
    });
    prefix.catch(() => prefixes.delete(endpoint));
    prefixes.set(endpoint, prefix);
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
  return uploadThrough(`/api/projects/${encodeURIComponent(projectId)}/uploads`, file, onProgress, signal);
}

/**
 * Uploads a file through an upload endpoint (GET gives the folder, POST the
 * one-off upload permission): a project's, or an invited client's.
 */
export async function uploadThrough(
  endpoint: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  maxBytes = MAX_UPLOAD_BYTES
): Promise<string> {
  if (file.size > maxBytes) throw new Error(`${file.name} is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
  const prefix = await folderOf(endpoint);
  const blob = await upload(`${prefix}${safeName(file.name)}`, file, {
    access: "private",
    handleUploadUrl: endpoint,
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
