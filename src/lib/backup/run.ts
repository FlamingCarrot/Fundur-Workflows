import type { Db } from "@/lib/db";
import { isStorageConfigured, statFile } from "@/lib/storage/blob";
import { takeBackup, type Backup, type FileEntry } from "./backup";

/**
 * The daily run: take the backup, check a sample of the files it lists are
 * really in storage, and keep it next to them. Backups live under
 * `backups/` in the same Blob store; the files themselves are not copied,
 * because the store keeps them and a copy would only double the cost.
 */

export const BACKUP_PREFIX = "backups/";
/** Daily backups are kept for this long. */
export const KEEP_DAYS = 30;
/** How many files are checked each run; enough to notice a store going wrong without listing all of them. */
export const FILE_SAMPLE = 20;

export interface BackupResult {
  path: string | null;
  takenAt: string;
  counts: Record<string, number>;
  files: number;
  /** Files in the backup that storage does not have. Anything here needs looking at. */
  missingFiles: string[];
  removed: number;
}

export function sampleFiles(files: FileEntry[], size = FILE_SAMPLE): FileEntry[] {
  if (files.length <= size) return files;
  const step = Math.ceil(files.length / size);
  return files.filter((_, i) => i % step === 0).slice(0, size);
}

export interface BackupStorage {
  put(path: string, body: string): Promise<{ pathname: string }>;
  list(prefix: string): Promise<{ pathname: string; uploadedAt: Date }[]>;
  remove(paths: string[]): Promise<void>;
}

/** Vercel Blob, loaded only when it is configured, so tests need no token. */
async function blobStorage(): Promise<BackupStorage> {
  const { put, list, del } = await import("@vercel/blob");
  return {
    put: (path, body) => put(path, body, { access: "private", addRandomSuffix: false, contentType: "application/json" }),
    list: async (prefix) => (await list({ prefix })).blobs.map((b) => ({ pathname: b.pathname, uploadedAt: b.uploadedAt })),
    remove: (paths) => del(paths),
  };
}

export async function runBackup(
  db: Db,
  options: { storage?: BackupStorage | null; now?: Date; statImpl?: typeof statFile } = {}
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const stat = options.statImpl ?? statFile;
  const backup = await takeBackup(db);

  const missingFiles: string[] = [];
  for (const file of sampleFiles(backup.files)) {
    if (!(await stat(file.key))) missingFiles.push(file.key);
  }

  const storage = options.storage !== undefined ? options.storage : isStorageConfigured() ? await blobStorage() : null;
  if (!storage) {
    return {
      path: null,
      takenAt: backup.takenAt,
      counts: backup.counts,
      files: backup.files.length,
      missingFiles,
      removed: 0,
    };
  }

  const path = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json`;
  const saved = await storage.put(path, JSON.stringify(backup satisfies Backup));

  // Older than the retention; the day's own backup is never among them.
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const old = (await storage.list(BACKUP_PREFIX)).filter(
    (b) => b.pathname !== saved.pathname && new Date(b.uploadedAt).getTime() < cutoff
  );
  if (old.length) await storage.remove(old.map((b) => b.pathname));

  return {
    path: saved.pathname,
    takenAt: backup.takenAt,
    counts: backup.counts,
    files: backup.files.length,
    missingFiles,
    removed: old.length,
  };
}
