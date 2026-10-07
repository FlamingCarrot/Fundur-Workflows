import { Clock, Lock } from "lucide-react";

/**
 * What someone sees when they are signed in but can't use the app: switched
 * off by the Admin, or waiting to be let in while sign-ups are invite only.
 */
export function AccessScreen({ access, email }: { access: "disabled" | "waiting"; email: string | null }) {
  const waiting = access === "waiting";
  return (
    <main className="page page-narrow" style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <div className="card rise" style={{ padding: "2.25rem 2rem", maxWidth: 480, textAlign: "center" }}>
        <span className="dropzone-icon" style={{ margin: "0 auto 1.25rem" }}>
          {waiting ? <Clock size={22} /> : <Lock size={22} />}
        </span>
        <h1 className="display-s" style={{ marginBottom: "0.6rem" }}>
          {waiting ? "You're on the list" : "This account is switched off"}
        </h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          {waiting
            ? "Fundur is invite only for now. The Admin can see you signed up and can let you in. If someone sent you an invite link, open it again while signed in."
            : "The Admin has switched this account off. If you think that's a mistake, get in touch with them."}
          {email && (
            <>
              <br />
              <span className="small">Signed in as {email}</span>
            </>
          )}
        </p>
        {/* A plain link: the SDK's logout route is a full-page redirect. */}
        <a href="/auth/logout" className="btn btn-secondary">Sign out</a>
      </div>
    </main>
  );
}
