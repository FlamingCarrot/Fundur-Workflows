import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { getDb } from "@/lib/db";
import type { Permission } from "@/lib/auth/permissions";
import { projectDbId } from "@/lib/projects/store";
import { requireProject, type ProjectContext } from "@/lib/server/workspace-context";
import { openClientInvite } from "@/lib/team/store";
import { isInProject, projectPrefix, statFile } from "@/lib/storage/blob";
import { AccessError } from "@/lib/workspaces/store";
import { teamFailure, teamJson } from "@/lib/team/http";
import type { CommsScope } from "./store";
import { clientKey, type AttachmentInput } from "./types";

export { teamJson as commsJson, teamFailure as commsFailure };

/** The project section these routes belong to, so a teammate it is hidden from is refused. */
export const COMMS_TOOL = "conversations";

/** A teammate's scope on a project, or the refusal to send back. */
export async function teamScope(slug: string, permission: Permission = "project:view"): Promise<(CommsScope & { ctx: ProjectContext }) | NextResponse> {
  const ctx = await requireProject(slug, permission, undefined, COMMS_TOOL);
  if (ctx instanceof NextResponse) return ctx;
  const projectId = await projectDbId(ctx.db, ctx.workspaceId, slug);
  if (!projectId) return teamJson({ error: "Project not found" }, 404);
  return {
    ctx,
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    projectId,
    slug,
    person: { key: ctx.user.id, name: ctx.user.name || ctx.user.email || "Teammate", kind: "team" },
    manager: ctx.workspaceRole === "owner",
  };
}

/**
 * An invited client's scope, from their client-page link. It opens only for
 * someone signed in with the invited, verified email address.
 */
export async function clientScope(token: string): Promise<CommsScope | NextResponse> {
  const db = getDb();
  if (!db || !auth0) return teamJson({ error: "This page is unavailable" }, 404);
  const session = await auth0.getSession();
  if (!session) return teamJson({ error: "Sign in required" }, 401);
  const opened = await openClientInvite(db, token, { email: session.user.email, emailVerified: session.user.email_verified }, false);
  if (!opened.ok) return teamJson({ error: "This page is unavailable" }, 404);
  const email = String(session.user.email);
  return {
    db,
    workspaceId: opened.workspaceId,
    projectId: opened.projectDbId,
    slug: opened.project.id,
    person: { key: clientKey(email), name: String(session.user.name || email).slice(0, 255), kind: "client" },
    manager: false,
  };
}

/** The largest file an invited client can send. */
export const CLIENT_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Where an invited client's files go: a folder of their own inside the project's, named from their email. */
export function clientUploadPrefix(s: Pick<CommsScope, "workspaceId" | "projectId" | "person">): string {
  const who = s.person.key.replace(/^client:/, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "client";
  return `${projectPrefix(s.workspaceId, s.projectId)}from-client/${who}/`;
}

/** Files sent with a post must have finished uploading into this project's folder; sizes come from storage. */
export async function checkedAttachments(s: CommsScope, files: AttachmentInput[] = []): Promise<AttachmentInput[]> {
  const out: AttachmentInput[] = [];
  for (const a of files) {
    if (!isInProject(a.storageKey, s.workspaceId, s.projectId)) throw new AccessError("That file belongs to another project", 400);
    // A client can only send files they uploaded themselves.
    if (s.person.kind === "client" && !a.storageKey.startsWith(clientUploadPrefix(s))) throw new AccessError("That file is not yours to send", 400);
    const stored = await statFile(a.storageKey);
    if (!stored) throw new AccessError(`${a.name} did not finish uploading`, 400);
    out.push({ ...a, sizeBytes: stored.size, contentType: a.contentType || stored.contentType });
  }
  return out;
}

export async function readBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/** A stored file as a download that never runs in the page. */
export function fileResponse(stored: { stream: ReadableStream<Uint8Array>; size: number }, name: string, contentType: string, inline = false): Response {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  // Sound, pictures and video may play in the page; anything else downloads.
  const playable = inline && /^(audio|video|image)\/(?!svg)/.test(contentType);
  return new Response(stored.stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": playable ? contentType : "application/octet-stream",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      ...(stored.size ? { "Content-Length": String(stored.size) } : {}),
      "Content-Disposition": `${playable ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
