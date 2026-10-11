import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink, Fact } from "@/components/site/Fact";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement between you and Fundur for using the Fundur service during its beta.",
};

export default function TermsPage() {
  return (
    <LegalDoc
      path="/legal/terms"
      title="Terms of service"
      intro={
        <>
          These terms are the agreement between you and <Fact k="legalName" /> (&quot;Fundur&quot;, &quot;we&quot;,
          &quot;us&quot;) for using Fundur. Please read them, together with our{" "}
          <Link href="/legal/privacy">privacy policy</Link> and <Link href="/legal/acceptable-use">acceptable use
          policy</Link>. Sections in bold may limit our responsibility or place obligations on you, as the Consumer
          Protection Act asks us to point out.
        </>
      }
    >
      <h2>1. Agreeing to these terms</h2>
      <p>
        By creating an account or using Fundur you agree to these terms. If you use Fundur for a business, you confirm
        that you may bind that business, and &quot;you&quot; includes it. You must be at least 18 years old and able to
        enter into a binding agreement.
      </p>

      <h2>2. Who we are</h2>
      <p>
        Fundur is operated by <Fact k="legalName" />, registration number <Fact k="registrationNumber" />, of{" "}
        <Fact k="physicalAddress" />. You can reach us at <EmailLink />. Our full details, as required by section 43 of
        the Electronic Communications and Transactions Act 25 of 2002 (ECTA), are on our{" "}
        <Link href="/legal/company">company information</Link> page.
      </p>

      <h2>3. The beta</h2>
      <p>
        Fundur is in beta. That means it is still being built: features may change, be added or be removed, and parts
        of it may not work as intended.{" "}
        <strong>
          During the beta we provide Fundur as it is and as available, without any promise of uptime, support response
          times or that it will be free of errors.
        </strong>{" "}
        Please keep your own copies of anything important. We back up the service every night, but backups are a
        safeguard for us, not a guarantee to you.
      </p>

      <h2>4. Price</h2>
      <p>
        Fundur is free during the beta, and we do not take payment details. Before we introduce paid plans we will
        publish the prices and tell you in advance. You will only pay if you choose a paid plan and accept its terms at
        that time. Payments for paid plans will be processed by Whop, our payment provider, under its own terms; we
        will not see or store your full card details. Paid plans will show the full price including any VAT, and any rights you have under ECTA (including
        the cooling-off period in section 44, where it applies) and the Consumer Protection Act 68 of 2008 (CPA) will
        apply to them.
      </p>

      <h2>5. Your account</h2>
      <ul>
        <li>You sign in through our sign-in provider, Auth0. Keep your sign-in details safe and do not share them.</li>
        <li>You are responsible for what happens under your account, unless it happens because of our fault.</li>
        <li>Tell us straight away if you think someone else has used your account.</li>
        <li>The information you give us about yourself must be accurate.</li>
      </ul>

      <h2>6. Your content</h2>
      <p>
        Your projects, briefs, plans, files, notes and other material you put into Fundur (&quot;your content&quot;)
        remain yours. You give us permission to store, copy, process and display your content only as needed to run
        Fundur for you, keep it safe, back it up and fix problems. When you use an AI feature, this includes sending the
        relevant part of your content to the AI provider handling that task, as described in{" "}
        <Link href="/legal/ai">how we use AI</Link>.
      </p>
      <p>
        <strong>
          You are responsible for having the right to put your content into Fundur, including any personal information
          about your clients, their staff or other people.
        </strong>{" "}
        For that information you are the responsible party under the Protection of Personal Information Act 4 of 2013
        (POPIA), and we process it on your behalf as your operator. Our <Link href="/legal/privacy">privacy policy</Link>{" "}
        explains how.
      </p>

      <h2>7. AI features</h2>
      <p>
        AI can be wrong. Drafts, suggestions, layouts, scores and answers from Fundur&apos;s AI features are a starting
        point for your own judgement, not professional, legal, financial, engineering or building-regulation advice.{" "}
        <strong>
          You are responsible for checking AI output before you rely on it or share it, and for the decisions you make.
        </strong>{" "}
        Fundur shows AI changes for you to accept and asks before its assistant changes your project.
      </p>

      <h2>8. Using Fundur properly</h2>
      <p>
        You agree to follow our <Link href="/legal/acceptable-use">acceptable use policy</Link>. In short: use Fundur
        lawfully, don&apos;t try to break or misuse it, and don&apos;t upload anything you have no right to share.
      </p>

      <h2>9. Our intellectual property</h2>
      <p>
        Fundur&apos;s software, design, workflows, names and logos belong to us or our licensors. We give you a personal,
        non-exclusive, non-transferable right to use Fundur under these terms. You may not copy, resell or reverse
        engineer it, except where the law allows. If you send us feedback or ideas, we may use them without owing you
        anything.
      </p>

      <h2>10. Services we rely on</h2>
      <p>
        Fundur runs on third-party services, including hosting and file storage (Vercel), a database (Neon), sign-in
        (Auth0), AI providers and, once paid plans launch, payments (Whop). Their availability can affect Fundur. We choose them carefully but are not responsible
        for their failures that are outside our reasonable control.
      </p>

      <h2>11. Responsibility and liability</h2>
      <p>
        <strong>
          To the extent the law allows, we are not liable for indirect or consequential loss, such as lost profit, lost
          business or lost data, arising from your use of Fundur during the beta, and our total liability to you for
          any claim is limited to the amount you paid us for Fundur in the 12 months before the claim.
        </strong>{" "}
        Nothing in these terms limits liability that cannot lawfully be limited, including liability for our gross
        negligence or wilful misconduct, and nothing takes away rights you have under the CPA or ECTA that cannot be
        waived.
      </p>
      <p>
        <strong>
          You agree to compensate us for losses caused by your breach of these terms or by content you put into Fundur
          that you had no right to share,
        </strong>{" "}
        except to the extent we caused the loss.
      </p>

      <h2>12. Ending the agreement</h2>
      <p>
        You can stop using Fundur at any time and ask us to close your account and delete your information by emailing{" "}
        <EmailLink />. We may suspend or close an account that breaks these terms or the law, or that puts Fundur or
        other users at risk; where reasonable, we will warn you first and give you a chance to fix the problem. If we
        stop offering Fundur, we will give you reasonable notice and a chance to ask for a copy of your content.
      </p>

      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms as Fundur grows, for example when paid plans launch. We will post the new version
        here with a new date and tell you about important changes before they take effect. If you keep using Fundur
        after that, the new terms apply; if you don&apos;t agree, you can stop using it.
      </p>

      <h2>14. Law and disputes</h2>
      <p>
        These terms are governed by the law of the Republic of South Africa. If something goes wrong, please contact us
        first so we can try to fix it. If we cannot resolve it, you may refer a consumer complaint to the Consumer Goods
        and Services Ombud or the National Consumer Commission where the CPA applies, complain about personal
        information to the Information Regulator, or approach a South African court with jurisdiction. If you live in
        another country, you keep any consumer protection that its law gives you and cannot be taken away by contract.
      </p>

      <h2>15. General</h2>
      <p>
        If any part of these terms cannot be enforced, the rest still applies. If we don&apos;t enforce a right straight
        away, we have not given it up. You may not transfer this agreement without our written consent; we may transfer
        it to a business that takes over Fundur, and will tell you if we do. Notices to us must go to <EmailLink />; we
        choose the physical address on our <Link href="/legal/company">company information</Link> page as our address
        for legal documents.
      </p>
    </LegalDoc>
  );
}
