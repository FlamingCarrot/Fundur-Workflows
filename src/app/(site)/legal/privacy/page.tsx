import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink, Fact } from "@/components/site/Fact";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How Fundur collects, uses, shares and protects personal information, and your rights under POPIA and other privacy laws.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      path="/legal/privacy"
      title="Privacy policy"
      intro={
        <>
          This policy explains what personal information Fundur collects, why, who we share it with, how we protect it
          and what rights you have. We follow South Africa&apos;s Protection of Personal Information Act 4 of 2013
          (POPIA), and we apply the same care for people elsewhere, including the rights in the EU and UK General Data
          Protection Regulation (GDPR) where it applies.
        </>
      }
    >
      <h2>1. Who is responsible</h2>
      <p>
        The responsible party (controller) for information about our users is <Fact k="legalName" />, trading as
        Fundur, of <Fact k="physicalAddress" />. Our Information Officer is <Fact k="informationOfficer" />, reachable at{" "}
        <EmailLink k="informationOfficerEmail" />. Contact them about anything in this policy.
      </p>

      <h2>2. Information we collect</h2>
      <div className="prose-table">
        <table>
          <thead>
            <tr>
              <th>What</th>
              <th>Examples</th>
              <th>Where it comes from</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account details</td>
              <td>Name, email address, profile picture, sign-in identifier, workspace name</td>
              <td>You, through our sign-in provider Auth0 (and a social sign-in service such as Google, if offered and you choose to use it)</td>
            </tr>
            <tr>
              <td>Your content</td>
              <td>
                Projects, briefs, client names and details, tasks, notes, floor plans, uploaded files and photos,
                messages to the assistant
              </td>
              <td>You</td>
            </tr>
            <tr>
              <td>AI usage</td>
              <td>Which AI feature you used, the model, its token count and cost</td>
              <td>Created when you use AI features</td>
            </tr>
            <tr>
              <td>Issue reports</td>
              <td>Your note, the screen and part of the app it is about</td>
              <td>You, when you report an issue</td>
            </tr>
            <tr>
              <td>Usage data</td>
              <td>
                Pages you open, time and scrolling on each, where you click (the label of what you clicked and its
                position), features you use, errors, device type and screen size, linked to your account. A click label
                can include a project or client name shown on screen. What you type is never recorded.
              </td>
              <td>Recorded by Fundur&apos;s own usage tracker while you are signed in</td>
            </tr>
            <tr>
              <td>Client link activity</td>
              <td>
                The name a client gives when commenting on or approving a shared page, their comments and decisions, and
                how often and when the link was last opened
              </td>
              <td>People you share a link with</td>
            </tr>
            <tr>
              <td>Client progress page invitations</td>
              <td>
                The client&apos;s email address you invite, and how often and when they last opened the page. Only someone
                signed in with that verified address can open it.
              </td>
              <td>You, when you invite a client</td>
            </tr>
            <tr>
              <td>Team space</td>
              <td>Comments, whiteboard notes and chat messages written on a project, with the name of who wrote them</td>
              <td>You and your teammates</td>
            </tr>
            <tr>
              <td>Teammate invitations</td>
              <td>The email address and role you invite someone with</td>
              <td>You, when you invite a teammate</td>
            </tr>
            <tr>
              <td>Technical data</td>
              <td>IP address, browser and device type, request logs, sign-in session cookies</td>
              <td>Your browser, recorded by us and our hosting and sign-in providers</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We do not use advertising trackers or any third-party analytics tool, and we never sell information. Usage data
        stays in our own database and only the platform Admin can see it. We do not ask for special personal information (such as
        health, religion or biometrics) and ask you not to put it into Fundur unless your work truly needs it.
      </p>

      <h2>3. Why we use it, and on what basis</h2>
      <ul>
        <li>
          <strong>To provide Fundur</strong>: to create your account, keep your work, run the features you use and keep
          you signed in. This is needed to perform our agreement with you (POPIA section 11(1)(b); GDPR article
          6(1)(b)).
        </li>
        <li>
          <strong>To run AI features you ask for</strong>: to send the relevant part of a project to the AI provider
          handling the task, and to log the cost. Also part of performing our agreement.
        </li>
        <li>
          <strong>To keep Fundur safe and working</strong>: backups, security, preventing misuse and fixing issues you
          report. This is in our legitimate interest and yours (POPIA section 11(1)(f); GDPR article 6(1)(f)).
        </li>
        <li>
          <strong>To improve Fundur</strong>: we record in-app activity (the usage data above) to see which parts of the
          app work well and which confuse people, and to decide what to build or fix next. When the Admin asks
          Fundur&apos;s improvement advisor for advice, an AI provider reads summary usage numbers, the text of issue
          reports and the Admin&apos;s own notes; it does not receive your projects. This is in our legitimate interest.
          There is no switch to turn usage recording off yet; you can object to it, or ask for your usage data or its
          deletion, by emailing us.
        </li>
        <li>
          <strong>To tell you about the service</strong>: important notices such as changes to these policies or to
          pricing. We will only send marketing with your consent or, for our own similar services, where POPIA section
          69 allows it, and every message will let you opt out.
        </li>
        <li>
          <strong>To meet legal obligations</strong>, such as keeping records the law requires or responding to lawful
          requests.
        </li>
      </ul>

      <h2>4. Information about your clients and other people</h2>
      <p>
        When you put information about your clients, their staff or anyone else into Fundur, you decide why and how it
        is used, so you are the responsible party for it and we are your operator (under GDPR, you are the controller
        and we are your processor). We process it only to provide Fundur to you, keep it confidential, protect it with
        the safeguards in section 8, and will tell you without undue delay if we believe it has been accessed without
        authorisation. You are responsible for having a lawful basis to share it with us and for telling those people
        how their information is used.
      </p>

      <h2>5. Who we share it with</h2>
      <p>We share personal information only with service providers who help us run Fundur, and only what they need:</p>
      <div className="prose-table">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>What they do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel</td>
              <td>Hosts the app and stores uploaded files and backups (Vercel Blob)</td>
            </tr>
            <tr>
              <td>Neon</td>
              <td>Hosts the database that holds your projects</td>
            </tr>
            <tr>
              <td>Auth0 (Okta)</td>
              <td>Handles sign-in and account security</td>
            </tr>
            <tr>
              <td>AI providers: Anthropic, OpenAI, Google (Gemini), xAI (Grok) and OpenRouter</td>
              <td>
                Process the part of a project an AI feature needs, only when that feature is used, including images for
                concept visuals. OpenRouter passes requests to the model provider chosen for the task. The improvement
                advisor sends only summary usage numbers, issue report text and Admin notes.
              </td>
            </tr>
            <tr>
              <td>Whop</td>
              <td>
                Will process payments for paid plans once they launch. No payment details are collected during the free
                beta, and we will not store full card details.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        When you share a client link, the people who open it see what you chose to share. When you invite a teammate,
        they see the projects you give them access to.
      </p>
      <p>
        We may also disclose information if the law requires it, to protect rights or safety, or to a business that
        takes over Fundur, which would have to honour this policy.
      </p>

      <h2>6. Information sent outside South Africa</h2>
      <p>
        Our service providers run their systems in other countries, so your information will be processed outside South
        Africa. Under POPIA section 72 we only do this where the recipient is bound by law, binding rules or an agreement
        that gives protection substantially similar to POPIA, or where the transfer is needed to perform our agreement
        with you. For people in the EU or UK, transfers rely on adequacy decisions or standard contractual clauses
        offered by these providers.
      </p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li>Account details and your content: for as long as your account is open.</li>
        <li>After you ask us to close your account: we delete your information from the live service, and it leaves our
          nightly backups when they expire, which is after 30 days.</li>
        <li>AI usage and cost records: for as long as your account is open, as part of your project history.</li>
        <li>Usage data: 13 months, then deleted automatically.</li>
        <li>Client link comments and decisions: with the project, until you delete it or close your account.</li>
        <li>Team comments, whiteboard notes and chat messages: with the project, until they or the project are deleted
          or you close your account.</li>
        <li>Anything the law requires us to keep longer: only for as long as that law requires.</li>
      </ul>

      <h2>8. How we protect it</h2>
      <ul>
        <li>Fundur is only reachable over encrypted connections (HTTPS), and everything in your workspace needs a signed-in session.</li>
        <li>Each workspace&apos;s projects are kept separate and are only returned to people signed in to it.</li>
        <li>Uploaded files are stored privately, not on public links.</li>
        <li>AI provider keys are encrypted before they are stored.</li>
        <li>The service is backed up every night, and each backup is checked.</li>
      </ul>
      <p>
        No system is perfectly secure. If a breach affects your personal information, we will tell you and the
        Information Regulator as POPIA section 22 requires.
      </p>

      <h2>9. Your rights</h2>
      <p>You may, free of charge unless the law allows a fee:</p>
      <ul>
        <li>ask whether we hold information about you and for a copy of it (POPIA section 23; GDPR article 15);</li>
        <li>ask us to correct, update or delete it (section 24; articles 16 and 17);</li>
        <li>object to processing based on legitimate interests, and to direct marketing at any time (section 11(3));</li>
        <li>withdraw any consent you gave, without affecting what was done before;</li>
        <li>under GDPR, also ask to restrict processing or receive your information in a portable format;</li>
        <li>
          complain to the Information Regulator of South Africa (
          <a href="https://inforegulator.org.za" rel="noopener noreferrer" target="_blank">
            inforegulator.org.za
          </a>
          ), or to the data protection authority where you live.
        </li>
      </ul>
      <p>
        To use these rights, email <EmailLink k="informationOfficerEmail" />. We may need to confirm who you are first,
        and we will reply within a reasonable time and at most within the period the law sets. Formal requests for
        records can also be made under our <Link href="/legal/paia">PAIA manual</Link>.
      </p>

      <h2>10. Automated decisions</h2>
      <p>
        We do not make decisions about you that have legal or similarly significant effects based only on automated
        processing. AI in Fundur drafts and suggests; you decide.
      </p>

      <h2>11. Cookies</h2>
      <p>
        We use cookies and browser storage to keep you signed in, keep drafts safe and group usage data by visit, and no
        advertising or third-party tracking cookies. See our{" "}
        <Link href="/legal/cookies">cookie policy</Link>.
      </p>

      <h2>12. Children</h2>
      <p>Fundur is for adults using it for work. We do not knowingly collect information from anyone under 18.</p>

      <h2>13. Changes</h2>
      <p>
        We will post any changes here with a new date and tell you about important ones before they take effect.
      </p>
    </LegalDoc>
  );
}
