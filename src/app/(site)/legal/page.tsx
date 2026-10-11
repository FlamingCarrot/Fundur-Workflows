import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_UPDATED } from "@/lib/site/company";

export const metadata: Metadata = {
  title: "Legal",
  description: "Fundur's terms, privacy policy and other legal information.",
};

const PAGES: [string, string, string][] = [
  ["/legal/terms", "Terms of service", "The agreement for using Fundur during the beta."],
  ["/legal/privacy", "Privacy policy", "What we collect, why, who processes it and your rights under POPIA and GDPR."],
  ["/legal/cookies", "Cookie policy", "The few cookies Fundur needs, and nothing that tracks you."],
  ["/legal/acceptable-use", "Acceptable use", "What you may and may not do with Fundur."],
  ["/legal/ai", "How we use AI", "What the AI does, what it sees and how you stay in control."],
  ["/legal/paia", "PAIA manual", "Our manual under the Promotion of Access to Information Act."],
  ["/legal/company", "Company information", "Who runs Fundur, as the ECTA requires."],
];

export default function LegalIndexPage() {
  return (
    <section className="site-section">
      <div className="site-page-head" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow">Last updated {LEGAL_UPDATED}</p>
        <h1 className="display-xl">
          Legal, <em>in plain words.</em>
        </h1>
        <p className="lede">
          Fundur is based in South Africa and follows its law, including POPIA, the ECTA and the Consumer Protection Act,
          while respecting the privacy rights of people elsewhere.
        </p>
      </div>
      <div className="legal-index">
        {PAGES.map(([href, title, text]) => (
          <Link key={href} href={href}>
            <strong>{title}</strong>
            <span>{text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
