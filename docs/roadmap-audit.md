# Workflow platform roadmap audit

Audited 7 October 2026 against *Workflow Platform: Vision, First Workflow and Build Plan*, pages 22–47. The attachment is a requirements source; the user's request authorizes implementation and direct deployment to main. Features outside that document are outside this audit.

## Reading the results

**Built** means the application contains a working implementation, backed by the evidence below. It does not mean a designer has completed the document's real-project acceptance exercise. **Partial** identifies a concrete gap. **Deferred** follows an explicit deferral in the document. **Missing** means a placeholder, schema or permission name is not a delivered feature.

The starting revision was `5c7442d3ce261efa83f9c8e33cacc028c9019432`. Phases 1–4 were substantially implemented already. Phase 5 had schema/permission groundwork but no complete client reader or workspace-management journey. This release completes that core journey and repairs material earlier-phase gaps. It does not declare all five phases accepted: live-user, CAD-format and provider checks remain below.

## Phase 1 — workflow core and first AI win

| Story | Status after this release | Evidence and remaining acceptance |
| --- | --- | --- |
| P1-20 Workspace ownership | Built | Workspace-scoped project/file/plan/cost stores; `workspace-context.ts`; `projects-db`, `files-snapshots`, `workspaces` and `sharing` tests. Added selected workspace validation and assigned-project restrictions. |
| P1-21 Definition schema/validator | Built | `src/lib/workflow/schema.ts`, `validator.ts`, `tests/workflow.test.ts`; invalid references rejected and definitions versioned. |
| P1-22 Interior design v1 | Built | `definitions/interior-design-corporate.json`; project creation initializes its phases/checklists. |
| P1-23 Module-driven phases | Partial | Registry and `PhaseView` assemble module sections and honest placeholders. The structured form is still specialized around the brief; chosen-plan handoff is specialized. Generalize before the second workflow. |
| P1-24 Definition labels everywhere | Partial | Label and form lookups exist; some brief/plan module assumptions remain in UI and tools. A complete second-workflow terminology review is still needed. |
| P1-01 Deploy/database pipeline | Built | GitHub main triggers Vercel; `npm run build` runs migrations; baseline Vercel commit status was successful. Release deployment is verified separately after push. |
| P1-02 Login/session | Built; live-user acceptance pending | Auth0 boundary and session/user synchronization. Added workspace selection and deactivated-account boundary. Both actual users signing in must be confirmed with their sessions. |
| P1-03 Server permissions | Built | Named role permissions, admin routes and project-scoped authorization. Extended checks to uploads, versions, realtime, costs, AI tools and shares; tests cover role and tenant refusal. |
| P1-04 Create project | Built | Five-step form, validated API, workflow-based phase initialization; `projects-db`/`studio` tests. |
| P1-05 Project dashboard | Built | Responsive project cards, progress and activity ordering; existing views/selectors. |
| P1-06 Waiting/on hold | Built | Status mutation, filters and realtime updates; `studio`/`sync` tests. |
| P1-07 Persistent phase bar | Partial | Clickable workflow phases on phase workspace and project journey. Not on every focused brief/plan/documents screen; focused screens retain the current design's single-exit frame. |
| P1-08 Shared phase layout | Built | Workflow-driven phase workspace across six phases; unbuilt working modules remain explicit placeholders. |
| P1-09 Checklist completion gates | Built | Essential-task checks enforced in transitions/store, phase advance and UI; `studio`, `tasks`, `projects-db` tests. |
| P1-10 File uploads/downloads | Built; real-file acceptance pending | Private direct-to-Blob uploads, progress, scoped downloads and versions. A real 50 MB round trip and phone camera upload still need live credentials/devices. Resumable retries are incomplete (cross-cutting requirement). |
| P1-11 Phase snapshots/restore | Built | Project snapshots and file-version pointers, restore APIs/UI; `files-snapshots` tests. |
| P1-12 Default model/key | Built | Encrypted server-only provider credentials, verification and default selection; `admin-ai` tests. Real provider key verification requires configured credentials. |
| P1-13 Notes-to-brief | Built; designer acceptance pending | Text/Word/PDF extraction, structured drafts, selected-field review and AI markers; `brief-drafting` tests. Real notes must still be judged by the designer. |
| P1-14 AI action costs | Built | Logged token/cost records and brief/project displays; `admin-ai`, `ai-orchestration` tests. |
| P1-15 Audio transcription | Deferred | Explicitly deferred by the plan until the notes flow is in use. No transcription pipeline. |
| P1-16 Daily DB/file backup | Built; provider drill pending | Fixed manifest-only backup: incremental private file copies, expanded table coverage, retention and file recovery. `backup-restore` tests reconstruct DB and file bytes. Confirm deployed cron, Neon retention and perform a live scratch restore; copies share the original Blob account. |
| P1-17 Report issue | Built | Contextual issue sheet, module/page/project attribution and API; `issues` tests. |
| P1-18 Issue counts/edit/close | Built | Module markers/counts and issue actions; `issues` tests. |
| P1-19 Admin tickets | Built | Admin ticket queue/status/notes and live events. |

