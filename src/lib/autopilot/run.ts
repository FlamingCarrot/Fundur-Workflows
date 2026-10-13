import type { Db } from "@/lib/db";
import type { ChatFn } from "@/lib/ai/chat-stream";
import { runTurn, type StreamEvent } from "@/lib/ai/orchestrator";
import type { ToolContext } from "@/lib/ai/tools";
import { getProject } from "@/lib/projects/store";
import { canAccessProject, features as workspaceFeatures, memberships } from "@/lib/workspaces/store";
import {
  agendaMessage,
  autopilotAgenda,
  autopilotDecision,
  autopilotInstructions,
  AUTOPILOT_EXCLUDED_TOOLS,
  AUTOPILOT_PLAN_TOOLS,
  MAX_RUNS_PER_DAY,
  phaseLevel,
} from "./model";
import {
  claimRun,
  finishRun,
  getAutopilot,
  lastClientUpdate,
  markAnswersRead,
  nextOnCadence,
  projectAsks,
  recentSummaries,
  releaseRun,
  runsToday,
  startRun,
  unreadAnswers,
  type RunTrigger,
} from "./store";

/**
 * One autopilot run on one project: works out the agenda, and when there is
 * something to do, has the assistant work through it on her behalf under the
 * levels she set. Its reply lands in the project chat with an Undo on each
 * change; what it needs from her lands in her inbox.
 */

export interface RunOptions {
  db: Db;
  workspaceId: string;
  /** The project's database id and slug. */
  projectId: string;
  slug: string;
  /** Who it acts as: the person who pressed Run, else whoever turned it on. */
  userId: string;
  trigger: RunTrigger;
  isAdmin?: boolean;
  readFile?: ToolContext["readFile"];
  chat?: ChatFn;
  fetchImpl?: typeof fetch;
  emit?: (e: StreamEvent) => void;
  now?: Date;
}

export type RunOutcome =
  | { status: "skipped"; reason: string }
  | { status: "idle"; runId: string; reason: string }
  | { status: "done" | "failed"; runId: string; summary: string; applied: number; review: number; asked: number; messageId: string };

/** The person it acts as must still be in the workspace with access to the project and AI. */
async function mayActAs(db: Db, workspaceId: string, userId: string, slug: string) {
  const [user] = await db.query<{ status: string; active: boolean }>("SELECT status, active FROM users WHERE id = $1", [userId]);
  if (!user || user.status !== "active" || user.active === false) return null;
  const member = (await memberships(db, userId)).find((m) => m.id === workspaceId);
  if (!member || member.role === "collaborator") return null;
  if (!(await canAccessProject(db, workspaceId, userId, member.role, slug))) return null;
  const features = await workspaceFeatures(db, workspaceId, userId);
  return features.ai === false ? null : features;
}

