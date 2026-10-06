import { isInProject, statFile, type StoredFile } from "@/lib/storage/blob";
import { MutationError } from "./store";
import type { ProjectMutation } from "./mutations";

/**
 * Checks the files a change points at before it is saved: each must sit in
 * this project's storage folder and actually be there. Sizes are taken from
 * storage rather than from the browser. Changes without files pass unchanged.
 */
export async function checkStoredFiles(
  m: ProjectMutation,
  workspaceId: string,
  projectId: string,
  stat: (pathname: string) => Promise<StoredFile | null> = statFile
): Promise<ProjectMutation> {
  const check = async (pathname: string) => {
    if (!isInProject(pathname, workspaceId, projectId)) throw new MutationError("That file belongs to another project");
    const file = await stat(pathname);
    if (!file) throw new MutationError("That file did not finish uploading");
    return file;
  };
  if (m.type === "addDocuments") {
    const documents = await Promise.all(
      m.documents.map(async (d) => (d.storageKey ? { ...d, sizeBytes: (await check(d.storageKey)).size } : d))
    );
    return { ...m, documents };
  }
  if (m.type === "replaceDocumentFile") {
    return { ...m, sizeBytes: (await check(m.storageKey)).size };
  }
  return m;
}
