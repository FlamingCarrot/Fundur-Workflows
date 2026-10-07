# Workflow platform roadmap audit

Audited 7 October 2026 against *Workflow Platform: Vision, First Workflow and Build Plan*, pages 22–47. The attachment is a requirements source; the user's request authorizes implementation and direct deployment to main. Features outside that document are outside this audit.

## Reading the results

**Built** means the application contains a working implementation, backed by the evidence below. It does not mean a designer has completed the document's real-project acceptance exercise. **Partial** identifies a concrete gap. **Deferred** follows an explicit deferral in the document. **Missing** means a placeholder, schema or permission name is not a delivered feature.

The starting revision was `5c7442d3ce261efa83f9c8e33cacc028c9019432`. Phases 1–4 were substantially implemented already. Phase 5 had schema/permission groundwork but no complete client reader or workspace-management journey. The first release completed that core journey and repaired material earlier-phase gaps. The continuation adds the shared board-to-item chain in Phase 6 and corrects sidebar matching for project IDs that share a prefix. It does not declare all five phases accepted: live-user, CAD-format and provider checks remain below.

## Phase 1 — workflow core and first AI win

| Story | Status after this release | Evidence and remaining acceptance |
| --- | --- | --- |
| P1-20 Workspace ownership | Built | Workspace-scoped project/file/plan/cost stores; `workspace-context.ts`; `projects-db`, `files-snapshots`, `workspaces` and `sharing` tests. Added selected workspace validation and assigned-project restrictions. |
| P1-21 Definition schema/validator | Built | `src/lib/workflow/schema.ts`, `validator.ts`, `tests/workflow.test.ts`; invalid references rejected and definitions versioned. |
| P1-22 Interior design v1 | Built | `definitions/interior-design-corporate.json`; project creation initializes its phases/checklists. |
| P1-23 Module-driven phases | Partial | Registry and `PhaseView` assemble module sections and honest placeholders. The structured form is still specialized around the brief; chosen-plan handoff is specialized. Generalize before the second workflow. |
| P1-24 Definition labels everywhere | Partial | Label and form lookups exist; some brief/plan module assumptions remain in UI and tools. A complete second-workflow terminology review is still needed. |
| P1-01 Deploy/database pipeline | Built | GitHub main triggers Vercel; `npm run build` runs migrations; baseline Vercel commit status was successful. Concurrent main revision `cb6bea7` (calendar, saved views, usage and advisor) was integrated before release. Release deployment is verified separately after push. |
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
| P4-12 Tool registry | Partial | Registry dynamically supplies tools for brief/project/documents/plan/layout, client links/comments, boards and item records/specification drafts. Not every future module or every existing calendar operation is a tool. Publication remains an explicit user action. |
| P4-13 Cheap routing/parallel work | Built | Task model routes, worker tiers and parallel calls; orchestration tests. Fixed waiting for all workers before final accounting on failure. |
| P4-14 Review/retry cap | Built | Review feedback, capped retries and failed-output flags; orchestration tests. Human quality acceptance still needed. |
| P4-15 Task/phase/project costs | Built | Aggregations and UI labels. Failure paths now retain reported billed costs and failed tool records. |
| P4-16 Budget alerts | Built | Threshold alert checks/settings and tests. Budget checks stop new calls but do not reserve spending across simultaneous independent requests; not a guaranteed hard monetary ceiling. Fixed alert deletion scoped to the requested project. |
| P4-17 Model suggestions | Built | Comparison/suggestion inbox with accept/dismiss; `model-suggestions` tests. |

## Phase 5 — sharing and practice management

