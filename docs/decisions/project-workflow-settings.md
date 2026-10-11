# Project settings and per-project workflows

Each project has a settings page (`/projects/[id]/settings`) with three tabs:
Details, Phases and steps, and Layout rules (only when the project's workflow
uses the `layout_generator` module, i.e. interior design).

## How a project changes its workflow

A project stays pinned to the published workflow version it started on. Its
own changes are an overlay in `projects.workflow_custom`
(`src/lib/workflow/custom.ts`), and `getWorkflow(project)` returns the
definition with the overlay applied, so every screen, the task list, the
timeline and the AI tools see the project's real phases and steps.

- Default phases and steps can be switched off, renamed, re-ordered and given
  modules. They are never removed.
- Added phases and steps can be edited and removed.
- A phase shows its steps when it has the `checklist` ("Steps") module; a
  phase without it is tool cards only. Steps can link to modules too.
- Phases that are open or complete keep their place and stay on, and nothing
  moves in front of the open phase.

## For the AI layer

Every change is one `WorkflowChange` (zod schema `workflowChange`), applied by
`applyWorkflowChange` in the browser, on the server (`customizeWorkflow`
mutation) and available to AI tools the same way. New ids come from
`newPhaseKey()` / `newStepId()`. `workflowOutline()` lists every phase and step
including switched-off ones. Project details change through the
`updateDetails` mutation; `DELETE /api/projects/[id]` deletes a project (owners only). Collaborators cannot change project settings.
