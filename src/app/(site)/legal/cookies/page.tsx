import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink } from "@/components/site/Fact";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: "The cookies and browser storage Fundur uses. No advertising or third-party tracking cookies.",
};

export default function CookiesPage() {
  return (
    <LegalDoc
      path="/legal/cookies"
      title="Cookie policy"
      intro="Fundur uses a few cookies and some browser storage to keep you signed in, keep your work safe and understand how the app is used. We do not use advertising cookies or any third-party analytics or tracking."
    >
      <h2>Cookies</h2>
      <div className="prose-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Set by</th>
              <th>Purpose</th>
              <th>Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>__session</td>
              <td>Fundur (Auth0 sign-in library)</td>
              <td>Keeps you signed in, encrypted so it cannot be read by others</td>
              <td>Until you sign out or the session expires</td>
            </tr>
            <tr>
              <td>__txn_*</td>
              <td>Fundur (Auth0 sign-in library)</td>
              <td>Protects the sign-in step against forgery while you sign in</td>
              <td>Minutes, removed once sign-in completes</td>
            </tr>
            <tr>
              <td>Auth0 cookies</td>
              <td>Auth0, on its own sign-in pages</td>
              <td>Run and secure the sign-in page itself</td>
              <td>Set by Auth0</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Browser storage</h2>
      <p>
        Fundur also keeps some things in your browser&apos;s local storage so the app works smoothly. This never leaves
        your device unless the app sends it to your account:
      </p>
      <ul>
        <li>unsaved floor plan drafts, so a lost connection doesn&apos;t lose your work;</li>
        <li>view settings you choose, so the app opens the way you left it;</li>
        <li>in the demo version only, the sample projects you try out.</li>
      </ul>
      <p>
        While you are signed in, Fundur&apos;s own usage tracker also keeps a random visit identifier in your
        browser&apos;s session storage (fundur.usage.session). It groups the pages and clicks of one visit together and
        is cleared when you close the tab. What it records is described in our{" "}
        <Link href="/legal/privacy">privacy policy</Link>; it goes only to our own database, never to a third party.
      </p>

      <h2>Your choices</h2>
      <p>
        The sign-in cookies are strictly necessary. You can still block or delete cookies and browser storage in your
        browser settings, and you can object to usage tracking by emailing us. If you block the sign-in cookies you will not be able to sign in.
        Clearing local storage removes unsaved drafts and saved view settings.
      </p>
      <p>
        If we ever add third-party or advertising cookies, we will update this page and ask for your consent first.
        Questions? Email <EmailLink />. See also our <Link href="/legal/privacy">privacy policy</Link>.
      </p>
    </LegalDoc>
  );
}