| Story | Status | Implementation and limitations |
| --- | --- | --- |
| P5-01 Explicit private-first sharing | Built for current document types | Documents client-link manager supports uploaded files, structured brief, saved floor plan, concept boards and schedules. Default private; no raw token in link history. |
| P5-02 Live links | Built | Latest saved file/brief/plan/board/schedule fetched on refresh; tests verify changed content. |
| P5-03 Frozen links | Built | Copied brief/plan/board/schedule content, frozen private file pointers/versions and branding; later edits do not alter the snapshot. |
| P5-04 Expiry/revoke | Built | 256-bit random bearer tokens stored as hashes, expiry/revoke, neutral unavailable reader and API refusal. Every file request rechecks access. |
| P5-05 Neutral client view | Built for current types | Reader outside studio provider/layout; white canvas/light grey, print styles, plan SVG, brief, file, board and schedule readers, no platform navigation/name/logo. |
| P5-06 Phase/document visibility | Built | Both explicit phase and document visibility required. Hiding either also blocks already-issued live and frozen links. Plan working notes/underlays/reference files/alternatives are excluded. Board/schedule images require visibility on both their source document and source phase. Shared schedules omit supplier details, prices, private notes and snag photos; frozen attachments retain the original file version and cannot gain newly published images later. |
| P5-07 Link permissions/threads | Partial | View/comment distinctions, guest threads and studio replies implemented. Edit is supported for live structured briefs only; files, plans, boards and schedules offer view/comment. Guest names are self-reported, not authenticated identities. |
| P5-08 Link inventory/access | Partial | Active/history list, revoke, open request count and last-opened time. Counters cannot identify who read the link or distinguish refreshes from unique people. |
| P5-09 Restricted teammate invites | Built with fixed roles | Single-use hashed, expiring, verified-email invitations; collaborator role and selected projects. Copy/send invitation manually; no transactional email service or arbitrary custom permission editor. |
| P5-10 User management | Built for application access | Invite, role/platform-role changes, deactivate/reactivate, audit trail and membership UI. Deactivation denies studio/API access even with an existing session; it does not disable the underlying Auth0 identity. Protects own admin access/last active owner in ordinary updates; simultaneous owner changes need stronger transaction serialization before broad rollout. |
| P5-11 Per-user feature switches | Built for shipped features | AI, floor plan, layout, design (boards/items) and sharing switches enforced in navigation/screens, API handlers and AI tool invocation. Already-issued client links remain controlled by their publication/expiry/revocation settings. |
| P5-12 Customer workspaces | Built | Create practice, invite owner, select authorized workspace and reuse default workflow. Test with actual new owner sign-in before onboarding a customer. |
| P5-13 Practice branding | Built | Optional practice name/HTTPS logo; neutral default. Frozen links preserve branding at creation. |
| P5-14 Isolation tests | Built automated coverage; end-to-end acceptance pending | PGlite tests cover foreign shares/invites/projects/files, token handling, feature invocation and cost isolation. Actual Auth0 + deployed Blob endpoint exercises still need authorized user sessions. |

## Phase 6 — concept through delivery

The implemented stages use one workspace-scoped, revisioned design record per project. Adding a card to the palette creates one item; the schedule, sourcing board and installation list read that same item. Board arrangement, notes, tags and groups survive reloads. Autosave keeps a browser recovery copy and refuses stale writes until the designer chooses a saved version or explicitly replaces it.

| Story | Status | Implementation and remaining acceptance |
| --- | --- | --- |
| P6-01 Mood board | Built; designer acceptance pending | Private project image uploads/references, note cards, drag arrangement, zoom, groups, tags, position controls and persistence. Board live/frozen client readers are available. Test with an actual designer project and file storage. |
| P6-02 AI concept visuals | Missing | Three visual alternatives informed by the approved plan/brief, image-generation provider routing and image costs remain to implement. Text specification drafting is not visual generation. |
| P6-03 Tagged material palette | Built | Idempotent board-to-palette handoff carries tags, image and notes into item specifications. One item is reused throughout the project; no retyping into later registers. |
| P6-04 Plan/concept references | Built; practical acceptance pending | Schedule screen shows the chosen layout and concept board side by side while specifications are edited. Private plan working notes/references are omitted from this preview. Confirm usefulness on the designer's actual screen/device. |
| P6-05 Automatic schedule/specifications | Built; real-provider acceptance pending | Schedule derives directly from selected items. Reviewed AI drafts use saved item facts, record task/phase/project costs and require explicit application/edit/save. Invented measurements/certification are forbidden by the prompt; missing facts are marked for confirmation. Live/frozen client schedules omit procurement and snag information. |
| P6-06 Regulatory checklist/pre-check | Partial groundwork | Essential workflow gates exist. Editable project-specific regulatory checklist and AI flag-list pre-check remain absent. |
| P6-07 Sourcing status board | Built | Needs sourcing, quote requested, ordered and delivered lanes with supplier/status/search filters and editable supplier links/delivery dates. |
| P6-08 Supplier link import | Missing | Links can be stored manually; URL-based extraction, evidence and reviewed field import are not implemented. |
| P6-09 Supplier list/RFQ drafts | Missing | Item-level supplier records exist. Reusable supplier directory, consolidated RFQ drafts and reusable RFQ templates remain absent. |
| P6-10 Quotes versus budget | Built baseline | Selected unit quotes, precise fractional-quantity line totals, unpriced-item count and procurement budget/remaining/overrun. Keep VAT/shipping basis consistent. No multiple-quote comparison history or exchange-rate conversion. |
| P6-11 Installation sequence | Built baseline; professional review required | Every schedule item appears once, ordered by delivery date on request, with manual reordering and installation completion. Dates do not establish site access, assembly dependencies or safety; review those before using the sequence. |
| P6-12 Outstanding work/snags | Built baseline; site acceptance pending | Outstanding filtering, delivery status, item snag notes and private snag photos, installed/cleared flags. Test a real site walk-through and phone photo upload before calling this accepted. |
| P6-13 Reusable templates | Missing | Save/apply project templates remain to implement. |
| P6-14 Full project ZIP | Missing | Complete project export with all files/versions remains to implement; an administrative database backup is not a user project export. |

## Phases 7–9 and deferred analytics

Registry placeholders and tables are scaffolding, not completion.

