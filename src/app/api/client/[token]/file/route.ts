import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { getDb } from "@/lib/db";
import { openFile } from "@/lib/storage/blob";
import { clientDocumentFile, openClientInvite } from "@/lib/team/store";
import { clientPage } from "@/lib/team/client-view";
import { PUBLIC_HEADERS } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";

/** A document the studio shared on the client's page, for the invited person only. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const unavailable = () => NextResponse.json({ error: "This file is unavailable" }, { status: 404, headers: PUBLIC_HEADERS });
  const db = getDb();
  if (!db || !auth0) return unavailable();
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const opened = await openClientInvite(db, (await params).token, { email: session.user.email, emailVerified: session.user.email_verified }, false);
  if (!opened.ok) return unavailable();
  const documentId = new URL(req.url).searchParams.get("documentId") ?? "";
  // Only documents the page itself lists: client-visible, in a phase the client sees.
  if (!clientPage(opened.project, opened.settings, opened.studio).documents.some((d) => d.id === documentId)) return unavailable();
  const file = await clientDocumentFile(db, opened.workspaceId, opened.projectDbId, documentId);
  const stored = file && (await openFile(file.pathname));
  if (!file || !stored) return unavailable();
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(stored.stream, {
    headers: {
      ...PUBLIC_HEADERS,
      "Content-Type": "application/octet-stream",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      ...(stored.size ? { "Content-Length": String(stored.size) } : {}),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    },
  });
}
