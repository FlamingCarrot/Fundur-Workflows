import { getDb } from "@/lib/db";
import { readShared, editSharedBrief } from "@/lib/sharing/store";
import { editBriefInput } from "@/lib/sharing/schema";
import { shareJson, shareFailure, checkOrigin } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
export async function GET(_req: Request, { params }: Context) {
  const db = getDb();
  if (!db) return shareJson({ error: "This link is unavailable" }, 404);
  try {
    return shareJson(await readShared(db, (await params).token));
  } catch (e) {
    return shareFailure(e);
  }
}
export async function PATCH(req: Request, { params }: Context) {
  const denied = checkOrigin(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return shareJson({ error: "This link is unavailable" }, 404);
  const input = editBriefInput.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return shareJson({ error: input.error.issues[0].message }, 400);
  try {
    return shareJson(
      await editSharedBrief(db, (await params).token, input.data.patch),
    );
  } catch (e) {
    return shareFailure(e);
  }
}
