import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth/auth0";
import { getDb } from "@/lib/db";
import { openClientInvite } from "@/lib/team/store";
import { clientPage } from "@/lib/team/client-view";
import { ClientProgress } from "@/components/team/ClientProgress";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Project progress" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The client's progress page. It is invite only: it opens for someone signed
 * in with the invited, verified email address. Everyone else, and any link
 * that was revoked, goes to the storefront with a note saying so.
 */
export default async function ClientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  if (!db || !auth0) redirect("/welcome?notice=invite-only");
  const session = await auth0.getSession();
  if (!session) redirect(`/auth/login?returnTo=${encodeURIComponent(`/client/${token}`)}`);
  const opened = await openClientInvite(db, token, {
    email: session.user.email,
    emailVerified: session.user.email_verified,
  });
  if (!opened.ok) redirect("/welcome?notice=invite-only");
  const page = clientPage(opened.project, opened.settings, opened.studio);
  return (
    <main className="client-page">
      <ClientProgress
        page={page}
        logoUrl={opened.brand?.logoUrl}
        fileHref={(id) => `/api/client/${token}/file?documentId=${id}`}
      />
    </main>
  );
}
