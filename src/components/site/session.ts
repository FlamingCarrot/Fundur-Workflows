import { auth0 } from "@/lib/auth/auth0";

export interface SiteSession {
  /** Sign-in is set up on this deployment. Without it the app runs as an open demo. */
  authEnabled: boolean;
  signedIn: boolean;
}

export async function getSiteSession(): Promise<SiteSession> {
  if (!auth0) return { authEnabled: false, signedIn: false };
  const session = await auth0.getSession();
  return { authEnabled: true, signedIn: Boolean(session) };
}

/** Where the site's calls to action go: Auth0's sign-up and sign-in screens, or straight into the demo. */
export function ctaLinks({ authEnabled }: SiteSession) {
  return {
    signUp: authEnabled ? "/auth/login?screen_hint=signup&returnTo=%2F" : "/",
    signIn: authEnabled ? "/auth/login?returnTo=%2F" : "/",
  };
}
