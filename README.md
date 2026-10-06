# Fundur Workflows

> Reusable, AI-assisted process workflows for multi-phase professional projects.

Built with **Next.js (App Router)**, **Neon (PostgreSQL)**, **Auth0**, and deployed on **Vercel**.

---

## Key Highlights

- **Zero-Refresh Real-Time Architecture**: Users stay in a phase working with documents, AI co-pilot, and team members without jarring page reloads.
- **Debounced Auto-Save Engine**: Fields, checklists, and plan adjustments save automatically without manual "Save" buttons.
- **Workflows as Data**: Multi-phase processes are defined via validated JSON schemas (`zod`), enabling dynamic module rendering, custom workflows, and AI workflow generation.
- **Corporate Interior Fit-out Workflow v1**: Flagship 6-phase corporate interior design workflow (Discovery, Space Planning, Concept, Documentation, Sourcing & FF&E, Delivery).

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

See [NEON_SETUP.md](file:///NEON_SETUP.md) for Neon Postgres database connection strings and [AUTH0_SETUP.md](file:///AUTH0_SETUP.md) for Auth0 authentication keys.

### 3. Run Database Migrations (Neon)
Once your Neon connection string is in `.env.local`:
```bash
npm run db:migrate
```

### 4. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Architectural Documentation
- [Real-Time State Architecture](file:///REALTIME_ARCHITECTURE.md)
- [System Architecture & Roadmap](file:///ARCHITECTURE.md)
- [Neon Setup Guide](file:///NEON_SETUP.md)
- [Auth0 Setup Guide](file:///AUTH0_SETUP.md)
