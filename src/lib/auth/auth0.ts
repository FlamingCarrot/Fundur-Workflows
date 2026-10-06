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

export function getAuth0Client(): Auth0Client | null {
  if (!isAuth0Configured()) {
    return null;
  }

  const rawDomain = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL || "";
  const domain = rawDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return new Auth0Client({
    domain,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    secret: process.env.AUTH0_SECRET,
    appBaseUrl: process.env.AUTH0_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  });
}
