import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth/auth0";
import { isPublicTokenRoute } from "@/lib/auth/public-routes";
import { isPublicPage } from "@/lib/site/public-pages";

/**
 * Sign-in boundary. Every page and API route requires a session once Auth0 is
 * configured: signed-out visitors are sent to sign in, and API calls get a 401
 * instead of data. The public site is the exception, and signed-out visitors
 * to the home page see the storefront there instead of the sign-in screen.
 * Without Auth0 settings the app runs as an open demo, which
 * is only safe while it holds demo data.
 */
export async function proxy(request: NextRequest) {
  if (!auth0) return NextResponse.next();

  // The SDK's own routes (/auth/login, /auth/callback, ...) and its rolling session cookie.
  const authResponse = await auth0.middleware(request);
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/auth/")) return authResponse;
  // Public readers receive only the resource granted by their bearer token.
  // Authentication still applies to every internal API and studio page.
  if (isPublicTokenRoute(pathname)) return authResponse;
  // Scheduled jobs come from Vercel with no session; each checks CRON_SECRET or the Admin itself.
  if (pathname.startsWith("/api/cron/")) return authResponse;
  // An invite link sends a signed-out visitor to sign up rather than sign in.
  if (pathname.startsWith("/join/")) return authResponse;

  if (isPublicPage(pathname)) return authResponse;

  const session = await auth0.getSession(request);
  if (!session) {
    if (pathname === "/") {
      const storefront = NextResponse.redirect(new URL("/welcome", request.url));
      for (const cookie of authResponse.cookies.getAll()) storefront.cookies.set(cookie);
      return storefront;
    }
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|site/).*)"],
};
