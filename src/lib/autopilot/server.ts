import { after } from "next/server";
import type { Db } from "@/lib/db";
import { isInProject, readFileBytes } from "@/lib/storage/blob";
import { runAutopilot, runDueAutopilots } from "./run";
import type { RunTrigger } from "./store";

/** Reads a stored file of one project only. */
export const projectFileReader = (workspaceId: string, projectId: string) => (key: string) =>
  isInProject(key, workspaceId, projectId) ? readFileBytes(key) : Promise.resolve(null);

/** Runs one project's autopilot once the response has gone, so she is never kept waiting. */
export function runAfterResponse(db: Db, p: { workspaceId: string; projectId: string; slug: string; userId: string; trigger: RunTrigger }) {
  after(async () => {
    try {
      await runAutopilot({ db, ...p, readFile: projectFileReader(p.workspaceId, p.projectId) });
    } catch (err) {
      console.error(`Autopilot run on ${p.slug} failed`, err);
    }
  });
}

/** When someone opens the app, autopilots in their workspace that are due a look run in the background. */
export function runDueAfterResponse(db: Db, workspaceId: string) {
  after(async () => {
    try {
      await runDueAutopilots(db, { workspaceId, limit: 3, trigger: "visit", readFile: projectFileReader });
    } catch (err) {
      console.error("Due autopilot runs failed", err);
    }
  });
}
