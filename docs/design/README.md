# Fundur UX: journeys and screens

The app is organised around what the designer needs to get done, not around the modules it is built from. Each screen has one job and one primary action; everything else is quiet or one tap away.

## Journeys

| The designer wants to… | Screen | Route | Primary action |
| --- | --- | --- | --- |
| Know what needs them today | Today | `/` | Continue the single most urgent step |
| See every job at a glance | Projects | `/projects` | Open a project (filter active, on hold, complete) |
| Start a new job | New project, five one-question steps | `/projects/new` | Continue, then Create project |
| Understand where a job stands | Project | `/projects/[id]` | Open the current phase |
| Work a phase | Phase | `/projects/[id]/phases/[phase]` | Tick steps; Complete phase unlocks when essentials are done |
| Write the brief | Brief (full-screen, autosaves) | `/projects/[id]/brief` | Done |
| Turn meeting notes into a brief | Draft from notes: add, drafting, review | `/projects/[id]/brief/draft` | Add the picked fields to the brief |
| Close a phase and move on | Complete phase, then celebration | `/projects/[id]/phases/[phase]/complete` | Complete and open the next phase |
| Find or share a file | Documents | `/projects/[id]/documents` | Upload; explicitly publish a live or frozen client link |
| Arrange the concept direction | Full-viewport concept workbench | `/projects/[id]/boards/[key]` | Add images/notes, arrange and tag them, add a selection to the palette |
| Specify concept selections | Palette and schedule | `/projects/[id]/items/palette`, `/projects/[id]/items/schedule` | Edit the same selection; review an AI specification draft before saving |
| Track suppliers and quotes | Sourcing register | `/projects/[id]/items/register` | Update sourcing status, filter suppliers and compare selected quotes with budget |
| Run installation and capture snags | Outstanding items | `/projects/[id]/items/outstanding` | Review delivery order, add private notes/photos and clear completed work |
| Ask for help in context | Assistant drawer (any screen) | `Ask Fundur` button | Send |
| Manage client access | Client links within Documents | `/projects/[id]/documents` | Publish, review comments or revoke |
| Manage a practice and teammates | Workspace settings | `/settings/workspace` | Update branding, invite, assign access and set feature switches |
| Read a shared document | Neutral client reader | `/share/[token]` | Read; comment or edit only when permitted |
| Flag a problem | Report an issue sheet (any screen) | Sidebar or mobile header | Send report |

Focused tasks (new project, brief, drafting, completing a phase, boards and item registers) open in a full-screen frame with no navigation, a single exit and a sticky footer action. Browsing screens (Today, Projects, Project, Phase, Documents) live in the app shell: a sidebar on desktop and a floating tab bar on phones.

## Rules the screens follow

- Phases, steps, forms, labels, handoffs and AI actions all come from the workflow definition, which is validated against the module library when it loads. The brief's name is the workflow's `brief` label and its fields are the workflow's `brief` form. Some brief and chosen-plan rendering still needs generalisation before a second workflow (see the roadmap audit).
- AI output is never applied silently. The draft flow asks which fields to take, drafted fields stay tinted with an "AI draft" tag until edited or confirmed, and every AI action shows its cost.
- Each project carries a material swatch (clay, sage, oak, slate, blush, ochre) so it is recognisable everywhere it appears.
- Waiting-on is a one-tap toggle wherever a project's status shows, and syncs live to collaborators.

## Design system

All tokens and components are in `src/app/globals.css`. The look is called **Studio moodboard**: the app should feel like a designer's pinboard, bold and tactile, with the work itself (each project's material colour) carrying the colour.

- **Type:** Bricolage Grotesque for headlines and section titles, set heavy and tight with optical sizing; DM Sans for interface text. The second line of a headline gets a lime highlighter stroke instead of a different face.
- **Colour:** a soft stone canvas with white cards pinned on it, ink text and one electric lime reserved for the action that moves work forward. A deeper olive partner (`--accent`) carries lime meaning in text and icons. Light and dark themes follow the system setting.
- **Material:** the screen's one key card (`.hero`) is tinted in the project's swatch with a large material chip in its corner; project cards open with a woven `.sample` of the swatch; colour picks are round paint chips.
- **Shape and motion:** generous 8 to 32 px radii, pill buttons and tags, a floating navigation tray on desktop, a dark floating dock on phones and a floating action dock in focused tasks. Springy, slightly playful transitions, all disabled under `prefers-reduced-motion`.

## Data in this build

Configured deployments use Auth0 sessions, workspace-scoped Neon records, private Vercel Blob files and server-side model providers. `StudioProvider` coordinates API writes and live updates. Without authentication/database configuration, local development retains the browser demo seed; that mode must only contain demo data.

Client readers sit outside the authenticated studio layout. They have a light grey background, white document canvas, print styles and no platform navigation or branding. Optional practice branding comes from workspace settings. File downloads recheck the share token instead of exposing a permanent storage URL.

A client-visible switch makes a document eligible for sharing; publication also requires its phase to be client-visible and an explicit link creation. Links record anonymous request counts and last-opened time, and comments record a self-reported guest name. They do not authenticate a guest identity. Concurrent main changes include authenticated studio usage events and heatmaps; that tracker stays inside the studio layout and excludes the client reader. No session recordings are included.

## Screens

Screenshots of every screen are in [`screens/`](./screens).

## Design records and client publication

Concept cards become palette selections only when the designer adds them. The palette, schedule, sourcing board and installation list use the same records. Board notes and item edits autosave after review; internal links finish pending saves before changing screens. Browser recovery copies are scoped by account, workspace and project. A stale save presents an explicit saved-version/draft choice.

Client board links include card notes and tags. Schedule links include only selection names, images, categories, tags, dimensions, quantity and specifications. Supplier details, prices, private installation notes and snag photos are excluded. An image appears only when its source document and source phase are explicitly client-visible; publishing a board does not publish a private image. Frozen links preserve content and eligible image versions, while hiding a source file/phase or revoking a link withdraws access.

## Mobile work

The board has no page/canvas scrollbars: it fits the viewport and supports pan/pinch/zoom. Card properties open as an overlay on phones. Chat keeps unsent text, meeting-note drafting keeps pasted notes, and both recovery keys include the signed-in account, workspace and project. Approved brief fields wait for saving before the screen changes. These browser drafts do not recover unsent attachments or replace server backups. Phone chat uses Enter for a newline and a visible Send control; the composer follows the keyboard's visual viewport.
