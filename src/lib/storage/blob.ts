import { get, head } from "@vercel/blob";

/**
 * Project files live in Vercel Blob, as private blobs: nobody can open one
 * without going through the app, which checks the workspace first. Browsers
 * upload straight to storage (server functions cap request bodies at 4.5 MB),
 * with a short-lived token the app issues for one path inside the project.
 *
 * Storage is on once the Blob store is connected to the Vercel project, which
 * sets BLOB_READ_WRITE_TOKEN. Without it, uploads record only the file's name.
 */

export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export function isStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Every file of a project sits under this path, so a path names the project it belongs to. */
export function projectPrefix(workspaceId: string, projectId: string): string {
  return `workspaces/${workspaceId}/projects/${projectId}/`;
}

/** True when a storage path is a plain file path inside the project's folder. */
export function isInProject(pathname: string, workspaceId: string, projectId: string): boolean {
  const prefix = projectPrefix(workspaceId, projectId);
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  return rest.length > 0 && rest.length <= 400 && !rest.split("/").some((part) => part === "" || part === "." || part === "..");
}

export interface StoredFile {
  size: number;
  contentType: string;
}

/** What storage holds at a path, or null when nothing was uploaded there. */
export async function statFile(pathname: string): Promise<StoredFile | null> {
  try {
    const blob = await head(pathname);
    return { size: blob.size, contentType: blob.contentType };
  } catch {
    return null;
  }
}

/** The file's bytes as a stream, or null when it is missing. */
export async function openFile(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null> {
  const result = await get(pathname, { access: "private" });
  if (!result?.stream) return null;
  return {
    stream: result.stream,
    size: result.blob.size ?? 0,
    contentType: result.blob.contentType ?? "application/octet-stream",
  };
}

/** A stored file's bytes, or null when it is missing or larger than `maxBytes`. */
export async function readFileBytes(pathname: string, maxBytes = 25 * 1024 * 1024): Promise<Uint8Array | null> {
  const file = await openFile(pathname).catch(() => null);
  if (!file) return null;
  if (file.size > maxBytes) {
    await file.stream.cancel().catch(() => {});
    return null;
  }
  return new Uint8Array(await new Response(file.stream).arrayBuffer());
}
