import Link from "next/link";
import { Menu } from "lucide-react";
import { ctaLinks, type SiteSession } from "./session";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export function SiteHeader({ session }: { session: SiteSession }) {
  const links = ctaLinks(session);
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/welcome" className="brand" aria-label="Fundur home">
          <span className="brand-mark">f</span>
          Fundur
          <span className="site-beta">Beta</span>
        </Link>

        <nav className="site-nav" aria-label="Site">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="site-nav-link">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="site-header-actions">
          {session.signedIn ? (
            <Link href="/" className="btn btn-primary btn-sm">
              Open Fundur
            </Link>
          ) : (
            <>
              {session.authEnabled && (
                <a href={links.signIn} className="btn btn-ghost btn-sm site-hide-sm">
                  Sign in
                </a>
              )}
              <a href={links.signUp} className="btn btn-accent btn-sm">
                {session.authEnabled ? "Start free" : "Try the demo"}
              </a>
            </>
          )}
          <details className="site-menu">
            <summary className="icon-btn" aria-label="Menu">
              <Menu size={18} />
            </summary>
            <div className="site-menu-panel">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="site-menu-link">
                  {n.label}
                </Link>
              ))}
              {!session.signedIn && session.authEnabled && (
                <a href={links.signIn} className="site-menu-link">
                  Sign in
                </a>
              )}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
