import Link from "next/link";
import { LEGAL_UPDATED } from "@/lib/site/company";
import { LEGAL_PAGES } from "./SiteFooter";

/** The frame every legal page shares: title, date and the list of the other legal pages. */
export function LegalDoc({
  path,
  title,
  intro,
  children,
}: {
  path: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="site-section legal">
      <aside className="legal-nav" aria-label="Legal pages">
        <p className="eyebrow">Legal</p>
        {LEGAL_PAGES.map((p) => (
          <Link key={p.href} href={p.href} aria-current={p.href === path ? "page" : undefined}>
            {p.label}
          </Link>
        ))}
      </aside>
      <article className="legal-doc">
        <p className="eyebrow">Last updated {LEGAL_UPDATED}</p>
        <h1 className="display-l">{title}</h1>
        <div className="lede">{intro}</div>
        <div className="prose">{children}</div>
      </article>
    </div>
  );
}