## Phase 2 — tasks, calendar and site use

| Story | Status | Evidence and remaining acceptance |
| --- | --- | --- |
| P2-01 Checklist tasks/dates | Built | Workflow task initialization, due dates and synchronized step/task updates; `tasks`, `timeline` tests. |
| P2-02 Manual tasks | Built | Create, complete, snooze and delete in task UI/store. |
| P2-03 Output documents | Built | Task output pointers and links. Fixed acceptance of documents from another project; regression in `tasks.test.ts`. |
| P2-04 Month calendar | Built | Cross-project, material-colored dates and task selection; `calendar` tests. |
| P2-05 Quarter view | Built | Quarter layout and common calendar selection. |
| P2-06 Timeline/drag dates | Built | Phase ranges and shifts propagate to tasks; `timeline` tests. |
| P2-07 Due list | Built | Today/overdue/week selectors and dashboard; `tasks`, `calendar` tests. |
| P2-08 Unified search | Partial | Grouped client/project/document/task search works over authorized loaded data (`studio/search.ts`, `search` tests). The requested database text-search implementation is absent. |
| P2-09 Phone/site photos | Built responsive UI; real-device acceptance pending | Responsive phase/checklist and file upload. Real phone photo round trip is unverified. |
| P2-10 Offline queue | Deferred | Explicit plan deferral; not an offline-capable app. |
| P2-11 Daily summary | Built | Today dashboard and `docs/decisions/daily-summary.md` choose in-app delivery. |

## Phase 3 — floor plan editor

| Story | Status | Evidence and remaining acceptance |
| --- | --- | --- |
| P3-01 Real-file feasibility spike | Missing acceptance exercise | No evidence that five of the designer's actual CAD/BIM files were tested or format choices confirmed with her. |
| P3-02 Import/convert geometry | Partial | ASCII DXF and IFC parsers, normalized geometry and fixtures (`plan-dxf`, `plan-ifc` tests). No DWG/Revit conversion service; do not advertise universal CAD/BIM import. |
| P3-03 Manual scale fallback | Partial | Image underlays, calibration/manual drawing exist. No complete arbitrary PDF-to-editable-geometry fallback. |
| P3-04 Pan/zoom/dimensions | Built; device acceptance pending | Plan canvas, dimensions, metric scale, levels and layers. Smoothness on her laptop/tablet is unverified. |
| P3-05 Correct measurements | Built | Geometry editing/connected updates and validation; `plan-geometry`, `plan-elements` tests. |
| P3-06 Autosave/correction log | Built | Revision-aware save, corrections and local recovery drafts. Recovery keys now use stable workspace/user IDs. Browser recovery mechanism exists; real interrupted-session exercise remains. |
| P3-07 Rooms/areas | Built; manual verification pending | Names, geometry-derived room areas and totals; geometry tests. Compare one actual plan against her measurements. |
| P3-08 Draw from scratch | Built | Walls, openings, columns, rooms, typed measurements and saved plans. |
| P3-09 Named versions/compare | Built | Stored geometry snapshots, compare/restore UI and APIs; `plan-store` tests. |
| P3-10 CAD export | Built DXF; external acceptance pending | DXF serialization/round-trip tests. Open exported plan in her actual CAD software to verify compatibility. |

## Phase 4 — layout and intelligence

