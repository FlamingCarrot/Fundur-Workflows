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
| P3-02 Import/convert geometry | Partial | ASCII DXF import, normalized geometry, and DXF/IFC export fixtures (`plan-dxf`, `plan-ifc` tests). IFC tests cover export, not an IFC importer. No DWG/Revit conversion service; do not advertise universal CAD/BIM import. |
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
| P6-01 Mood board | Built; designer acceptance pending | Private project image uploads/references, note cards, full-viewport pan/pinch/zoom, fit control, groups, tags, position controls and persistence. On phones, the card editor overlays the board and adjusts above the keyboard. Board live/frozen client readers are available. Test with an actual designer project and file storage. |
| P6-02 AI concept visuals | Built baseline; real-provider/designer acceptance pending | One to three stylistic alternatives use confirmed brief fields and a saved floor reference or private project image. Separate OpenRouter image/fallback roles, estimated budget checks, billed/estimated costs, persistent partial history, private documents and explicit board selection are implemented. Geometry fidelity and render quality require designer review; production provider/storage configuration and acceptance remain. |
| P6-03 Tagged material palette | Built | Idempotent board-to-palette handoff carries tags, image and notes into item specifications. One item is reused throughout the project; no retyping into later registers. |
| P6-04 Plan/concept references | Built; practical acceptance pending | Schedule screen shows the chosen layout and concept board side by side while specifications are edited. Private plan working notes/references are omitted from this preview. Confirm usefulness on the designer's actual screen/device. |
| P6-05 Automatic schedule/specifications | Built; real-provider acceptance pending | Schedule derives directly from selected items. Reviewed AI drafts use saved item facts, record task/phase/project costs and require explicit application/edit/save. Invented measurements/certification are forbidden by the prompt; missing facts are marked for confirmation. Live/frozen client schedules omit procurement and snag information. |
| P6-06 Regulatory checklist/pre-check | Built; professional/real-provider acceptance pending | Designer-defined fire/egress/accessibility requirements and evidence notes feed phase essentials/tasks. Atomic completion checks refuse open or concurrently added requirements; changed requirements clear verification and stale ticks are refused. Reviewed/costed AI flags are explicit unchecked additions, never sign-off. |
| P6-07 Sourcing status board | Built | Needs sourcing, quote requested, ordered and delivered lanes with supplier/status/search filters and editable supplier links/delivery dates. |
| P6-08 Supplier link import | Built for structured product pages; supplier acceptance pending | HTTPS page reader extracts JSON-LD product facts and metadata with source evidence. Designers choose variant/fields, retain manual corrections and save normally. Missing units, currency differences and ambiguous prices stay explicit. Sites requiring JavaScript/login or blocking reading use manual entry. Test the five usual suppliers before calling supplier coverage accepted. |
| P6-09 Supplier list/RFQ drafts | Built; designer acceptance pending | Practice contacts and reusable quotation templates, selected-item requests with editable captured facts, scoped recovery, copy/text download and externally-sent request recording. No email sending integration. |
| P6-10 Quotes versus budget | Built baseline | Selected unit quotes, precise fractional-quantity line totals, unpriced-item count and procurement budget/remaining/overrun. Keep VAT/shipping basis consistent. No multiple-quote comparison history or exchange-rate conversion. |
| P6-11 Installation sequence | Built baseline; professional review required | Every schedule item appears once, ordered by delivery date on request, with manual reordering and installation completion. Dates do not establish site access, assembly dependencies or safety; review those before using the sequence. |
| P6-12 Outstanding work/snags | Built baseline; site acceptance pending | Outstanding filtering, delivery status, item snag notes and private snag photos, installed/cleared flags. Test a real site walk-through and phone photo upload before calling this accepted. |
| P6-13 Reusable templates | Built for schedules/checklists; designer acceptance pending | Practice setups capture chosen schedule facts and requirement titles, then seed a new project atomically with fresh IDs and unchecked requirements. Full-project geometry/file duplication and workflow editing remain separate. |
| P6-14 Full project ZIP | Built; large/live-file acceptance pending | Documents links to a streamed private archive of scoped project data and every stored document version. A final manifest identifies unuploaded/missing bytes. Limits: 2 GB and 2,000 document versions; external restore/import remains separate. |