export async function runAutopilot(opts: RunOptions): Promise<RunOutcome> {
  const { db, workspaceId, projectId, slug, userId, trigger } = opts;
  const settings = await getAutopilot(db, projectId);
  if (trigger !== "manual" && (!settings.enabled || settings.paused)) return { status: "skipped", reason: "The autopilot is off or paused" };
  const features = await mayActAs(db, workspaceId, userId, slug);
  if (!features) return { status: "skipped", reason: "The person it acts as can no longer use AI on this project" };
  if (trigger !== "manual" && (await runsToday(db, projectId)) >= MAX_RUNS_PER_DAY) return { status: "skipped", reason: "It has run enough today" };
  // Run now works before it was ever turned on, so make sure there is a row to lock.
  await db.query("INSERT INTO project_autopilot (project_id, workspace_id) VALUES ($1, $2) ON CONFLICT (project_id) DO NOTHING", [projectId, workspaceId]);
  if (!(await claimRun(db, projectId))) return { status: "skipped", reason: "It is already running" };

  let runId: string | null = null;
  let next: { at: Date | null; reason: string | null } = { at: nextOnCadence(settings.cadence, opts.now), reason: null };
  try {
    const project = await getProject(db, workspaceId, slug);
    if (!project) {
      next = { at: null, reason: null };
      return { status: "skipped", reason: "Project not found" };
    }
    const answered = await unreadAnswers(db, projectId);
    const open = await projectAsks(db, projectId, "open");
    const agenda = autopilotAgenda(project, settings.levels, {
      answered: answered.map((a) => ({ id: a.id, title: a.title, answer: a.answer ?? "", files: a.files.map((f) => f.name) })),
      openAsks: open.map((a) => ({ id: a.id, title: a.title })),
      lastClientUpdate: await lastClientUpdate(db, projectId),
    });
    runId = await startRun(db, workspaceId, projectId, userId, trigger);
    if (!agenda.length) {
      const reason = project.status === "active" ? "Nothing needs doing right now" : "The project is not active";
      await finishRun(db, runId, { status: "idle", summary: reason });
      return { status: "idle", runId, reason };
    }

    const state = { runId, asked: 0, nextCheck: null as { at: Date; reason: string } | null };
    const exclude = new Set(AUTOPILOT_EXCLUDED_TOOLS);
    if (phaseLevel(settings.levels, project.currentPhase) !== "auto") for (const t of AUTOPILOT_PLAN_TOOLS) exclude.add(t);
    const result = await runTurn(
      {
        db,
        workspaceId,
        projectId,
        userId,
        project,
        readFile: opts.readFile ?? (async () => null),
        chat: opts.chat,
        fetchImpl: opts.fetchImpl,
        isAdmin: opts.isAdmin,
        features,
      },
      {
        text: agendaMessage(agenda, await recentSummaries(db, projectId), open.map((a) => ({ id: a.id, title: a.title }))),
        attachments: [],
        autopilot: {
          state,
          instructions: autopilotInstructions(settings.levels, project),
          decide: (current, action) => autopilotDecision(current, settings.levels, action),
          exclude,
        },
      },
      opts.emit ?? (() => {})
    );
    await markAnswersRead(db, answered.map((a) => a.id));
    if (state.nextCheck) next = { at: state.nextCheck.at, reason: state.nextCheck.reason };
    const summary = result.reply.trim() || (result.failed ? "The run stopped with a problem." : "Worked through the agenda.");
    const status = result.failed ? "failed" : "done";
    await finishRun(db, runId, { status, summary, messageId: result.messageId, applied: result.applied, review: result.review, asked: state.asked });
    return { status, runId, summary, applied: result.applied, review: result.review, asked: state.asked, messageId: result.messageId };
  } catch (err) {
    if (runId) await finishRun(db, runId, { status: "failed", summary: "The run stopped with a problem." }).catch(() => {});
    throw err;
  } finally {
    await releaseRun(db, projectId, next);
  }
}

/**
 * Runs every autopilot that is due (for one workspace when given), a few at a
 * time. Used by the daily cron and when someone opens the app.
 */
export async function runDueAutopilots(
  db: Db,
  opts: { limit?: number; workspaceId?: string; readFile?: (workspaceId: string, projectId: string) => ToolContext["readFile"]; chat?: ChatFn; trigger?: RunTrigger } = {}
): Promise<{ slug: string; status: string }[]> {
  const { dueProjects } = await import("./store");
  const due = await dueProjects(db, opts.limit ?? 10, opts.workspaceId);
  const out: { slug: string; status: string }[] = [];
  for (const d of due) {
    try {
      const r = await runAutopilot({
        db,
        workspaceId: d.workspaceId,
        projectId: d.projectId,
        slug: d.slug,
        userId: d.runAs,
        trigger: opts.trigger ?? "schedule",
        readFile: opts.readFile?.(d.workspaceId, d.projectId),
        chat: opts.chat,
      });
      out.push({ slug: d.slug, status: r.status });
      // A skipped project would be picked again at once; push it to its next slot.
      if (r.status === "skipped") {
        const s = await getAutopilot(db, d.projectId);
        await db.query("UPDATE project_autopilot SET next_run_at = $2 WHERE project_id = $1 AND running_since IS NULL", [d.projectId, nextOnCadence(s.cadence)?.toISOString() ?? null]);
      }
    } catch (err) {
      console.error(`Autopilot run on ${d.slug} failed`, err);
      out.push({ slug: d.slug, status: "failed" });
    }
  }
  return out;
}
