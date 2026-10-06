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

- Phases, steps, forms, labels, handoffs and AI actions all come from the workflow definition, which is validated against the module library when it loads. No interior design words are hard-coded in screens: the brief's name is the workflow's `brief` label and its fields are the workflow's `brief` form.
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

Project data is demo data in the browser (`src/lib/studio/seed.ts`, kept in local storage) and the AI draft and assistant replies are simulated. These are placeholders for the Neon tables and the AI layer in the build plan; the screens read and write through `StudioProvider`, so swapping in the real API changes one place.

## Screens

Screenshots of every screen are in [`screens/`](./screens).