## Phases 7–9 and deferred analytics

Registry placeholders and tables are scaffolding, not completion.

| Phase/stories | Status and precise next work |
| --- | --- |
| P7-01–05 Discovery/UX definition | Missing interviews, competitor comparison, real-designer-confirmed UX process, validated second definition and module-gap report. These require evidence from people, not invented responses. |
| P7-06–09 UX modules | Generic text forms and phase notes now run from practice workflow definitions. Dedicated frames/connectors, component/token register and build handoff remain missing. |
| P7-10–13 Hardening | Partial schema/registry/version foundations exist. Missing full genericity pass, second-workflow reuse measurement and publish/edit journey preserving old versions. |
| P7-14 Second pilot | Missing live UX customer project and written feedback. |
| P8-01–12 No-code editor | Built baseline; remaining controls/acceptance | Workspace-owner practice drafts, phase/module/step/form-field/handoff editing, validation/preview, immutable publishing, restoration to a new draft, JSON import/export and custom project selection are implemented. Existing projects embed their frozen definition. Module-specific setting controls, configurable AI execution/test runs, feature-availability previews and real owner acceptance remain. |
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

Phase 6 now has an implementation for each listed feature. Visual quality, supplier coverage and the practical acceptance checks above remain open; this is not a claim of complete designer acceptance. The plan calls for each workspace to be used before the next is added. Use one actual project to arrange a concept board, carry selections into specifications, publish a schedule, track quotes/delivery and photograph snags. Earlier acceptance gaps in the tables remain open.

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

## Mobile and viewport continuation

- The concept workbench fills the viewport, defaults to fitting the board, and uses pan/pinch/wheel zoom instead of page or canvas scrollbars. Property fields scroll independently. A board AI button opens the project assistant.
- Unsent assistant text and pasted meeting notes recover from account/workspace/project-scoped browser drafts. These are plaintext local recovery copies; attached unsent files are not recovered after closing the drawer.
- Touch keyboards insert a newline in chat; the explicit Send action submits. Composer and approval controls fit the visual viewport above a keyboard, use 44 px touch actions and 16 px field text. This is tested in Chromium with touch and an emulated smaller visual viewport, not yet on real iOS/Android devices.
- Failed AI sends restore text for retry. Approval network errors release the busy state without applying a change. Brief review waits for saving before navigation. A brief save already running cannot be treated as completed; failed brief batches stay in order for explicit retry instead of being silently lost.
- Targeted `sync`, `brief-drafting` and `design` tests pass; lint and production build pass. Browser fixtures exercise mobile chat approval/retry, recovery, keyboard sizing, immediate brief navigation and selected-field AI approval. The previous full-suite result remains the Phase 6 baseline; no live-provider acceptance is claimed.

## Additional user request — interior design engine

This extends the attached document's 2D editor requirements. It is an incremental engine build, not CAD/Revit feature parity or completion of the full user request.

| Capability | Current status |
| --- | --- |
| Linked 2D/3D building view | Built first milestone: saved wall thickness/heights, door/window voids, columns, room surfaces and schematic furniture; multiple floors, isolation/separation, cut-wall view and perspective/top/front/right cameras. |
| Mobile viewport and selection | Built browser-tested foundation: full-height viewport, touch orbit/pan/pinch, Fit, tap-to-select and an overlaid inspector. Real-device/performance acceptance remains. |
| Editable objects and replacement | Built through the existing property editor: edits update both views, use autosave/recovery/undo/redo/versions, and furniture-type replacement keeps its identity, position, rotation, label and footprint. Default-size reset is explicit. Drawing and drag placement remain in 2D. |
| Layers and reusable groups | Object tree/category visibility select current-floor geometry; furniture supports colours, hide/show, multi-selection, marquee selection, grouping and a practice arrangement library. Arbitrary-geometry grouping, per-object locks/reordering and colours/labels across all geometry remain missing. |
| Real catalog and visuals | The default dimensioned library has schematic 3D shapes. Manufacturer assets, searchable product catalog, materials and AI conceptual rendering remain missing. |
| AI viewport controls | Assistant entry point and saved-plan reading/project/layout tools exist. Full geometry editing, camera controls and render-to-editable-design tools remain missing. |
| CAD/BIM exchange and documents | DXF import/export and whole-building IFC export exist. Native DWG/Revit and IFC import, PDF drawing sheets, Word/spreadsheet generation remain to implement. |
| Customer onboarding/workflows/billing | Workspaces, invitations and the interior-design workflow exist. No-code customer workflow editing, self-service paid subscriptions and validated designer onboarding remain missing (Phases 8–9 cover workflow editing/building). |
| Mobile notifications and audio | In-app tasks/alerts and typed-note/chat recovery exist. External push/email notification delivery and audio recording/transcription remain missing. |

