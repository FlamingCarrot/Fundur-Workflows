import { Auth0Client } from "@auth0/nextjs-auth0/server";

export function isAuth0Configured(): boolean {
  const secret = process.env.AUTH0_SECRET;
  const domain = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const clientSecret = process.env.AUTH0_CLIENT_SECRET;

  return Boolean(
    secret &&
    domain &&
    clientId &&
    clientSecret &&
    domain !== "https://dev-example.us.auth0.com" &&
    clientId !== "dev-client-id"
  );
}

function createClient(): Auth0Client | null {
  if (!isAuth0Configured()) return null;

  const rawDomain = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL || "";
  const domain = rawDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return new Auth0Client({
    domain,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    secret: process.env.AUTH0_SECRET,
    // Left unset on preview deployments so the SDK uses the request's own host;
    // Auth0's Allowed Callback URLs are the safety net for that.
    appBaseUrl: process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || undefined,
  });
}

/**
 * The Auth0 client, or null while Auth0 is not configured. The SDK mounts its
 * routes at /auth/login, /auth/logout, /auth/callback and /auth/profile through
 * the proxy (src/proxy.ts).
 */
export const auth0 = createClient();
