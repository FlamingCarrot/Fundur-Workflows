# Plans and billing

Decided 2026-10-07 with Andre.

## Plans

| | Free | Paid ($20/month) |
|---|---|---|
| Projects | 1 open at a time (completed ones don't count) | Unlimited |
| File storage | 1 GB | 50 GB |
| AI allowance | $1 a month | $10 a month (fair use; adjustable in `plans.ts`) |
| Team seats | Just the owner | $5 a month per extra seat; one or more makes it a **Team** plan, 0 makes it plain Paid |
| Plan editor | 1 floor, 3 named versions, no DXF/IFC export, no DXF import, no tracing over images | Everything |
| Layout generator | No | Yes |
| Custom workflows, client pages, templates | No | Yes |

The platform Admin and the open demo have everything. While the **free beta** is on (Settings → Plans, on by default) every account gets Paid at no charge; seats aren't counted.

## How limits work

`src/lib/billing/plans.ts` holds the plans as data. Limits name workflows and modules by key, with `"*"` defaults, so a new workflow (UX design next) or module is covered without code changes:

- `workflows[id].access` can make a whole workflow Paid-only.
- `modules[key]` is `full`, `limited` or `none`; `workflows[id].modules` overrides it inside one workflow.
- `moduleLimits[key]` holds a module's named caps (`floors: 1`, `exportDxf: false`) that apply where it is `limited`.
- `features` covers what sits above modules (custom workflows, team seats, client pages, templates).

Servers check with `src/lib/billing/guard.ts` (402 with a readable message); screens use `usePlan()` to lock what the plan leaves out. Counts only refuse growth, so work made on Paid stays editable after a move to Free. Assistant tools of modules a plan leaves out are neither offered nor run.

For other threads: `assertSeatAvailable` before adding a member, `hasFeature(limits, "client_portal")` for client pages, `hasFeature(limits, "custom_workflows")` for the workflow builder.

## Admin

Settings → Plans: switch the beta, find any account, assign Free or Paid (for N months or no end), give free months, set a percent or dollar discount, set seats, see the history. Codes give free months or a discount; each account can use a code once.

## Payments

Provider: **Whop**. `src/lib/billing/provider.ts` is the plug-in point; nothing is charged until it is wired with Whop's keys and plan ids. Its webhook will write subscriptions (source `provider`) through the same store.