Geometry tests cover opening void areas, sill/head clipping, floor elevations, CAD orientation, layer/floor display isolation, non-mutation and furniture replacement. The scoped geometry, element, scene, DXF and IFC tests pass (36 tests). Large drawing bounds are computed without spreading every coordinate into a single call; a 180,000-point reference fixture verifies that this does not hit the JavaScript argument limit. Chromium checks cover actual WebGL rendering, object picking/replacement persistence, linked 2D/3D edits, undo/redo/delete, floor separation/isolation, orbit, layers, 390 px viewport layout, real two-touch pinch, the mobile inspector and WebGL fallback. These checks use demo fixtures and software WebGL; they do not establish live-user or Revit compatibility acceptance.

## Furniture organisation and reusable arrangements — 8 October 2026

The editor now has a searchable object tree for furniture, walls, openings, columns, rooms, notes and dimensions on the current floor. Category visibility retains the existing remembered layer switches. Furniture has saved colour coding, individual working-view visibility and group identity/name fields. A group member selects the group; selecting checkboxes or using the visible Multi-select mode can refine the selection. Ctrl/Command-drag adds furniture whose centres lie in the marquee; Shift-click adds/removes members.

Furniture selections move, turn around their shared centre, copy, delete, group and ungroup as one history entry. Typed X/Y movement provides the same operation on phones. Copies receive new item/group identities, and placement from the library creates an independent arrangement on the selected floor. A single-item copy detaches from the original group. Edits continue through plan revisions, recovery drafts and named versions; chosen-layout handoff retains the furniture fields.

The practice library stores up to 200 named arrangements with up to 500 furniture members each in a workspace-scoped table (migration 020), included in backup/restore. Only owners/members with the floor-plan feature and project editing permission may access it; restricted collaborators cannot read a workspace-wide library. Saved records whitelist type, relative position, dimensions, rotation, optional label and colour. Project/item ids and hidden flags are omitted. Demo libraries are isolated by account/workspace browser key. Group names/ids and working visibility flags are omitted from public plan payloads; hiding furniture in the editor does **not** withdraw it from a client plan. Publication/revocation still controls client access.

Grouping and multi-selection currently apply to furniture. Connected wall/room/opening transforms, arbitrary-geometry reusable assemblies, object locks, custom layer ordering and structural/material product models remain further work. The new library is an asset arrangement library, not the Phase 6 full-project template system.

The 34 scoped tests across group operations, scene geometry, plan elements/store, layout store and backup/restore pass, including actual migration 020, practice isolation and restoration. Another 20 sharing/design tests pass. Lint and the production build pass. Chromium checks cover grouped dragging/undo, colours, library reuse in another project, marquee selection, batch deletion/undo, visibility in both views, and 390 px touch selection/grouping/typed movement without page overflow. The linked 3D and mobile viewport browser checks also pass. Local fixtures and software WebGL do not establish real-device or authenticated live acceptance.

## Precise wall/window spacing — 8 October 2026

The editor adds endpoint alignment, equal-clear-gap wall dragging and valid centred/flush/equal-slot opening snapping. Nearby distances are live while drawing, placing and dragging, and selected distance labels open the matching editable field on desktop and phones. Wall measurements are face-to-face; opening measurements are edge-to-end/edge-to-neighbour along the host wall, including angled geometry. Edits reject overlapping openings, crossing another parallel wall and lost references, retain connected geometry and support decimal millimetres. They do not establish persistent constraints or arbitrary-object distance editing.

