import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/site/LegalDoc";
import { EmailLink } from "@/components/site/Fact";

export const metadata: Metadata = {
  title: "How we use AI",
  description: "What Fundur's AI features do, what they see, which providers handle them and how you stay in control.",
};

export default function AiNoticePage() {
  return (
    <LegalDoc
      path="/legal/ai"
      title="How we use AI"
      intro="AI is part of almost every step in Fundur. This page explains plainly what it does, what it sees, who processes it and how you stay in control."
    >
      <h2>What the AI does</h2>
      <ul>
        <li>
          <strong>Drafts a brief from notes</strong> you paste or upload. You choose which drafted fields to keep, and
          drafted fields stay marked until you edit or confirm them.
        </li>
        <li>
          <strong>Answers questions in Ask Fundur</strong>, the project chat, using the project&apos;s details. It can look
          things up in the project and propose changes, such as ticking a step or making layout options.
        </li>
        <li>
          <strong>Helps with layouts</strong>: the assistant can run the layout generator, which itself follows your layout
          rules.
        </li>
        <li>
          <strong>Drafts concept visuals</strong> from confirmed brief fields and a saved plan or project image, and
          drafts specification text from saved item facts. Both wait for your review.
        </li>
        <li>
          <strong>Builds workflows</strong>: the workflow builder interviews you about how you work and drafts a workflow
          for you to review before anything is published.
        </li>
        <li>
          <strong>Advises the Admin</strong>: the improvement advisor reads summary usage numbers, issue reports and the
          Admin&apos;s notes to suggest what to improve next. It does not read your projects.
        </li>
      </ul>

      <h2>You stay in control</h2>
      <ul>
        <li>AI output is never applied silently. The assistant shows a proposed change and only makes it when you confirm.</li>
        <li>AI can be wrong. Check its work before you rely on it or share it, especially anything with legal, financial or safety weight.</li>
        <li>Every AI action shows its cost, and project budgets can alert you or pause AI when a limit is reached.</li>
      </ul>

      <h2>What the AI sees</h2>
      <p>
        Only what a task needs: for example the notes you are drafting from, or the project details relevant to your
        question. That can include personal information you have put into the project, such as a client contact&apos;s
        name. Please avoid putting sensitive personal information into AI features unless it is necessary.
      </p>

      <h2>Who processes it</h2>
      <p>
        Fundur sends AI requests to the provider set up for each kind of task. Lighter tasks go to quicker models, and
        important work can be reviewed by a stronger one. The providers Fundur can use are Anthropic, OpenAI, Google
        (Gemini), xAI (Grok) and OpenRouter, which forwards requests to the model chosen for the task. They process
        requests outside South Africa under their own business (API) terms; our{" "}
        <Link href="/legal/privacy">privacy policy</Link> explains how we handle transfers.
      </p>
      <p>
        Fundur does not train its own AI models on your content. We send requests through the providers&apos; business
        APIs rather than their consumer apps.
      </p>

      <h2>What we keep</h2>
      <p>
        For each AI call we record the feature, the model, the amount of text processed and the cost, so you can see
        your spend. Conversations with Ask Fundur are kept with the project so you can return to them, and saved concept
        visuals are stored privately with the project.
      </p>

      <h2>Questions</h2>
      <p>
        Email <EmailLink />. If you think the AI has produced something harmful or wrong, use Report an issue in the app
        so we can look at it.
      </p>
    </LegalDoc>
  );
}
