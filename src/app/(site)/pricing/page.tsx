import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ctaLinks, getSiteSession } from "@/components/site/session";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Fundur is free while in beta. Paid plans will be announced in advance, and nothing is charged automatically.",
};

export default async function PricingPage() {
  const session = await getSiteSession();
  const { signUp } = ctaLinks(session);
  const start = session.signedIn ? "/" : signUp;
  return (
    <>
      <section className="site-section">
        <div className="site-price-band">
          <div>
            <p className="eyebrow">Pricing</p>
            <h1 className="display-xl">
              Free while <em>we&apos;re in beta.</em>
            </h1>
            <p className="lede">
              Fundur is in beta, so every feature is free for everyone who signs up. Pricing comes later, and you will
              hear about it from us before anything changes.
            </p>
          </div>
          <div className="site-price-card">
            <p className="eyebrow">Beta</p>
            <p className="site-price">
              R0<span className="small muted"> during the beta</span>
            </p>
            <ul className="site-ticks">
              <li>
                <Check size={16} /> Every feature listed on <Link href="/features">Features</Link>
              </li>
              <li>
                <Check size={16} /> No card needed to sign up
              </li>
              <li>
                <Check size={16} /> AI help included, with its cost shown on every action
              </li>
              <li>
                <Check size={16} /> Report issues from any screen, straight to the team
              </li>
            </ul>
            <a href={start} className="btn btn-accent btn-block">
              {session.signedIn ? "Open Fundur" : "Start free"} <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      <section className="site-section site-faq">
        <div className="site-section-head">
          <p className="eyebrow">When pricing launches</p>
          <h2 className="display-l">
            Our promises <em>for beta users.</em>
          </h2>
        </div>
        <details className="site-faq-item" open>
          <summary>You&apos;ll hear first</summary>
          <p>
            We will publish the prices and let everyone using the beta know before paid plans start, with enough
            notice to decide what suits you.
          </p>
        </details>
        <details className="site-faq-item" open>
          <summary>Nothing is charged automatically</summary>
          <p>
            There is no card on file during the beta, so nothing can be charged. Paid plans will be billed through
            Whop, our payment provider, and you will only pay if you choose a plan and agree to its terms.
          </p>
        </details>
        <details className="site-faq-item" open>
          <summary>Your work stays yours</summary>
          <p>
            Whatever you decide, your projects and files remain yours. You can ask us for a copy of your information at
            any time, as our <Link href="/legal/privacy">privacy policy</Link> explains.
          </p>
        </details>
        <details className="site-faq-item" open>
          <summary>Clear, complete prices</summary>
          <p>
            Fundur is based in South Africa. Paid plans will show the full price, including any VAT, as the Consumer
            Protection Act and the Electronic Communications and Transactions Act require.
          </p>
        </details>
      </section>
    </>
  );
}