Eight spacing tests cover unequal wall thicknesses, reversed/angled geometry, joined edits, refusal paths, snapping and schema persistence. The affected geometry/elements/groups/scene/layout test files pass; lint and production build pass. Chromium exercises exact distance fields, guide-to-field focus, undo/redo/reload, overlap refusal, equal-gap dragging, placement preview/save agreement, endpoint alignment and 390 px touch editing without page overflow. Real device and authenticated live acceptance remain separate.

## Project regulation checklist — 8 October 2026

Technical Documentation now links to a project-specific checklist, also reachable from the finishes schedule. Designers can add, edit and remove requirements, record evidence notes, filter open/checked work and review on phones. The starter fire-egress/accessibility entries are prompts to establish the applicable requirements, not prescribed regulations. At least one requirement remains. Requirements join essential phase steps and project tasks, including due dates and document outputs. Changing a requirement/evidence clears its tick; verification includes the displayed requirement so a stale tab cannot check a changed one. Completed checklists remain historical and immutable.

Migration 021 stores workspace-scoped project requirements and retains the requirements/checks in phase-completion snapshots. The completion statement reads every saved requirement in the same update, preventing a concurrently added unticked requirement from bypassing the gate. The completion screen waits for the actual server result before reporting success. Backup restoration retains both project metadata and the phase snapshot. Private regulation notes are excluded from existing client readers.

The AI pre-check uses bounded saved brief/checklist/schedule/geometry facts, with explicit missing-evidence limits; private supplier prices, snags, drawing notes and image URLs are omitted. It uses registered worker/review routing, budgets and project/phase/task costs. It returns strictly validated flag text and optional failed-review feedback. The designer selects flags to add as unchecked requirements; no AI tool verifies regulation checks or certifies compliance. Unsent manual requirement edits recover from a best-effort account/workspace/project-scoped browser copy; saving/cancelling clears that copy. AI flag drafts themselves are temporary until explicitly added.

Seven regulation tests cover real migration, scoped edits, stale verification, completion races/snapshots, model review/costs/features and backup restoration. Eight sync tests include waiting for a refused completion response; seven task tests pass. Affected project, design, sharing, workflow, studio, AI orchestration and file-snapshot test files pass. Lint and production build pass. Chromium checks exercise custom requirements/evidence, verification reset, recovery after reload, filters, phase gating/completion and 390 px editing/review without horizontal overflow. Provider tests use simulated responses; authenticated live model use, designer/regulatory acceptance and real-phone keyboards remain unverified.

## Supplier directory and quote requests — 8 October 2026

Sourcing links to a mobile quotation workspace. Practice owners/members manage reusable supplier contacts and named templates; restricted collaborators can prepare assigned-project requests with manual contact details without accessing the practice directory. Migration 022 and the administrative backup retain the scoped library. Template expansion uses known placeholders once and requires an item list; source facts cannot trigger extra substitutions.

Drafts capture 1–50 selected items with exact quantities, dimensions, specifications and optional product links. Missing facts remain explicit. They omit quote prices, budget, tags, installation notes and snag references; specifications are never silently shortened. Designers review/edit supplier, recipient, subject and body before saving. Project requests use the existing revision/conflict protection; unfinished reviews recover from an account/workspace/project-scoped browser copy. Saved request text remains unchanged when selections, contacts or templates change. Copy and plain-text download support external email apps; recording external sending moves only items still needing sourcing to quote-requested. Ordered/delivered items stay intact. Recorded requests are read-only in the interface; removing a record does not reverse item statuses. No external message is sent by this implementation.

The registered assistant tool can draft text from saved project selections, without saving or sending it; it respects the design feature gate and refuses foreign/missing item IDs. Existing client schedule readers exclude request bodies/contact emails. Limits are 20 saved requests per project, 50 reusable templates and 500 practice suppliers.

Four sourcing tests cover exact facts/missing facts/privacy, bounded requests, literal placeholder handling, idempotent status transitions, account/workspace demo isolation, real migrations, server scope isolation, stale revisions, assistant reads and backup/restore. Affected design, sharing, workflow and studio test files pass, as do lint and the production build. Chromium checks cover practice supplier/template creation and reuse across projects, review/recovery/save/edit/reload, copy/download, recording without delivered-item regression, and 390 px touch editing with 16 px fields, no horizontal overflow or runtime errors. Authenticated live and real-device/designer acceptance remain separate.

