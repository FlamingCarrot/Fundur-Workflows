import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink } from "@/components/site/Fact";

export const metadata: Metadata = {
  title: "Acceptable use policy",
  description: "What you may and may not do with Fundur.",
};

export default function AcceptableUsePage() {
  return (
    <LegalDoc
      path="/legal/acceptable-use"
      title="Acceptable use policy"
      intro={
        <>
          This policy is part of our <Link href="/legal/terms">terms of service</Link>. It keeps Fundur safe and fair
          for everyone using it.
        </>
      }
    >
      <h2>Please don&apos;t use Fundur to</h2>
      <ul>
        <li>break any law, including privacy, consumer, intellectual property and anti-spam laws;</li>
        <li>upload content you have no right to share, or personal information you have no lawful basis to process;</li>
        <li>upload malware, or anything designed to harm devices, data or people;</li>
        <li>harass, threaten, defame or discriminate against anyone;</li>
        <li>store or share child sexual abuse material, or content that promotes violence or terrorism;</li>
        <li>impersonate anyone or misrepresent where content came from.</li>
      </ul>

      <h2>Please don&apos;t try to</h2>
      <ul>
        <li>get into accounts, workspaces or data that are not yours;</li>
        <li>probe, scan or test Fundur&apos;s security without our written permission;</li>
        <li>overload, disrupt or work around limits in the service, including AI budgets and limits;</li>
        <li>scrape Fundur, or copy, resell or reverse engineer it except where the law allows;</li>
        <li>use Fundur&apos;s AI features to produce unlawful content or to get around an AI provider&apos;s own usage rules.</li>
      </ul>

      <h2>If something goes wrong</h2>
      <p>
        If you find a security problem, please tell us at <EmailLink /> and give us a chance to fix it before telling
        anyone else. If someone breaks this policy, we may remove the content, limit features or suspend the account, as
        our terms describe. We will normally explain why and, where we can, give you a chance to put it right first.
      </p>
    </LegalDoc>
  );
}