| Story | Status | Evidence and remaining acceptance |
| --- | --- | --- |
| P4-01 Reusable layout rules | Built; rule-capture session pending | Rule editor/store for size, clearances, circulation and adjacencies; `layout-store` tests. Actual rule set needs her review. |
| P4-02 Several layout options | Built; practical quality acceptance pending | Deterministic placement/check engine generates options from plan/brief/rules; `layout` tests. Real plan clearance/egress assessment remains a professional check. |
| P4-03 Scores/compare | Built; manual score check pending | Metrics and side-by-side comparison; option/scoring tests. Compare against her calculation. |
| P4-04 Furniture refinement | Built | Canvas item edits/snapping, clearance flags, autosave and versions. |
| P4-05 Chosen option/notes | Built | Chosen option and reasoning persist and feed concept handoff; `layout-store` tests. |
| P4-06 Five provider cards | Built | OpenAI, Anthropic, Gemini, Grok and OpenRouter settings/cards, encrypted keys. |
| P4-07 Key verification | Built; real providers pending | Provider-specific verification and errors; mocked provider tests do not prove current paid-account connectivity. |
| P4-08 Model lists/filters | Built | Scheduled model refresh, model-browser search/filter/sort and available metadata; `model-browser` tests. Provider capabilities/prices depend on current upstream data. |
| P4-09 Orchestrator/workers/fallback | Built | Saved role picks and fallback chain. Fixed rechecking budget after a billed failed call. |
| P4-10 Project-aware chat | Built | Streaming assistant, context, history, plan/brief tools. Fixed saving partial reply on stream failure. |
| P4-11 Chat document filing | Built | Attachment proposals with human-confirmed phase/type placement. |
| P4-12 Tool registry | Partial | Registry dynamically supplies tools for brief/project/documents/plan/layout and now client links/comments. Not every future module or every existing calendar operation is a tool. Publication remains an explicit user action. |
| P4-13 Cheap routing/parallel work | Built | Task model routes, worker tiers and parallel calls; orchestration tests. Fixed waiting for all workers before final accounting on failure. |
| P4-14 Review/retry cap | Built | Review feedback, capped retries and failed-output flags; orchestration tests. Human quality acceptance still needed. |
| P4-15 Task/phase/project costs | Built | Aggregations and UI labels. Failure paths now retain reported billed costs and failed tool records. |
| P4-16 Budget alerts | Built | Threshold alert checks/settings and tests. Budget checks stop new calls but do not reserve spending across simultaneous independent requests; not a guaranteed hard monetary ceiling. Fixed alert deletion scoped to the requested project. |
| P4-17 Model suggestions | Built | Comparison/suggestion inbox with accept/dismiss; `model-suggestions` tests. |

## Phase 5 — delivered in this release

| Story | Status | Implementation and limitations |
| --- | --- | --- |
| P5-01 Explicit private-first sharing | Built for current document types | Documents client-link manager supports uploaded files, structured brief and saved floor plan. Default private; no raw token in link history. Future boards/schedules require their own readers. |
| P5-02 Live links | Built | Latest saved file/brief/plan fetched on refresh; tests verify changed content. |
| P5-03 Frozen links | Built | Copied brief/plan content, frozen private file pointer/version and branding; later edits do not alter the snapshot. |
| P5-04 Expiry/revoke | Built | 256-bit random bearer tokens stored as hashes, expiry/revoke, neutral unavailable reader and API refusal. Every file request rechecks access. |
| P5-05 Neutral client view | Built for current types | Reader outside studio provider/layout; white canvas/light grey, print styles, plan SVG/brief/file view, no platform navigation/name/logo. Boards/schedules do not yet exist. |
| P5-06 Phase/document visibility | Built | Both explicit phase and document visibility required. Hiding either also blocks already-issued live and frozen links. Plan working notes/underlays/reference files/alternatives are excluded. |
| P5-07 Link permissions/threads | Partial | View/comment distinctions, guest threads and studio replies implemented. Edit is supported for live structured briefs only; binary files and plans offer view/comment. Guest names are self-reported, not authenticated identities. |
| P5-08 Link inventory/access | Partial | Active/history list, revoke, open request count and last-opened time. Counters cannot identify who read the link or distinguish refreshes from unique people. |
| P5-09 Restricted teammate invites | Built with fixed roles | Single-use hashed, expiring, verified-email invitations; collaborator role and selected projects. Copy/send invitation manually; no transactional email service or arbitrary custom permission editor. |
| P5-10 User management | Built for application access | Invite, role/platform-role changes, deactivate/reactivate, audit trail and membership UI. Deactivation denies studio/API access even with an existing session; it does not disable the underlying Auth0 identity. Protects own admin access/last active owner in ordinary updates; simultaneous owner changes need stronger transaction serialization before broad rollout. |
| P5-11 Per-user feature switches | Built for shipped features | AI, floor plan, layout and sharing switches enforced in navigation/screens, API handlers and AI tool invocation. Already-issued client links remain controlled by their publication/expiry/revocation settings. |
| P5-12 Customer workspaces | Built | Create practice, invite owner, select authorized workspace and reuse default workflow. Test with actual new owner sign-in before onboarding a customer. |
| P5-13 Practice branding | Built | Optional practice name/HTTPS logo; neutral default. Frozen links preserve branding at creation. |
| P5-14 Isolation tests | Built automated coverage; end-to-end acceptance pending | PGlite tests cover foreign shares/invites/projects/files, token handling, feature invocation and cost isolation. Actual Auth0 + deployed Blob endpoint exercises still need authorized user sessions. |

