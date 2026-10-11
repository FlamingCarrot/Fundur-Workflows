import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/workspace-context";
import { updateMember, AccessError } from "@/lib/workspaces/store";
export const dynamic = "force-dynamic";
const input = z
  .object({
    role: z.enum(["owner", "member", "collaborator"]).optional(),
    projectIds: z.array(z.uuid()).max(100).optional(),
    active: z.boolean().optional(),
    platformRole: z.enum(["admin", "user"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Choose a change");
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  try {
    await updateMember(
      ctx.db,
      ctx.workspaceId,
      ctx.user.id,
      (await params).userId,
      parsed.data,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccessError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
