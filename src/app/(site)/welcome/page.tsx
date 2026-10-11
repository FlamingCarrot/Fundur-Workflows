import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Sun,
  Route,
  Sparkles,
  CalendarDays,
  FileText,
  Share2,
  Palette,
  Search,
  Smartphone,
  ShieldCheck,
  Wallet,
  Check,
} from "lucide-react";
import workflow from "@/lib/workflow/definitions/interior-design-corporate.json";
import { ctaLinks, getSiteSession } from "@/components/site/session";
import { Shot } from "@/components/site/Shot";

export const metadata: Metadata = {
  title: { absolute: "Fundur · AI-assisted workflows for multi-phase projects" },
  description:
    "Run every project through a clear, phase-by-phase process with an AI assistant at every step. Built first for interior designers. Free while in beta.",
};

const SWATCH_ORDER = ["clay", "sage", "oak", "slate", "blush", "ochre"];

export default async function WelcomePage() {
  const session = await getSiteSession();
  const links = ctaLinks(session);
  const startLabel = session.signedIn ? "Open Fundur" : session.authEnabled ? "Start free" : "Try the demo";
  const startHref = session.signedIn ? "/" : links.signUp;

  return (
    <>
      {/* Hero */}
      <section className="site-hero">
        <div className="site-hero-copy rise">
          <p className="site-pill">
            <span className="live-dot" aria-hidden /> Free while in beta
          </p>
          <h1 className="display-xl">
            Every project, one clear process. <em>AI at every step, you in charge.</em>
          </h1>
          <p className="lede">
            Fundur runs your projects through a phase-by-phase workflow, tells you what needs you today, and puts an AI
            assistant beside every step. It is built first for interior designers running corporate fit-outs.
          </p>
          <div className="site-cta-row">
            <a href={startHref} className="btn btn-accent btn-lg">
              {startLabel} <ArrowRight size={18} />
            </a>
            <Link href="/features" className="btn btn-secondary btn-lg">
              See what&apos;s inside
            </Link>
          </div>
          <p className="small muted">No card needed. Every feature is free for everyone during the beta.</p>
        </div>

        <div className="site-hero-visual">
          <Shot
            src="/site/today.webp"
            darkSrc="/site/today-dark.webp"
            width={1440}
            height={900}
            alt="The Today screen: the single most urgent step across all projects, then everything else waiting on you."
            priority
            className="site-shot-main"
          />
          <Shot
            src="/site/mobile-today.webp"
            width={780}
            height={1688}
            alt="Fundur on a phone, with the same Today screen and a floating tab bar."
            className="site-shot-phone"
          />
        </div>
        <p className="tiny muted site-caption">Real screens from the app, shown with sample projects.</p>
      </section>

      {/* Three promises */}
      <section className="site-section">
        <div className="site-section-head">
          <p className="eyebrow">Why Fundur</p>
          <h2 className="display-l">
            Built for work that takes <em>weeks, not minutes.</em>
          </h2>
          <p className="lede">
            Most tools either track tasks or automate clicks. Fundur holds the whole process: the phases, the steps, the
            documents and the decisions, with AI help that knows the project.
          </p>
        </div>
        <div className="site-grid-3">
          <article className="site-card">
            <span className="site-icon">
              <Sun size={20} />
            </span>
            <h3 className="display-s">Know what needs you today</h3>
            <p>
              Today picks the single most urgent step across every job, then lists the rest. Mark each project as
              waiting on you or on the client in one tap.
            </p>
          </article>
          <article className="site-card">
            <span className="site-icon">
              <Route size={20} />
            </span>
            <h3 className="display-s">A process that carries the job</h3>
            <p>
              Each project follows a workflow of phases and steps. Essentials must be ticked before a phase completes,
              and what one phase decides is handed to the next.
            </p>
          </article>
          <article className="site-card">
            <span className="site-icon site-icon-accent">
              <Sparkles size={20} />
            </span>
            <h3 className="display-s">AI proposes, you decide</h3>
            <p>
              AI drafts the brief from your meeting notes and answers questions with the project in mind. Nothing
              changes until you approve it, and every AI action shows what it cost.
            </p>
          </article>
        </div>
      </section>

      {/* The first workflow */}
      <section className="site-section">
        <div className="site-section-head">
          <p className="eyebrow">The first workflow</p>
          <h2 className="display-l">
            {workflow.name}, <em>in six phases.</em>
          </h2>
          <p className="lede">
            Fundur&apos;s first workflow is built with a practising interior designer and follows a real fit-out from
            the first site visit to handover. A UX &amp; product design workflow is ready too, and you can adapt either or
            build your own.
          </p>
        </div>
        <ol className="site-phases">
          {workflow.phases.map((phase, i) => (
            <li
              key={phase.key}
              className="site-phase"
              style={{ ["--swatch" as string]: `var(--swatch-${SWATCH_ORDER[i % SWATCH_ORDER.length]})` }}
            >
              <span className="site-phase-num">{i + 1}</span>
              <h3>{phase.name}</h3>
              <p className="small">{phase.description}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Spotlights */}
      <section className="site-section">
        <div className="site-spotlight">
          <div className="site-spotlight-copy">
            <p className="eyebrow">Floor plan editor</p>
            <h2 className="display-m">
              Draw the plan <em>right in the project.</em>
            </h2>
            <p>
              Walls, partitions, doors, windows, columns and rooms with live areas, plus furniture, notes and
              dimensions. Type exact lengths, trace over a photo or scan, or import a DXF file. Every saved version
              exports to DXF and IFC for your CAD and BIM tools.
            </p>
            <ul className="site-ticks">
              <li>
                <Check size={16} /> Usable area worked out as you draw
              </li>
              <li>
                <Check size={16} /> Undo, versions and restore
              </li>
              <li>
                <Check size={16} /> Several floors and a linked 3D view
              </li>
            </ul>
          </div>
          <Shot
            src="/site/plan.webp"
            width={1440}
            height={900}
            alt="The floor plan editor showing an office with an open plan, meeting room, kitchen and core, each with its area."
          />
        </div>

        <div className="site-spotlight site-spotlight-flip">
          <div className="site-spotlight-copy">
            <p className="eyebrow">Layout options</p>
            <h2 className="display-m">
              Five scored layouts <em>from your own rules.</em>
            </h2>
            <p>
              Set desk sizes, aisles and routes once as layout rules. Fundur lays out desks for the brief&apos;s teams
              several ways and scores each one on desks, area per desk, circulation, walking distance and rule breaks.
              Compare them, open one to adjust it, then choose one to carry into concept.
            </p>
          </div>
          <Shot
            src="/site/layouts.webp"
            width={860}
            height={620}
            alt="Two layout options side by side, each with a desk plan, a score and its measurements."
          />
        </div>

        <div className="site-spotlight">
          <div className="site-spotlight-copy">
            <p className="eyebrow">Phases and steps</p>
            <h2 className="display-m">
              One phase at a time, <em>nothing forgotten.</em>
            </h2>
            <p>
              Each phase lists its steps with due dates, the tools it needs and AI help for each step. A bar at the
              bottom tracks what is still essential, and completing a phase opens the next with everything handed over.
            </p>
          </div>
          <Shot
            src="/site/phase.webp"
            width={1440}
            height={900}
            alt="A phase screen listing its steps with due dates, and the tools for that phase."
          />
        </div>
      </section>

      {/* AI band */}
      <section className="site-band">
        <div className="site-band-inner">
          <div>
            <p className="eyebrow">AI in Fundur</p>
            <h2 className="display-l">
              AI where it helps. <em>Never behind your back.</em>
            </h2>
            <p className="lede">
              Fundur works with models from Anthropic, OpenAI, Google, xAI and hundreds more through OpenRouter. Simple
              jobs go to quicker models and the important ones get a review by a stronger model.
            </p>
            <Link href="/legal/ai" className="btn btn-secondary">
              How we use AI
            </Link>
          </div>
          <ul className="site-band-list">
            <li>
              <FileText size={18} />
              <div>
                <strong>Brief from meeting notes.</strong> Paste or upload notes and pick which drafted fields to keep.
                Drafted fields stay marked until you confirm them.
              </div>
            </li>
            <li>
              <Sparkles size={18} />
              <div>
                <strong>Ask Fundur.</strong> A chat that knows the project. When it wants to change something, it shows
                you the change and waits for your yes.
              </div>
            </li>
            <li>
              <Wallet size={18} />
              <div>
                <strong>Costs in the open.</strong> Every AI action shows its cost, with spend by phase, step and model,
                and budgets with alerts.
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* Everything else */}
      <section className="site-section">
        <div className="site-section-head">
          <p className="eyebrow">Also inside</p>
          <h2 className="display-l">
            The everyday things, <em>done properly.</em>
          </h2>
        </div>
        <div className="site-grid-4">
          <Mini icon={<CalendarDays size={18} />} title="Due list, calendar and timeline">
            Every dated step across projects. Drag a phase on the timeline and its steps move with it.
          </Mini>
          <Mini icon={<FileText size={18} />} title="Documents with versions">
            Upload files to the phase they belong to, from a computer or a phone camera, and keep every version.
          </Mini>
          <Mini icon={<Share2 size={18} />} title="Share with clients">
            Private live or frozen links with your own branding. Clients comment and approve, even on a phone.
          </Mini>
          <Mini icon={<Search size={18} />} title="Search everything">
            Find projects, clients, documents, briefs and notes from one box with ⌘K.
          </Mini>
          <Mini icon={<Smartphone size={18} />} title="Made for phones too">
            Phone layouts for site visits, with photos straight from the camera.
          </Mini>
          <Mini icon={<Palette size={18} />} title="Concept to handover">
            Mood boards, AI concept visuals, schedules, quotes, deliveries and snags, all in the project.
          </Mini>
          <Mini icon={<ShieldCheck size={18} />} title="Backed up nightly">
            Your workspace is backed up every night and backups are kept for 30 days.
          </Mini>
          <Mini icon={<Route size={18} />} title="Your own workflows">
            Edit phases, steps and forms, or describe how you work and let AI draft a workflow for you to review.
          </Mini>
        </div>
        <p className="site-more">
          <Link href="/features" className="btn btn-ghost">
            See every feature <ArrowRight size={16} />
          </Link>
        </p>
      </section>

      {/* Pricing */}
      <section className="site-section">
        <div className="site-price-band">
          <div>
            <p className="eyebrow">Pricing</p>
            <h2 className="display-l">
              Free while <em>we&apos;re in beta.</em>
            </h2>
            <p className="lede">
              Use every feature at no cost while Fundur is in beta. Paid plans come later; we will publish the pricing
              and tell you before anything changes. Nothing is ever charged automatically.
            </p>
          </div>
          <div className="site-price-card">
            <p className="eyebrow">Beta</p>
            <p className="site-price">
              R0<span className="small muted"> during the beta</span>
            </p>
            <ul className="site-ticks">
              <li>
                <Check size={16} /> Every feature on this page
              </li>
              <li>
                <Check size={16} /> No card needed
              </li>
              <li>
                <Check size={16} /> Your feedback shapes what we build
              </li>
            </ul>
            <a href={startHref} className="btn btn-accent btn-block">
              {startLabel}
            </a>
            <Link href="/pricing" className="small site-link">
              What happens when pricing launches
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="site-section site-faq">
        <div className="site-section-head">
          <p className="eyebrow">Questions</p>
          <h2 className="display-l">Good to know</h2>
        </div>
        <Faq q="Is it really free?">
          Yes. Everything is free during the beta, and you don&apos;t need a card to sign up. When paid plans launch we
          will publish the prices and give you notice first; you decide whether to continue.
        </Faq>
        <Faq q="Do I have to be an interior designer?">
          No. Fundur comes with workflows for corporate interior fit-outs and for UX &amp; product design, and you can
          edit them or build your own, by hand or by describing your process to the AI workflow builder. Interior design
          is where it is most complete today.
        </Faq>
        <Faq q="Does it work with my CAD files?">
          You can import DXF plans and export every saved version as DXF or IFC. For DWG, Revit or PDF plans, save a
          DXF copy from your CAD software for now; reading those formats directly is planned.
        </Faq>
        <Faq q="Which AI does Fundur use, and does it see my data?">
          Fundur sends only what an AI action needs to the AI provider chosen for that task, such as Anthropic, OpenAI,
          Google, xAI or a model through OpenRouter. Read <Link href="/legal/ai">how we use AI</Link> and our{" "}
          <Link href="/legal/privacy">privacy policy</Link> for the details.
        </Faq>
        <Faq q="Where is my work stored?">
          Projects are kept in a Neon database and files in private Vercel Blob storage, both reached only through your
          signed-in account. Sign-in is handled by Auth0. We never sell your information.
        </Faq>
        <Faq q="Can I use it on my phone?">
          Yes. Fundur has phone layouts for the screens you use on the move, and you can add photos straight from your phone&apos;s camera.
        </Faq>
      </section>

      {/* Closing call */}
      <section className="site-section">
        <div className="site-closing">
          <h2 className="display-l">
            Bring your next project. <em>We&apos;ll bring the process.</em>
          </h2>
          <p className="lede">Join the beta today and help shape what Fundur becomes.</p>
          <div className="site-cta-row">
            <a href={startHref} className="btn btn-primary btn-lg">
              {startLabel} <ArrowRight size={18} />
            </a>
            <Link href="/about" className="btn btn-ghost btn-lg">
              About Fundur
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Mini({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <article className="site-mini">
      <span className="site-icon site-icon-sm">{icon}</span>
      <h3>{title}</h3>
      <p className="small">{children}</p>
    </article>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="site-faq-item">
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  );
}
