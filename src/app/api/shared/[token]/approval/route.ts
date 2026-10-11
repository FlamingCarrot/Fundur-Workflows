import { getDb } from "@/lib/db";
import { approveShared } from "@/lib/sharing/store";
import { approvalInput } from "@/lib/sharing/schema";
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
  const raw = await req.text();
  if (raw.length > 16000)
    return shareJson({ error: "Keep your note under 3,000 characters." }, 400);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return shareJson({ error: "The decision could not be read." }, 400);
  }
  const input = approvalInput.safeParse(value);
  if (!input.success)
    return shareJson({ error: input.error.issues[0].message }, 400);
  try {
    return shareJson(
      { approval: await approveShared(db, (await params).token, input.data) },
      201,
    );
  } catch (e) {
    return shareFailure(e);
  }
}
