import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { COMPANY } from "@/lib/site/company";
import { EmailLink } from "@/components/site/Fact";
import { ctaLinks, getSiteSession } from "@/components/site/session";

export const metadata: Metadata = {
  title: "About",
  description:
    "Fundur is a workflow platform for multi-phase professional projects, built in South Africa with a practising interior designer.",
};

const PRINCIPLES: [string, string][] = [
  ["Workflows are data, not code", "A new kind of work should need a new workflow, not new software."],
  ["Building blocks are shared", "A floor plan editor, a checklist or a form is built once and reused by every workflow."],
  ["AI proposes, people decide", "Anything with legal or financial weight stays under your control."],
  ["Cost is visible", "Every AI action shows what it cost, so there are no surprises."],
  ["Your clients see your brand", "Pages you share with clients are clean and carry your name and logo, not ours."],
];

export default async function AboutPage() {
  const session = await getSiteSession();
  const { signUp } = ctaLinks(session);
  return (
    <>
      <section className="site-section">
        <div className="site-page-head">
          <p className="eyebrow">About</p>
          <h1 className="display-xl">
            Good work follows a process. <em>Fundur keeps it.</em>
          </h1>
          <p className="lede">
            Designers, consultants and studios usually run three to five jobs at once. Each one moves through the same
            phases, and each one needs documents, decisions and follow-ups at the right time. Fundur turns that process
            into a workflow you can run every project through, with AI help at every step.
          </p>
        </div>
      </section>

      <section className="site-section">
        <div className="site-two-col">
          <article className="site-card">
            <h2 className="display-s">Why we&apos;re building it</h2>
            <p>
              Automation tools are good at moving data between apps in seconds. Professional projects are different:
              they run for weeks or months, people decide and approve at every step, and the output is documents, plans
              and schedules. Fundur is built for that kind of work, with an assistant that sees the whole project.
            </p>
          </article>
          <article className="site-card">
            <h2 className="display-s">Who builds it</h2>
            <p>
              Fundur is built in South Africa by {COMPANY.founder}, together with a practising interior designer who uses
              it on real projects. Every phase of the build ends with a check on a real job before the next one starts.
            </p>
          </article>
          <article className="site-card">
            <h2 className="display-s">Where it starts</h2>
            <p>
              The first workflow covers corporate interior fit-outs in six phases, from discovery and the brief to
              delivery and handover. The pieces built for it, like the floor plan editor and the layout generator,
              become building blocks for the workflows that follow.
            </p>
          </article>
          <article className="site-card">
            <h2 className="display-s">Where it&apos;s going</h2>
            <p>
              A second workflow, for UX &amp; product design, is already in Fundur, and practices can edit workflows or
              describe their process and let AI draft one. Next come reading more plan formats directly, working
              offline on site, and deeper tools for the UX workflow.
            </p>
          </article>
        </div>
      </section>

      <section className="site-section">
        <div className="site-section-head">
          <p className="eyebrow">What we believe</p>
          <h2 className="display-l">
            Five rules <em>we build by.</em>
          </h2>
        </div>
        <ul className="site-feature-list">
          {PRINCIPLES.map(([name, text]) => (
            <li key={name}>
              <span>
                <strong>{name}.</strong> {text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="site-section">
        <div className="site-closing">
          <h2 className="display-l">
            Talk to us, <em>or just try it.</em>
          </h2>
          <p className="lede">
            Fundur is in beta and free to use. Questions, ideas and problems are all welcome at <EmailLink />, or use
            Report an issue inside the app.
          </p>
          <div className="site-cta-row">
            <a href={session.signedIn ? "/" : signUp} className="btn btn-primary btn-lg">
              {session.signedIn ? "Open Fundur" : "Start free"} <ArrowRight size={18} />
            </a>
            <Link href="/legal/company" className="btn btn-ghost btn-lg">
              Company information
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
