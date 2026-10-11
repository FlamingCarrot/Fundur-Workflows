import { getDb } from "@/lib/db";
import { commentShared } from "@/lib/sharing/store";
import { commentInput } from "@/lib/sharing/schema";
import { shareJson, shareFailure, checkOrigin } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const denied = checkOrigin(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return shareJson({ error: "This link is unavailable" }, 404);
  const input = commentInput.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return shareJson({ error: input.error.issues[0].message }, 400);
  try {
    return shareJson(
      { comment: await commentShared(db, (await params).token, input.data) },
      201,
    );
  } catch (e) {
    return shareFailure(e);
  }
}
