import Link from "next/link";
import { COMPANY } from "@/lib/site/company";
import { EmailLink, Fact } from "./Fact";

export const LEGAL_PAGES = [
  { href: "/legal/terms", label: "Terms of service" },
  { href: "/legal/privacy", label: "Privacy policy" },
  { href: "/legal/cookies", label: "Cookie policy" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
  { href: "/legal/ai", label: "How we use AI" },
  { href: "/legal/paia", label: "PAIA manual" },
  { href: "/legal/company", label: "Company information" },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Link href="/welcome" className="brand" aria-label="Fundur home">
            <span className="brand-mark">f</span>
            Fundur
          </Link>
          <p className="small muted">
            Reusable, AI-assisted workflows for multi-phase projects. Free while in beta. Built in South Africa.
          </p>
          <p className="small">
            <EmailLink />
          </p>
        </div>

        <nav aria-label="Product" className="site-footer-col">
          <h2 className="eyebrow">Product</h2>
          <Link href="/welcome">Home</Link>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/">Open Fundur</Link>
        </nav>

        <nav aria-label="Legal" className="site-footer-col">
          <h2 className="eyebrow">Legal</h2>
          {LEGAL_PAGES.map((p) => (
            <Link key={p.href} href={p.href}>
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="site-footer-legal tiny muted">
        <span>
          © 2026 {COMPANY.legalName ?? <Fact k="legalName" />}
          {COMPANY.registrationNumber ? ` · Reg. ${COMPANY.registrationNumber}` : ""}. {COMPANY.tradingName} is a
          trading name. All rights reserved.
        </span>
        <span>
          Personal information is handled under POPIA. <Link href="/legal/privacy">Privacy</Link> ·{" "}
          <Link href="/legal/paia">PAIA</Link> · <Link href="/legal/company">ECTA disclosures</Link>
        </span>
      </div>
    </footer>
  );
}
