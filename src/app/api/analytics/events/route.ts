import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { getDb } from "@/lib/db";
import { usageBatchSchema } from "@/lib/analytics/events";
import { pruneUsage, recordEvents, trackedUser } from "@/lib/analytics/store";
import { usesServerPersistence } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Batches are a few KB; anything far bigger is not from the tracker. */
const MAX_BYTES = 256_000;

/**
 * Stores a batch of usage events from the browser for the signed-in person.
 * Answers 204 whatever happens to the batch, so the tracker never retries
 * or shows anything.
 */
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db || !auth0 || !usesServerPersistence()) return new NextResponse(null, { status: 204 });
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Falls through to the schema's refusal.
  }
  const parsed = usageBatchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Not a usage batch" }, { status: 400 });

  await recordEvents(db, await trackedUser(db, session.user.sub), parsed.data);
  // Old events are cleared now and then, rather than on a schedule of their own.
  if (Math.random() < 0.005) await pruneUsage(db).catch(() => {});
  return new NextResponse(null, { status: 204 });
}
