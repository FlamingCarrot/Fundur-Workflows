import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth0 } from "@/lib/auth/auth0";
import { getDb } from "@/lib/db";
import { syncUser } from "@/lib/auth/users";
import { acceptInvitation, AccessError } from "@/lib/workspaces/store";
import { WORKSPACE_COOKIE } from "@/lib/server/workspace-context";
export const dynamic = "force-dynamic";
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const db = getDb();
  const session = await auth0?.getSession();
  if (!db || !session)
    return NextResponse.json(
      { error: "Sign in to accept your invitation" },
      { status: 401 },
    );
  const user = await syncUser(db, session.user);
  if (user.active === false)
    return NextResponse.json(
      { error: "Your account is inactive" },
      { status: 403 },
    );
  try {
    const workspaceId = await acceptInvitation(
      db,
      (await params).token,
      session.user,
    );
    (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccessError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
