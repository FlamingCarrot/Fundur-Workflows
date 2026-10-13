import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth/auth0";
import { getDb } from "@/lib/db";
import { openClientInvite } from "@/lib/team/store";
import { ClientMeeting } from "@/components/comms/ClientComms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Meeting" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** A meeting the studio invited the client to, on the same invite-only terms as their project page. */
export default async function ClientMeetingPage({ params }: { params: Promise<{ token: string; meetingId: string }> }) {
  const { token, meetingId } = await params;
  const db = getDb();
  if (!db || !auth0) redirect("/welcome?notice=invite-only");
  const session = await auth0.getSession();
  if (!session) redirect(`/auth/login?returnTo=${encodeURIComponent(`/client/${token}/meetings/${meetingId}`)}`);
  const opened = await openClientInvite(db, token, { email: session.user.email, emailVerified: session.user.email_verified }, false);
  if (!opened.ok) redirect("/welcome?notice=invite-only");
  return (
    <main className="client-page">
      <div className="client-progress">
        <ClientMeeting token={token} meetingId={meetingId} />
      </div>
    </main>
  );
}
