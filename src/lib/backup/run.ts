import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { isStorageConfigured, statFile } from "@/lib/storage/blob";
import { takeBackup, type Backup, type FileEntry } from "./backup";

/**
 * The daily run: take the backup, check a sample of the files it lists are
 * really in storage, and keep it next to them. Backups live under
 * `backups/` in the same private Blob store. Each immutable file is copied
 * once; daily manifests reference that copy until it is no longer retained.
 */

export const BACKUP_PREFIX = "backups/";
export const BACKUP_FILES_PREFIX = "backup-files/";
export function archiveKey(key: string): string {
  return `${BACKUP_FILES_PREFIX}${createHash("sha256").update(key).digest("hex")}`;
}
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
  copiedFiles: number;
  removedCopies: number;
}

export function sampleFiles(
  files: FileEntry[],
  size = FILE_SAMPLE,
): FileEntry[] {
  if (files.length <= size) return files;
  const step = Math.ceil(files.length / size);
  return files.filter((_, i) => i % step === 0).slice(0, size);
}

export interface BackupStorage {
  put(path: string, body: string): Promise<{ pathname: string }>;
  list(prefix: string): Promise<{ pathname: string; uploadedAt: Date }[]>;
  remove(paths: string[]): Promise<void>;
  copy?(
    from: string,
    to: string,
    contentType?: string,
  ): Promise<{ pathname: string }>;
  read?(path: string): Promise<string | null>;
}

/** Vercel Blob, loaded only when it is configured, so tests need no token. */
export async function blobStorage(): Promise<BackupStorage> {
  const { put, list, del, copy, get } = await import("@vercel/blob");
  return {
    put: (path, body) =>
      put(path, body, {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        allowOverwrite: true,
      }),
    list: async (prefix) => {
      const blobs: { pathname: string; uploadedAt: Date }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor });
        blobs.push(
          ...page.blobs.map((b) => ({
            pathname: b.pathname,
            uploadedAt: b.uploadedAt,
          })),
        );
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return blobs;
    },
    copy: (from, to, contentType) =>
      copy(from, to, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
      }),
    read: async (path) => {
      const result = await get(path, { access: "private" });
      return result?.stream ? new Response(result.stream).text() : null;
    },
    remove: (paths) => del(paths),
  };
}

export async function runBackup(
  db: Db,
  options: {
    storage?: BackupStorage | null;
    now?: Date;
    statImpl?: typeof statFile;
  } = {},
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const stat = options.statImpl ?? statFile;
  const backup = await takeBackup(db);

  const missingFiles: string[] = [];
  for (const file of sampleFiles(backup.files)) {
    if (!(await stat(file.key))) missingFiles.push(file.key);
  }

  const storage =
    options.storage !== undefined
      ? options.storage
      : isStorageConfigured()
        ? await blobStorage()
        : null;
  if (!storage) {
    return {
      path: null,
      takenAt: backup.takenAt,
      counts: backup.counts,
      files: backup.files.length,
      missingFiles,
      removed: 0,
      copiedFiles: 0,
      removedCopies: 0,
    };
  }

  let copiedFiles = 0;
  if (storage.copy) {
    // Upload paths cannot be overwritten: one archive copy serves all retained versions.
    const copied = new Map<string, string>();
    for (const file of backup.files) {
      if (copied.has(file.key)) {
        file.backupKey = copied.get(file.key);
        continue;
      }
      const destination = archiveKey(file.key);
      const archived = await stat(destination);
      if (!archived || archived.size !== file.sizeBytes) {
        const original = await stat(file.key);
        if (!original || original.size !== file.sizeBytes) {
          if (!missingFiles.includes(file.key)) missingFiles.push(file.key);
          continue;
        }
        // A damaged archive is reported rather than overwritten silently.
        if (archived)
          throw new Error("An archived file differs from its manifest");
        await storage.copy(file.key, destination, original.contentType);
        copiedFiles++;
      }
      file.backupKey = destination;
      copied.set(file.key, destination);
    }
  }

  const path = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json`;
  const saved = await storage.put(
    path,
    JSON.stringify(backup satisfies Backup),
  );

  // Older than the retention; the day's own backup is never among them.
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  const manifests = (await storage.list(BACKUP_PREFIX)).filter((b) =>
    /^backups\/\d{4}-\d{2}-\d{2}\.json$/.test(b.pathname),
  );
  const old = manifests.filter(
    (b) =>
      b.pathname !== saved.pathname &&
      new Date(b.uploadedAt).getTime() < cutoff,
  );
  if (old.length) await storage.remove(old.map((b) => b.pathname));

  let removedCopies = 0;
  if (storage.read && storage.copy) {
    const referenced = new Set(
      backup.files
        .map((f) => f.backupKey)
        .filter((key): key is string => !!key),
    );
    let allReadable = true;
    for (const manifest of manifests.filter(
      (m) =>
        m.pathname !== saved.pathname &&
        !old.some((o) => o.pathname === m.pathname),
    )) {
      try {
        const raw = await storage.read(manifest.pathname);
        const previous = raw ? (JSON.parse(raw) as Backup) : null;
        if (!previous || !Array.isArray(previous.files)) {
          allReadable = false;
          break;
        }
        for (const file of previous.files)
          if (file.backupKey) referenced.add(file.backupKey);
      } catch {
        allReadable = false;
        break;
      }
    }
    // Never collect copies when even one retained manifest could not be read.
    if (allReadable) {
      const unused = (await storage.list(BACKUP_FILES_PREFIX)).filter(
        (f) =>
          /^backup-files\/[a-f0-9]{64}$/.test(f.pathname) &&
          !referenced.has(f.pathname) &&
          new Date(f.uploadedAt).getTime() < now.getTime() - 86_400_000,
      );
      if (unused.length) {
        await storage.remove(unused.map((f) => f.pathname));
        removedCopies = unused.length;
      }
    }
  }

  return {
    path: saved.pathname,
    takenAt: backup.takenAt,
    counts: backup.counts,
    files: backup.files.length,
    missingFiles,
    removed: old.length,
    copiedFiles,
    removedCopies,
  };
}

/** Restore missing originals from a retained manifest, without overwriting existing work. */
export async function restoreFiles(
  backup: Backup,
  storage: BackupStorage,
  stat: typeof statFile = statFile,
): Promise<string[]> {
  const problems: string[] = [];
  const unique = new Map(backup.files.map((file) => [file.key, file]));
  for (const file of unique.values()) {
    const original = await stat(file.key);
    if (original) {
      if (original.size !== file.sizeBytes)
        problems.push(`${file.name}: the existing file has a different size`);
      continue;
    }
    if (
      !file.backupKey ||
      file.backupKey !== archiveKey(file.key) ||
      !storage.copy
    ) {
      problems.push(`${file.name}: no archived copy is available`);
      continue;
    }
    if (
      !/^workspaces\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36}\//.test(file.key) ||
      file.key
        .split("/")
        .some((part) => part === ".." || part === "." || part === "")
    ) {
      problems.push(`${file.name}: invalid storage path`);
      continue;
    }
    const archived = await stat(file.backupKey);
    if (!archived || archived.size !== file.sizeBytes) {
      problems.push(`${file.name}: archived copy is missing or differs`);
      continue;
    }
    await storage.copy(file.backupKey, file.key, archived.contentType);
  }
  return problems;
}
