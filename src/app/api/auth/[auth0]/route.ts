import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth/auth0";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ auth0: string }> }
) {
  const { auth0: action } = await params;

  if (isAuth0Configured()) {
    const client = getAuth0Client();
    if (client) {
      try {
        return await client.middleware(req);
      } catch (err) {
        console.error("[Auth0] Client middleware error:", err);
      }
    }
  }

  // Development Fallback: Allows testing and UI development without requiring Auth0 credentials upfront
  const url = new URL(req.url);

  if (action === "login") {
    const returnTo = url.searchParams.get("returnTo") || "/";
    const res = NextResponse.redirect(new URL(returnTo, req.url));
    res.cookies.set(
      "fundur_session",
      JSON.stringify({
        user: {
          sub: "auth0|mock-andre-swanepoel",
          email: "andre@fundur.io",
          name: "Andre Swanepoel",
          role: "owner",
          workspace: "Andre Swanepoel Interiors",
        },
      }),
      { path: "/", httpOnly: false }
    );
    return res;
  }

  if (action === "logout") {
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.delete("fundur_session");
    return res;
  }

  if (action === "me") {
    const cookie = req.cookies.get("fundur_session");
    if (cookie?.value) {
      try {
        const parsed = JSON.parse(cookie.value);
        return NextResponse.json(parsed.user);
      } catch {
        // invalid JSON
      }
    }
    return NextResponse.json({
      sub: "auth0|mock-andre-swanepoel",
      email: "andre@fundur.io",
      name: "Andre Swanepoel",
      role: "owner",
      mode: "dev_mock_mode",
    });
  }

  return NextResponse.json({
    status: "Development Mode Active",
    message: "Auth0 environment variables are pending. Fill in AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_CLIENT_SECRET in .env.local to activate live Auth0 authentication.",
    action,
  });
}
