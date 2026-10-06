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
