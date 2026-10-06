# Fundur Workflows — System Architecture & Foundations

## Overview
Fundur Workflows is a reusable, AI-assisted process workflow platform built for independent professionals and small studios. The first flagship workflow is a **six-phase corporate interior design workflow**, built to save 24–39 hours per project across discovery, space planning, concept design, technical documentation, FF&E sourcing, and site delivery.

---

## 1. Core Stack
| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Hosting & CI/CD** | **Vercel** | Serverless Next.js App Router hosting, edge functions, automatic preview and production deployments. |
| **Database** | **Neon (PostgreSQL)** | Serverless Postgres with automatic connection pooling (`@neondatabase/serverless`), branching, and instant scaling. |
| **Authentication** | **Auth0** | Enterprise-grade identity, JWT session validation, role-based access control, social/email login. |
| **Real-Time Sync** | **Server-Sent Events (SSE)** | Zero-refresh live updates across tasks, documents, AI streams, and autosaved state. |
| **Styling** | **Vanilla CSS & Tokens** | High-performance custom properties, HSL color palette, dark mode, glassmorphism, responsive mobile-to-desktop design. |
| **Engine** | **Workflows-As-Data** | JSON Schema validator (`zod`) ensuring workflows are data templates, not hardcoded logic. |

---

## 2. Multi-Tenancy & Data Isolation (Epic 1.0 P1-20)
Every database table carries `workspace_id`. Cross-workspace queries are strictly isolated at both the database and application levels:
- **Workspaces**: Dedicated studio spaces (e.g., *Andre Swanepoel Interiors*).
- **Users**: Identified by Auth0 `sub` IDs, mapped to platform roles (`admin`, `user`).
- **Memberships**: Map users to workspaces with granular roles (`owner`, `member`, `collaborator`, `client`).

---

## 3. Workflows as Data (Epic 1.0 P1-21 & P1-22)
Workflows are **data, not code**:
- Definitions are written in JSON and validated against `WorkflowDefinitionSchema`.
- Each phase references reusable generic modules (`structured_form`, `documents`, `checklist`, `floor_plan_editor`, `layout_generator`, `item_register`, `canvas_board`).
- Context flows seamlessly between phases using declarative **handoffs** (e.g., brief -> space planning -> concept finishes -> documentation schedules -> FF&E procurement).
- Domain terms (like *"FF&E Item"*, *"Fit-out Project"*) are defined in the workflow's `labels` map, keeping the core platform 100% domain-agnostic.

---

## 4. First Workflow: Corporate Fit-out Interior Design v1
1. **Discovery & Brief**: Meeting note synthesis, headcount, department adjacencies, budget confirmation.
2. **Space Planning**: Floor plate geometry calibration, clearance checks, 3–5 automated test-fit layout options.
3. **Concept Design**: Mood boards, material palettes, finish tagging.
4. **Technical Documentation**: Construction schedules, fire safety & accessibility regulation pre-checks.
5. **Sourcing & FF&E**: Supplier register, web specification import, RFQ drafts, budget tracking.
6. **Delivery & Install**: Installation sequence, snag lists with photo uploads, client walkthrough handover.

## 5. The AI layer (phase 4)

One shared AI layer, in `src/lib/ai`, that every module plugs into.

- **Calls.** Every AI call goes through `runAi` or `runChat` (`runs.ts`). The call names a task type; `routing.ts` maps it to a tier (top model or worker model, set on Settings → Routing) and the tier to its models: the role's model, then its fallback when that fails (Settings → AI models). Every attempt is logged in `ai_runs` with its phase, task, role, attempt and cost, and every cost the app shows is a sum of that log (`costs.ts`). After each call the project's budget is checked and alerts fire (`budget.ts`); a used-up budget can pause AI on the project.
- **Review gate.** `runReviewed` (`review.ts`) runs worker-tier work, has the top model review it, and sends it back with the feedback up to the task type's retry cap. Work that still fails comes back flagged and is shown to the designer as unchecked.
- **Tools.** Modules register what the assistant may do in `tools/` with `registerTool`: a description, a zod input schema and a function. The chat offers every registered tool and lists them in its instructions, so a new tool needs no prompt edits. Tools only read, or return proposals: a `ProjectMutation`, the same change a person makes, applied only when the designer confirms it in the chat.
- **Chat.** `orchestrator.ts` runs one reply: files dropped in are read and filed by worker models in parallel, then the top model answers with the project, brief and plan in view, calling tools (in parallel) until it is done. Words, tool activity and proposals stream to the browser as lines of JSON (`/api/projects/[id]/chat`).
- **Untrusted content.** Text from uploaded files is wrapped as `<document>` data and the model is told never to follow instructions in it; the filing model gets no tools.

To add a module's AI actions: register its task types (`registerTaskType`) and tools in a new file under `src/lib/ai/tools/`, and import that file from `tools/index.ts`.