## Phases 6–9 and deferred analytics

These phases are not implemented end to end. Registry placeholders and tables are scaffolding, not completion.

| Phase/stories | Status and precise next work |
| --- | --- |
| P6-01–03 Concept | Missing: persistent mood boards, model-generated visuals and tagged material palette flowing into item records. Implement the board and tagged-item storage first, then add sharing/tool support. |
| P6-04–06 Documentation | Missing split reference workspace and generated schedules. Partial compliance groundwork: existing essential workflow checklist gates completion, but project-specific regulatory checklist editing and AI flag-list pre-check are absent. |
| P6-07–10 Sourcing | Missing item status board, supplier imports/list/RFQ drafts and project quote totals. AI spend budgets are not procurement budgets. |
| P6-11–12 Delivery | Missing schedule-derived install sequence and item-status/snags report with photos. |
| P6-13–14 Reuse/export | Missing template save/apply and complete project ZIP with all files/versions. Administrative database backup is not a user project export. |
| P7-01–05 Discovery/UX definition | Missing interviews, competitor comparison, real-designer-confirmed UX process, validated second definition and module-gap report. These require evidence from people, not invented responses. |
| P7-06–09 UX modules | Missing generic research/persona forms, frames/connectors, component/token register and build handoff. |
| P7-10–13 Hardening | Partial schema/registry/version foundations exist. Missing full genericity pass, second-workflow reuse measurement and publish/edit journey preserving old versions. |
| P7-14 Second pilot | Missing live UX customer project and written feedback. |
| P8-01–12 No-code editor | Missing workflow list/drafts, phase/step/module/field/handoff editors, configurable AI actions/test runs, preview/publish/rollback/import/export and owner editing authorization journey. Schema validation alone does not deliver these stories. |
| P9-01–13 AI workflow builder | Missing module-driven interview/generation/repair, procedure import, missing-capability backlog, preview-to-editor/publish, evaluations, workspace builder cost caps, edit metrics and staged rollout. Generic AI chat is not this builder. |
| A-01–03 Analytics | Deferred by the document. No heatmaps/session recordings added. Operational cost/error/audit logs and anonymous share-open counters serve current requirements, not analytics rollout. |

## Cross-cutting checks and release boundaries

- **Secrets:** encrypted server-only provider keys remain in place. Public payloads omit storage paths and provider/cost data; share history omits bearer tokens. Recovery still requires the original credential encryption secret.
- **Access:** selected workspace cookies are validated against membership. Role and project checks apply to reads, writes, uploads, file versions, realtime delivery and AI tools. Public routes are limited to token readers/invitations; unknown/revoked/expired tokens do not expose project content.
- **Backups:** daily export plus incremental file copies and restore are tested; provider retention, job execution, independent-account disaster recovery and live drill remain operational acceptance items.
- **Privacy:** stored data includes Auth0 user identity, client/project records, files, AI histories/costs, issue reports, admin audit changes, guest comments/names and anonymous link request counts/timestamps. No heatmap/session recorder added. A documented POPIA assessment, retention policy and designer-facing privacy notice remain outstanding.
- **Large files:** direct private uploads/progress exist; resumable/offline retries and a real 50 MB check remain outstanding.
- **AI safety:** editable drafts/proposals, confirmation before applying, bounded reviews and failed-call cost logging. Layout/compliance outputs are aids requiring professional review.
- **Responsive:** current studio design retained; neutral client reader and settings use existing spacing/buttons/cards and responsive layouts. Real-device testing remains necessary.
- **Verification:** full repository automated tests, lint, production build and browser fixture checks are recorded with this release. PGlite exercises actual migrations and SQL. Local build has no live database/provider credentials; it cannot establish live Auth0/provider or designer acceptance.

The next roadmap implementation is P6-01 persistent concept boards and P6-03 tagged materials/item records, with the approved plan handoff. The plan explicitly calls for each workspace to be used before the next is added. Before treating Phase 5 as accepted, use one actual project to publish live/frozen files, brief and plan; edit/comment within permissions; revoke; invite an assigned collaborator; disable a feature; and restore a backup in a scratch provider environment.