## Private project archive — 8 October 2026

Documents links to a focused export page. Owners/members can download a ZIP of saved project/workflow data, document metadata and original version bytes, brief/checklists, regulation evidence, tasks, boards, items/quotation requests, floor plans with named versions/corrections, phase snapshots and project AI conversation/proposal records. The server checks project-export permission and assigned-project access. One workspace/project-scoped database statement captures metadata consistently; immutable storage paths are validated against the actual project ID. Other projects, workspace contacts, provider credentials and share-link tokens are excluded.

The archive streams uncompressed ZIP32 entries, preserving uploaded binary bytes and UTF-8 names without buffering whole files. Unique document-ID/version paths prevent filename collisions; unsafe filename characters are normalized while original names remain in metadata. Cancellation closes the upstream file stream, and CRC/data-size checks reject truncated downloads. The final manifest marks included, never-uploaded and missing-storage versions; it calls the archive complete only when every version is included. Network/read failures interrupt the download rather than producing a success manifest. Limits are 2 GB (including data/ZIP overhead) and 2,000 document versions, with a 300-second server function budget; large real storage downloads still need production acceptance.

The demo produces a clearly labelled browser-data archive, including saved design and local plan/history; it cannot include server file bytes/history or conversation records. This portable archive is not an automatic restore package or a public client handover.

Three export tests independently decode streamed ZIPs with JSZip and verified CRCs, cover Unicode/binary/empty files, unsafe/duplicate paths, truncated data, size limits, cancellation, explicit missing-file states, and real database scope isolation. Database fixtures include original, revised and restored document versions, plan history and quotation data; every stored version has the expected exact bytes. Lint and production build pass. Chromium checks Documents navigation and real downloaded ZIP contents on desktop and at 390 px touch width, without runtime errors or horizontal overflow. Authenticated live storage and large-file acceptance remain separate.

## Reusable project setups — 8 October 2026

Documents links to a practice setup editor. Owners/members with design tools enabled can save up to 200 chosen schedule selections and the project’s requirement titles/categories as a named reusable setup. Selected specifications/tags and requirement titles are visible for review before saving; client-specific text inside those reusable facts must be reviewed by the designer. Source pricing, suppliers, document/snags references, board links, installation notes, due dates, evidence, completions and checked states are excluded. Practice libraries are workspace-scoped and retained by migration 023/backup restoration; restricted collaborators cannot read them. Libraries hold up to 100 setups.

The new-project workflow step offers matching practice setups, showing item/requirement counts without loading all specifications over the network. Choosing one uses its pinned workflow version and creates fresh schedule IDs and unchecked requirement IDs, with blank evidence and the first phase open. Client identity and start date are newly entered. Server project/design seeding occurs in one database statement; a refused seed leaves no empty project. Missing/foreign/deleted setups are rejected before creation. Removing a setup leaves projects created from it intact. The demo scopes setup records by account/workspace and seeds the same browser-persisted schedule/reset states.

This delivers the schedule/checklist variant of P6-13, rather than copying a whole building, project files or confidential client brief. Full workflow customization is still Phase 8 work. The assistant can read scoped setup names/workflow versions/counts without source specifications, gated by the design feature.

Three setup tests cover reusable-field whitelists, reset states and fresh IDs, demo scope/reload, migration and workspace isolation, atomic creation/forced rollback, slug collisions, deletion, pinned versions, assistant summaries/features and backup restoration. The eight affected project/files/export/design/sourcing/sync/studio/regulation test files pass, along with lint and production build. Chromium checks save/reload, new-project setup selection, exact schedule reuse and client/status reset, removing a setup without altering an existing project, and 390 px phone capture/project creation without horizontal overflow or runtime errors. Authenticated live and designer/real-device acceptance remain separate.

## Supplier import continuation — 8 October 2026

Supplier-page reading uses a bounded HTTPS reader with checked/pinned public addresses and redirect validation. It does not execute supplier JavaScript. JSON-LD Product/Offer facts and general metadata are offered with source URL, retrieval time, selector and excerpt. Multiple variants require selection; unit prices require an exact decimal in the project currency. No quotation, conversion or missing measurement is invented. The assistant has the same read-only extraction tool.

