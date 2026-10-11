import type {
  NewProjectRequest,
  ProjectMutation,
} from "@/lib/projects/mutations";
import type { Brief, Project } from "./types";

interface PendingBrief {
  patch: Brief;
  fromAi: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export interface ProjectSyncOptions {
  /** Projects as the server saved them, delivered once no write is in flight (see below). */
  onSaved: (saved: { project: Project; previousId: string }[]) => void;
  fetchImpl?: typeof fetch;
  briefDelayMs?: number;
}

/**
 * Sends the browser's project changes to the server, one at a time and in the
 * order they were made, so the server applies them as the person made them.
 *
 * Screens update straight away and the server's copy comes back afterwards.
 * Saved copies are held until no write is in flight, because a reply to an
 * earlier write does not yet include the later ones and would briefly undo
 * them on screen.
 *
 * Brief typing is gathered per project and sent after a pause, as one patch.
 */
export class ProjectSync {
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private briefInFlight = 0;
  private saved = new Map<string, { project: Project; previousId: string }>();
  private briefs = new Map<string, PendingBrief>();
  private briefWrites = new Map<string, Promise<void>>();
  private failedBriefs = new Map<
    string,
    Pick<PendingBrief, "patch" | "fromAi">[]
  >();
  /** Counts writes ever started, so a load can tell whether one began while it was out. */
  private writes = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly briefDelayMs: number;
  private onError: (err: unknown) => void = () => {};

  constructor(private readonly options: ProjectSyncOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.briefDelayMs = options.briefDelayMs ?? 800;
  }

  /** Called when a write fails; the browser's copy may then differ from the server's. */
  setErrorHandler(handler: (err: unknown) => void): void {
    this.onError = handler;
  }

  /** True when nothing is waiting to be sent or still on its way. */
  get idle(): boolean {
    return (
      this.inFlight === 0 &&
      this.briefInFlight === 0 &&
      this.briefs.size === 0 &&
      this.failedBriefs.size === 0
    );
  }

  /**
   * Every project as the server has it, or null when that would be out of date
   * on arrival: a change was made here while the load was out, so the
   * snapshot may predate it.
   */
  async load(): Promise<Project[] | null> {
    const startedAt = this.writes;
    const res = await this.fetchImpl("/api/projects", { cache: "no-store" });
    if (!res.ok) throw new Error(`Loading projects failed (${res.status})`);
    const { projects } = (await res.json()) as { projects: Project[] };
    return this.writes === startedAt && this.idle ? projects : null;
  }

  mutate(projectId: string, mutation: ProjectMutation): Promise<Project> {
    return this.send(
      projectId,
      `/api/projects/${encodeURIComponent(projectId)}`,
      "PATCH",
      mutation,
    );
  }

  /** Resolves with the project as saved, whose id differs from the one asked for if that was taken. */
  create(input: NewProjectRequest): Promise<Project> {
    return this.send(input.id, "/api/projects", "POST", input);
  }

  /** Brief edits not yet sent, so a saved copy arriving meanwhile can be shown with them on top. */
  pendingBrief(
    projectId: string,
  ): { patch: Brief; fromAi: boolean } | undefined {
    const pending = this.briefs.get(projectId);
    return pending && { patch: pending.patch, fromAi: pending.fromAi };
  }

  queueBrief(projectId: string, patch: Brief, fromAi: boolean): void {
    this.writes++;
    const pending = this.briefs.get(projectId);
    // AI drafts and a person's edits mark fields differently, so they are never merged into one patch.
    if (pending && pending.fromAi !== fromAi)
      this.flushBrief(projectId).catch(() => undefined);
    const current = this.briefs.get(projectId);
    if (current) clearTimeout(current.timer);
    this.briefs.set(projectId, {
      patch: { ...current?.patch, ...patch },
      fromAi,
      // A failure is reported through onError; nobody awaits a timed send.
      timer: setTimeout(
        () => this.flushBrief(projectId).catch(() => undefined),
        this.briefDelayMs,
      ),
    });
  }

  /** Sends a project's pending brief edits now; resolves once the server has them. */
  flushBrief(projectId: string): Promise<void> {
    const pending = this.briefs.get(projectId);
    const failed = this.failedBriefs.get(projectId) ?? [];
    if (!pending && !failed.length)
      return (
        this.briefWrites.get(projectId) ?? this.chain.then(() => undefined)
      );
    if (pending) {
      clearTimeout(pending.timer);
      this.briefs.delete(projectId);
    }
    this.failedBriefs.delete(projectId);
    const batches = [...failed, ...(pending ? [pending] : [])];
    this.briefInFlight++;
    const work = (async () => {
      try {
        for (let n = 0; n < batches.length; n++) {
          const batch = batches[n];
          try {
            await this.mutate(projectId, {
              type: "updateBrief",
              patch: batch.patch,
              fromAi: batch.fromAi,
            });
          } catch (err) {
            // Keep failed batches in order, preserving AI markers and later human edits.
            this.failedBriefs.set(projectId, [
              ...batches.slice(n),
              ...(this.failedBriefs.get(projectId) ?? []),
            ]);
            throw err;
          }
        }
      } finally {
        this.briefInFlight--;
        this.deliver();
      }
    })();
    this.briefWrites.set(projectId, work);
    return work;
  }

  flushAll(): Promise<void> {
    return Promise.all(
      [
        ...new Set([
          ...this.briefs.keys(),
          ...this.failedBriefs.keys(),
          ...this.briefWrites.keys(),
        ]),
      ].map((id) => this.flushBrief(id)),
    ).then(() => undefined);
  }

  private send(
    projectId: string,
    url: string,
    method: string,
    body: unknown,
  ): Promise<Project> {
    this.inFlight++;
    this.writes++;
    const json = JSON.stringify(body);
    const run = this.chain.then(async () => {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: json,
          // Lets a write made just before the tab closes still arrive (browsers cap these at 64 KB).
          keepalive: json.length < 60_000,
        });
        if (!res.ok) throw new Error(`Saving failed (${res.status})`);
        const { project } = (await res.json()) as { project: Project };
        this.saved.set(projectId, { project, previousId: projectId });
        return project;
      } finally {
        this.inFlight--;
      }
    });
    this.chain = run.catch(() => undefined);
    return run.then(
      (project) => {
        this.deliver();
        return project;
      },
      (err) => {
        this.saved.clear();
        this.onError(err);
        throw err;
      },
    );
  }

  private deliver() {
    if (
      this.inFlight > 0 ||
      this.briefInFlight > 0 ||
      this.failedBriefs.size > 0 ||
      !this.saved.size
    )
      return;
    const saved = Array.from(this.saved.values());
    this.saved.clear();
    this.options.onSaved(saved);
  }
}
