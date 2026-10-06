# Neon Database Setup Guide

This project uses **Neon (PostgreSQL)** for serverless database storage with connection pooling.

---

## 1. Create your Neon Project
1. Go to [neon.tech](https://neon.tech) and sign in or sign up.
2. Click **Create Project**.
3. Name your project: `fundur-workflows`.
4. Choose the region closest to your Vercel deployment (e.g. `us-east-1` or `eu-west-1`).

---

## 2. Obtain Connection Strings
In the Neon Console:
1. Go to the **Dashboard** for your database.
2. In the **Connection Details** widget:
   - Select **Pooled connection**: Copy the connection string. This is your `DATABASE_URL`.
   - Select **Direct connection**: Copy the connection string. This is your `DATABASE_URL_UNPOOLED`.

Example:
```env
DATABASE_URL="postgres://andre:secret@ep-cool-base-123456-pooler.us-east-1.aws.neon.tech/fundur_workflows?sslmode=require"
DATABASE_URL_UNPOOLED="postgres://andre:secret@ep-cool-base-123456.us-east-1.aws.neon.tech/fundur_workflows?sslmode=require"
```

---

## 3. Configure Local Environment
Add these strings to your `.env.local` file:
```env
DATABASE_URL="<your-neon-pooled-connection-string>"
DATABASE_URL_UNPOOLED="<your-neon-direct-connection-string>"
```

---

## 4. Run Schema Migration
Migrations live in `src/lib/db/migrations/` and run in file-name order. Each one runs once; `schema_migrations` records which have run. `npm run build` runs them before building, so every Vercel deploy brings its database up to date first. To run them by hand:
```bash
npm run db:migrate
```

To change the schema, add a new numbered file (for example `003_add_x.sql`). Never edit a file that has already run on a database.

Projects are stored in the database once both the database and Auth0 are configured. Each person who signs in gets a workspace of their own, and every query is scoped to it. Without Auth0 the app keeps running on demo data in the browser.

This provisions:
- `workspaces`, `users`, `memberships`
- `workflows`, `workflow_versions`
- `projects`, `phase_instances`, `tasks`
- `documents`, `document_versions`
- `records`, `module_data`, `share_links`
- `ai_runs`, `provider_keys`, `issue_reports`, `feature_flags`

---

## 5. Vercel Integration
When deploying to Vercel:
1. Go to your Vercel Project Settings -> **Integrations** or **Environment Variables**.
2. Either install the official **Neon Vercel Integration** (which automatically injects `DATABASE_URL`), or manually add `DATABASE_URL` and `DATABASE_URL_UNPOOLED` under **Environment Variables**.