The selection editor imports only explicitly checked fields and preserves quantity, procurement state and private notes. Manual corrections remove outdated field evidence on save. Evidence persists with optimistic project revisions and is omitted from reusable setups and quotation text. The sourcing phase links to this editor; blocked sites leave manual entry available.

Validation: five supplier import tests pass, including actual migrations/PGlite persistence and unsafe-address/redirect checks. Existing design, sourcing, project-template and sharing tests, lint and production build pass. A 390 px Chromium fixture using the actual ItemForm verifies field selection, exact price replacement, private-data preservation, evidence invalidation and no horizontal overflow. Live authenticated supplier reading and the document’s five usual supplier sites remain unverified.

## Concept visuals continuation — 8 October 2026

The Concept visuals screen creates one to three interior directions, using confirmed saved brief fields and either a rasterized floor plan or a chosen private project PNG/JPEG/WebP. Plan rasterization excludes private working notes, underlays, reference linework and unchosen layouts. Results are conceptual interpretations, not geometrically reliable construction drawings. Each image is reviewed by the designer before adding it to a board; no automated image quality/compliance review is claimed.

Administrators configure separate OpenRouter image and fallback roles, validated for image input/output, plus a per-image US$ estimate. The existing encrypted provider key, FX rate, project AI ledger and pause/alert controls are reused. Budget checks use the estimate before each attempt; actual reported charges may exceed it. When billing is absent the recorded cost is explicitly estimated. Paid failed attempts remain in request/project totals. Token-price model replacement suggestions do not recommend image substitutions.

One request may run per project. Repeated request IDs do not regenerate; partial alternatives persist if a provider, budget or runtime interrupts later images. Interrupted requests expire after ten minutes with an explanation; there is no background/offline job runner. Bounded inline image responses are decoded and normalized to private PNG documents; arbitrary provider URLs and SVG image responses are not fetched. Generated documents start private, can be deliberately added to boards and follow the existing client-sharing/version/export rules. History and source snapshots are included in backup and project ZIP data.

Validation: four concept tests cover image protocol/normalization, plan-reference privacy, three alternatives, fallback and failed costs, partial recovery, tenant isolation, concurrent request prevention, idempotency, budget checks and backup/ZIP inclusion. Nine admin/provider tests and the affected orchestration, model-suggestion and project-export regressions pass. Lint and production build pass. A 390 px Chromium fixture exercises real concept components with mocked authenticated APIs, selecting a floor, three alternatives, private board addition, reload and direction recovery without horizontal overflow or runtime errors. Live paid image generation is unverified because this execution environment has no production provider/session/storage credentials.

## Practice workflow editor continuation — 8 October 2026

Workspace owners can copy or import a process, edit phase order/name/keys, choose implemented modules, edit essential checklist steps and due days, define project forms/fields and describe phase handoffs. Preview and JSON export expose the resulting definition. Explicit saves use revision checks; publish creates an immutable edition. Restoration copies an older edition into the current draft for review and publication as a new version. Browser drafts are scoped by account/workspace/workflow; older recovery copies require explicit selection.

New projects offer the practice’s published workflows and embed the selected definition. Later publication cannot alter their existing phase order, labels, checklist IDs or fields. Practice selection templates resolve the original published version. Generic project forms and phase notes save named field patches, preserve edits during a save and recover unsaved browser text. Form values are included in phase completion snapshots, project ZIPs and backups, and are not added to public client readers. The assistant can read forms and propose changes requiring confirmation.

Workflow editing/publishing permissions apply to workspace owners; they do not grant platform-admin model/credential permissions. Scoped SQL, unavailable-module validation and revision checks protect cross-workspace access and stale edits. This is a baseline editor: form fields are text areas, handoffs describe transfers, and module-specific settings plus configurable AI executions/test runs are not delivered yet.

Validation: the full regression suite passes across all 40 test files. Workflow publication/frozen-project/form/template/backup/export tests use the actual migration set. The affected permissions, workflow, project-template and project-export tests pass, and all ten project persistence tests pass. Lint and production build pass. A 390 px Chromium fixture using real editor, project-picker and form components verifies phase/form/module edits, preview, publication, project creation on the chosen version, recovery after reload and saving without runtime errors or horizontal overflow. Signed-in production-owner acceptance remains separate.
