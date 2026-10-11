import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { getSiteSession } from "@/components/site/session";
import type { Metadata } from "next";
import "./site.css";

export const metadata: Metadata = {
  title: { default: "Fundur", template: "%s · Fundur" },
};

/** The public site: storefront, about, pricing and legal pages, open to signed-out visitors. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const session = await getSiteSession();
  return (
    <div className="site">
      <a href="#main" className="site-skip">
        Skip to content
      </a>
      <SiteHeader session={session} />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
