# Fundur against comparable products

Written 2026-10-13 for Andre's ask to "near full automate the workflow" and keep improving the app against competitors. Compared from public product pages and docs as known at the time; prices and features move, so treat the table as a snapshot.

## Who we are compared with

| Product | What designers and freelancers use it for |
|---|---|
| Houzz Pro | Leads, estimates and proposals, invoices and online payments, time tracking, mood boards, 3D floor planner, client dashboard, selections |
| Studio Designer | Product clipper, specifications, purchase orders, time billing, invoicing and full accounting for interior designers |
| Programa | Product library and clipper, schedules, client presentations with approvals, invoicing, time tracking, Xero sync |
| Ivy (now part of Houzz) | Proposals, invoices, client portal, product clipper, time tracking |
| Dubsado / HoneyBook | Client CRM, enquiry forms, proposals with contracts and e-signature, invoices, scheduler, and rule-based "workflows" that send emails and forms on triggers |
| Notion / ClickUp | Docs, tasks, boards, timelines, rule automations, and AI agents that act on a workspace |
| Miro / FigJam | Whiteboards and mood boards |

## What Fundur already does as well or better

- A real phase-by-phase workflow with essential steps, handoffs and readiness checks (others have task lists or rule-based email sequences, not a design process).
- A 2D/3D plan editor with DXF and IFC export, layout options and design library, inside the same project (Houzz Pro has a floor planner; the others do not).
- One AI layer that can read and change everything a person can, with undo, on every page.
- Item register with prices and budget, supplier quote requests, spec drafting from a product URL (a clipper equivalent).
- Client view by invite, share links with approvals and comments, team space, timeline with baselines, to-dos, Kanban, calendar feed and booking links.
- Regulation checklist with AI pre-checks (none of the competitors have this).

## Gaps, ranked by value to a solo designer or small studio

| # | Gap | Who has it | Value | Status |
|---|---|---|---|---|
| 1 | **The project drives itself.** Rule automations (Dubsado, ClickUp) fire fixed actions; nobody has an agent that works out the next step, does it, and asks only for what it needs. | Dubsado, HoneyBook, ClickUp (rules only) | Highest: Andre's goal, and the clearest difference from every competitor | **Built: Autopilot + Inbox** (below) |
| 2 | **Time tracking** against a project, phase or step, with a running timer | Houzz Pro, Studio Designer, Programa, Ivy, ClickUp | High: feeds invoices and shows where fees go | Next |
| 3 | **Fee proposals and invoices** to the client (from fixed fees, time and items with markup), with sent, paid and overdue states | Houzz Pro, Studio Designer, Programa, Ivy, Dubsado | High: the money side of running the business here | Next |
| 4 | **Client updates** written for her each week or at milestones | Houzz Pro (dashboard), Dubsado (emails) | High with autopilot: the client is kept informed without her writing | Built as autopilot drafts (copy and send; no email provider yet) |
| 5 | **Enquiry form and leads** that become projects | Houzz Pro, Dubsado, HoneyBook | Medium: the storefront has no intake yet | Later |
| 6 | **Contracts with e-signature** | Dubsado, HoneyBook | Medium; needs legal review of templates (South African ECTA) | Later, after attorney review |
| 7 | **Online card payments** on invoices | Houzz Pro, Dubsado, HoneyBook | Medium; needs a payment provider decision (Whop is for Fundur's own plans) | Needs Andre |
| 8 | **Purchase orders** to suppliers from the item register | Studio Designer, Programa | Medium for designers who procure | Later |
| 9 | **Email sending** (client updates, reminders, invoices) | All of them | Blocks 4 and 3 from going out by themselves | Needs an email provider (Andre) |
| 10 | **Accounting sync** (Xero, QuickBooks, Sage) | Studio Designer, Programa | Low at our stage | Later |

## The autopilot

What it is: an agent per project that drives it through its workflow. It works out the next steps from the workflow (essential steps first, due dates, readiness, the brief, overdue work, how long the client has been quiet), does what it can with the same tools as the assistant, and asks her only for what it cannot know or decide.

- **Control.** Off by default per project. She turns it on, can pause it, and sets how much it does, for the whole project, per phase and per step: *Do it* (small reversible changes apply at once with Undo), *Do it, I review* (it does the work, every change waits for her), *Ask me* (it only asks or reminds) and *Leave to me* (it does not touch that step).
- **Always her call.** Ticking essential steps, completing a phase, sharing anything with the client, deleting, and anything sent outside the studio always wait for her, whatever the level.
- **Inbox.** One place, built for the phone, with what it needs from her (questions, choices, files, approvals, client updates to send) and the changes waiting for review, across all projects, plus what it did with Undo.
- **When it runs.** When she presses Run now, when she answers one of its questions, when she opens the app and a project is due a check, and from a daily cron. It sets its own next check (for example, two days after asking the client for something) and skips the model call entirely when nothing needs doing.
- **Cost.** Each run is logged like any AI call against the project and its budget; a project runs at most a few times a day unless she presses Run now.
