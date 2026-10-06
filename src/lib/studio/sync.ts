import type { NewProjectRequest, ProjectMutation } from "@/lib/projects/mutations";
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
  private saved = new Map<string, { project: Project; previousId: string }>();
  private briefs = new Map<string, PendingBrief>();
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
    return this.inFlight === 0 && this.briefs.size === 0;
  }

  async load(): Promise<Project[]> {
    const res = await this.fetchImpl("/api/projects", { cache: "no-store" });
    if (!res.ok) throw new Error(`Loading projects failed (${res.status})`);
    return ((await res.json()) as { projects: Project[] }).projects;
  }

  mutate(projectId: string, mutation: ProjectMutation): Promise<void> {
    return this.send(projectId, `/api/projects/${encodeURIComponent(projectId)}`, "PATCH", mutation);
  }

  create(input: NewProjectRequest): Promise<void> {
    return this.send(input.id, "/api/projects", "POST", input);
  }

  /** Brief edits not yet sent, so a saved copy arriving meanwhile can be shown with them on top. */
  pendingBrief(projectId: string): { patch: Brief; fromAi: boolean } | undefined {
    const pending = this.briefs.get(projectId);
    return pending && { patch: pending.patch, fromAi: pending.fromAi };
  }

  queueBrief(projectId: string, patch: Brief, fromAi: boolean): void {
    const pending = this.briefs.get(projectId);
    // AI drafts and a person's edits mark fields differently, so they are never merged into one patch.
    if (pending && pending.fromAi !== fromAi) this.flushBrief(projectId).catch(() => undefined);
    const current = this.briefs.get(projectId);
    if (current) clearTimeout(current.timer);
    this.briefs.set(projectId, {
      patch: { ...current?.patch, ...patch },
      fromAi,
      // A failure is reported through onError; nobody awaits a timed send.
      timer: setTimeout(() => this.flushBrief(projectId).catch(() => undefined), this.briefDelayMs),
    });
  }

  /** Sends a project's pending brief edits now; resolves once the server has them. */
  flushBrief(projectId: string): Promise<void> {
    const pending = this.briefs.get(projectId);
    if (!pending) return this.chain.then(() => undefined);
    clearTimeout(pending.timer);
    this.briefs.delete(projectId);
    return this.mutate(projectId, { type: "updateBrief", patch: pending.patch, fromAi: pending.fromAi });
  }

  flushAll(): Promise<void> {
    return Promise.all(Array.from(this.briefs.keys()).map((id) => this.flushBrief(id))).then(() => undefined);
  }

  private send(projectId: string, url: string, method: string, body: unknown): Promise<void> {
    this.inFlight++;
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
      } finally {
        this.inFlight--;
      }
    });
    this.chain = run.catch(() => undefined);
    return run.then(
      () => this.deliver(),
      (err) => {
        this.saved.clear();
        this.onError(err);
        throw err;
      }
    );
  }

  private deliver() {
    if (this.inFlight > 0 || !this.saved.size) return;
    const saved = Array.from(this.saved.values());
    this.saved.clear();
    this.options.onSaved(saved);
  }
}
