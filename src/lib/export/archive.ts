import { zipStream, textEntry, type ZipEntry } from "./zip";
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024,
  MAX_ARCHIVE_FILES = 2000;
export class ExportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface ArchiveFile {
  documentId: string;
  version: number;
  name: string;
  phase: string;
  sizeBytes: number;
  current: boolean;
  storageKey: string;
  path: string;
}
export interface ProjectArchive {
  takenAt: string;
  projectName: string;
  slug: string;
  data: Record<string, unknown>;
  files: ArchiveFile[];
}
function safeName(name: string) {
  return (
    name
      .replace(/[\x00-\x1f\x7f/\\:<>"|?*]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 180) || "document"
  );
}
export function pathFor(
  f: Pick<ArchiveFile, "documentId" | "version" | "name">,
) {
  return `documents/${f.documentId}/v${f.version}-${safeName(f.name)}`;
}
export function validateArchive(archive: ProjectArchive) {
  if (
    archive.files.some(
      (f) => !Number.isSafeInteger(f.sizeBytes) || f.sizeBytes < 0,
    )
  )
    throw new ExportError("Invalid document size.");
  if (archive.files.length > MAX_ARCHIVE_FILES)
    throw new ExportError("This export has more than 2,000 document versions.");
  const size = archive.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_ARCHIVE_BYTES - 10 * 1024 * 1024
  )
    throw new ExportError("This export exceeds the 2 GB archive limit.");
}
export function archiveSummary(archive: ProjectArchive) {
  return {
    projectName: archive.projectName,
    takenAt: archive.takenAt,
    versions: archive.files.length,
    documents: new Set(archive.files.map((f) => f.documentId)).size,
    storedVersions: archive.files.filter((f) => f.storageKey).length,
    totalBytes: archive.files.reduce((sum, f) => sum + f.sizeBytes, 0),
    unuploadedVersions: archive.files
      .filter((f) => !f.storageKey)
      .map((f) => ({
        documentId: f.documentId,
        version: f.version,
        name: f.name,
      })),
  };
}
type Opener = (
  path: string,
) => Promise<{
  stream: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
} | null>;
export function projectArchiveStream(archive: ProjectArchive, opener: Opener) {
  async function* entries(): AsyncGenerator<ZipEntry> {
    yield textEntry(
      "README.txt",
      "Fundur project archive\n\nSaved project data, the pinned workflow, floor-plan geometry/history, boards, selections, quotation requests, tasks, phase snapshots and AI conversation records are in data/.\nOriginal uploaded documents and every stored version are in documents/.\nRead manifest.json for document IDs, versions, original names, current pointers and any missing/unuploaded files. The archive is complete only when manifest.complete is true.\nThis is a private designer archive, not a client handover or an automatic restore package. Workspace supplier libraries, provider credentials and client share-link tokens are excluded.\n",
    );
    yield textEntry(
      "data/project.json",
      JSON.stringify(
        {
          format: "fundur-project-archive",
          version: 1,
          takenAt: archive.takenAt,
          ...archive.data,
        },
        null,
        2,
      ),
    );
    const results = [];
    for (const f of archive.files) {
      const { storageKey, ...metadata } = f;
      if (!storageKey) {
        results.push({ ...metadata, status: "not_uploaded" });
        continue;
      }
      const opened = await opener(storageKey);
      if (!opened) {
        results.push({ ...metadata, status: "missing_from_storage" });
        continue;
      }
      try {
        yield { name: f.path, data: opened.stream, expectedSize: opened.size };
      } finally {
        await opened.stream.cancel().catch(() => {});
      }
      results.push({ ...metadata, sizeBytes: opened.size, status: "included" });
    }
    yield textEntry(
      "manifest.json",
      JSON.stringify(
        {
          format: "fundur-project-archive",
          version: 1,
          takenAt: archive.takenAt,
          projectName: archive.projectName,
          complete: results.every((r) => r.status === "included"),
          files: results,
        },
        null,
        2,
      ),
    );
  }
  return zipStream(entries(), MAX_ARCHIVE_BYTES);
}
