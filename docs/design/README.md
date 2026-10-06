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
| Find or share a file | Documents | `/projects/[id]/documents` | Upload; switch client visibility per file |
| Ask for help in context | Assistant drawer (any screen) | `Ask Fundur` button | Send |
| Flag a problem | Report an issue sheet (any screen) | Sidebar or mobile header | Send report |

Focused tasks (new project, brief, drafting, completing a phase) open in a full-screen frame with no navigation, a single exit and a sticky footer action. Browsing screens (Today, Projects, Project, Phase, Documents) live in the app shell: a sidebar on desktop and a floating tab bar on phones.

## Rules the screens follow

- Phases, steps, labels, handoffs and AI actions all come from the workflow definition. No interior design words are hard-coded in screens; the brief's name, for example, is the workflow's `brief` label.
- AI output is never applied silently. The draft flow asks which fields to take, drafted fields stay tinted with an "AI draft" tag until edited or confirmed, and every AI action shows its cost.
- Each project carries a material swatch (clay, sage, oak, slate, blush, ochre) so it is recognisable everywhere it appears.
- Waiting-on is a one-tap toggle wherever a project's status shows, and syncs live to collaborators.

## Design system

All tokens and components are in `src/app/globals.css`.

- **Type:** Instrument Serif for headlines and moments that matter; Geist for interface text.
- **Colour:** a warm paper canvas, ink text and one clay accent reserved for the primary action. Light and dark themes follow the system setting.
- **Shape and motion:** soft 14 to 28 px radii, layered low shadows, short eased transitions, a spring on confirmations. Motion is disabled under `prefers-reduced-motion`.

## Data in this build

Project data is demo data in the browser (`src/lib/studio/seed.ts`, kept in local storage) and the AI draft and assistant replies are simulated. These are placeholders for the Neon tables and the AI layer in the build plan; the screens read and write through `StudioProvider`, so swapping in the real API changes one place.

## Screens

Screenshots of every screen are in [`screens/`](./screens).
