import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { auth0 } from "@/lib/auth/auth0";
import { invitationInfo } from "@/lib/workspaces/store";
import { AcceptInvitation } from "@/components/sharing/AcceptInvitation";
export const metadata: Metadata = {
  title: "Workspace invitation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = getDb();
  const invitation = db ? await invitationInfo(db, token) : null;
  const session = await auth0?.getSession();
  return (
    <main className="page" style={{ maxWidth: 680, margin: "8vh auto" }}>
      <section className="card" style={{ padding: "2.5rem" }}>
        <h1 className="display-m">
          {invitation ? `Join ${invitation.name}` : "Invitation unavailable"}
        </h1>
        <p className="muted" style={{ margin: "1.25rem 0" }}>
          {invitation
            ? "Sign in with the verified email address this invitation was sent to. The invitation expires after seven days."
            : "This invitation has expired, been revoked or already been accepted."}
        </p>
        {invitation &&
          (session ? (
            <AcceptInvitation token={token} />
          ) : (
            <a
              className="btn btn-primary"
              href={`/auth/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`}
            >
              Sign in to join
            </a>
          ))}
      </section>
    </main>
  );
}