| Phase/stories | Status and precise next work |
| --- | --- |
| P7-01–05 Discovery/UX definition | Missing interviews, competitor comparison, real-designer-confirmed UX process, validated second definition and module-gap report. These require evidence from people, not invented responses. |
| P7-06–09 UX modules | Missing generic research/persona forms, frames/connectors, component/token register and build handoff. |
| P7-10–13 Hardening | Partial schema/registry/version foundations exist. Missing full genericity pass, second-workflow reuse measurement and publish/edit journey preserving old versions. |
| P7-14 Second pilot | Missing live UX customer project and written feedback. |
| P8-01–12 No-code editor | Missing workflow list/drafts, phase/step/module/field/handoff editors, configurable AI actions/test runs, preview/publish/rollback/import/export and owner editing authorization journey. Schema validation alone does not deliver these stories. |
| P9-01–13 AI workflow builder | Missing module-driven interview/generation/repair, procedure import, missing-capability backlog, preview-to-editor/publish, evaluations, workspace builder cost caps, edit metrics and staged rollout. Generic AI chat is not this builder. |
| A-01–03 Analytics | The document defers these until core use. Concurrent main changes already implement A-01 usage/live views and A-02 first-party click heatmaps plus an advisor; preserved during integration, outside this roadmap implementation. A-03 session recording remains absent. Anonymous share counters serve P5-08. |

## Cross-cutting checks and release boundaries

- **Secrets:** encrypted server-only provider keys remain in place. Public payloads omit storage paths and provider/cost data; share history omits bearer tokens. Recovery still requires the original credential encryption secret.
- **Access:** selected workspace cookies are validated against membership. Role and project checks apply to reads, writes, uploads, file versions, realtime delivery and AI tools. Public routes are limited to token readers/invitations; unknown/revoked/expired tokens do not expose project content.
- **Backups:** daily export plus incremental file copies and restore are tested; provider retention, job execution, independent-account disaster recovery and live drill remain operational acceptance items.
- **Privacy:** stored data includes Auth0 user identity, client/project records, files, board notes/tags, item specifications/supplier quotes/snags, AI histories/costs, issue reports, admin audit changes, guest comments/names and anonymous link request counts/timestamps. The concurrently merged usage tracker records authenticated studio page views/time/scroll, click labels/coordinates, named actions and errors; it excludes typed field values and does not run on client readers. No session recorder added. A documented POPIA assessment, retention policy and designer-facing privacy notice remain outstanding.
- **Large files:** direct private uploads/progress exist; resumable/offline retries and a real 50 MB check remain outstanding.
- **AI safety:** editable drafts/proposals, confirmation before applying, bounded reviews and failed-call cost logging. Layout/compliance outputs are aids requiring professional review.
- **Responsive:** current studio design retained; neutral client reader and settings use existing spacing/buttons/cards and responsive layouts. Real-device testing remains necessary.
- **Verification:** full repository automated tests, lint, production build and browser fixture checks are recorded with this release. PGlite exercises actual migrations and SQL. Local build has no live database/provider credentials; it cannot establish live Auth0/provider or designer acceptance.

The remaining Phase 6 work is visual generation, regulatory pre-checks, supplier imports/RFQs, templates and full project ZIPs. The plan calls for each workspace to be used before the next is added. Use one actual project to arrange a concept board, carry selections into specifications, publish a schedule, track quotes/delivery and photograph snags. Earlier acceptance gaps in the tables remain open.

## Verification record — Phase 5 release

- `npm test`: all 29 test files passed after integrating calendar, saved-view, usage and advisor changes.
- `npm run lint`: passed with no warnings or errors.
- `npm run build`: production compilation, type checking and route generation passed. Local migrations skipped because live credentials are not configured; the tests run the complete migration set in PGlite.
- Additional targeted restore test passed after the usage-event sequence repair.
- Chromium browser fixtures at desktop and 390 px phone width passed for live brief editing, guest comments, view-only restrictions, plan rendering and unavailable-link handling, with no runtime errors or horizontal overflow. Shared reader title is neutral and it has no studio navigation. Fixture browser checks are not authenticated live-service tests.

## Verification record — Phase 6 continuation

- `npm test`: all 206 tests passed across 30 test files, including actual migrations, reviewed specification drafts/costs, tenant isolation, concurrent saves, source-image privacy, frozen attachments and full design-record restore.
- `npm run lint`: passed without warnings or errors.
- `npm run build`: production compilation, type checking and route generation passed. The local build skips live migrations without credentials; PGlite tests execute migration 019 and all earlier migrations.
- Chromium editing checks cover arrangement/reload, immediate palette-to-schedule handoff, exact quote/budget totals, status filters, installation completion, interrupted draft recovery and explicit stale-write resolution. Desktop and 390 px checks cover project-prefix sidebar selection and page overflow.
- Browser fixtures cover neutral frozen boards, client comments, live view-only schedules and withdrawal, without studio navigation or runtime errors. These use test fixtures/local persistence; real Auth0/Blob/provider and designer acceptance remain separate.
