import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";

/**
 * Sign-in boundary. Every page and API route requires a session once Auth0 is
 * configured: signed-out visitors are sent to sign in, and API calls get a 401
 * instead of data. Without Auth0 settings the app runs as an open demo, which
 * is only safe while it holds demo data.
 */
export async function proxy(request: NextRequest) {
  if (!auth0) return NextResponse.next();

  // The SDK's own routes (/auth/login, /auth/callback, ...) and its rolling session cookie.
  const authResponse = await auth0.middleware(request);
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/auth/")) return authResponse;

  const session = await auth0.getSession(request);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("returnTo", pathname + search);
    return NextResponse.redirect(login);
  }

  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
