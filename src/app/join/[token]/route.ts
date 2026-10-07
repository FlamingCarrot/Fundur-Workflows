import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { acceptInviteLink } from "@/lib/auth/users";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The link in an invite. Signed out, it opens Auth0's sign-up screen and comes
 * back here; signed in, it uses the invite and opens the app.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const home = new URL("/", req.url);
  const db = getDb();
  if (!auth0 || !db) return NextResponse.redirect(home);

  const session = await auth0.getSession();
  if (!session) {
    const signup = new URL("/auth/login", req.url);
    signup.searchParams.set("screen_hint", "signup");
    signup.searchParams.set("returnTo", `/join/${encodeURIComponent(token)}`);
    const [invite] = await db.query<{ email: string }>(
      "SELECT email FROM invites WHERE token = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()",
      [token]
    );
    if (invite) signup.searchParams.set("login_hint", invite.email);
    return NextResponse.redirect(signup);
  }

  const result = await acceptInviteLink(db, session.user, token);
  if (result !== "accepted") home.searchParams.set("invite", result);
  return NextResponse.redirect(home);
}
