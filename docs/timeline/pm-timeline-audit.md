# Timeline: how the big project tools do it, and what Fundur builds

October 2026. Andre asked for the timeline to become a real planning tool, rich
in what a freelancer needs but minimal to look at. This note compares how the
established tools handle timelines and ranks what Fundur should build.

## What the established tools do

| Tool | Timeline strengths worth copying | What gets in the way |
| --- | --- | --- |
| **Microsoft Project** | Summary rows that roll up their tasks; four dependency types with lag; auto-scheduling; critical path; baselines with slip; working calendars | Dense, form-heavy, built for a full-time scheduler |
| **Asana (Timeline / Gantt)** | Drag to move, drag edges to change length; dependency arrows; "shift dependents" on move; milestones as diamonds; unscheduled tasks tray | Dependencies only push forward; baseline only on paid tiers |
| **Monday.com (Gantt)** | Group rows that collapse; baseline as ghost bars; critical path toggle; colour by status | Board-first: the Gantt is a widget on top of a table |
| **ClickUp (Gantt)** | Zoom from day to year; "reschedule dependencies" toggle; progress fill on bars; critical path and slack; export | Many settings per view, easy to get lost |
| **TeamGantt** | Very clear phase → task hierarchy; drag to link; percent complete; baselines; workload under the chart; print-ready | Rows can get heavy with many columns |
| **Smartsheet / Wrike** | Grid beside the chart; predecessors column; critical path; baselines; snapshots | Spreadsheet feel; more for teams than one person |
| **GanttPRO** | Templates; workload by hours; estimates on tasks; export to PDF, PNG, CSV | Visual clutter when everything is on |
| **Linear (roadmaps) / Notion (timeline)** | Quiet visuals; keyboard first; zoom presets; a "today" jump; drag to schedule from a list | Little or no dependency logic |
| **Toggl Plan / Float** | Capacity per day against working hours, overload shown in red | Resource planning, not task logic |

## The features that recur, and why a freelancer needs them

1. **Hierarchy that collapses**: project → phase → task, so a portfolio of
   projects and the detail of one sit on one chart.
2. **Zoom and a today jump**: week, month, quarter; jump back to today.
3. **Move and resize by dragging**: whole days, with the keyboard too.
4. **Dependencies that push later work**: "this waits on that"; when the
   earlier one slips, the later ones move with it.
5. **Milestones**: a site handover or client sign-off is a day, not a span.
6. **Progress on bars**: how much of each phase is ticked off.
7. **Overdue and conflict flags**: late work and broken dependencies stand out.
8. **Critical path**: the chain that decides the end date.
9. **Baselines**: save the agreed plan, then see what slipped and by how much.
10. **Unscheduled work**: tasks with no date, one click to put them on the chart.
11. **Quick add**: add a task straight onto a phase.
12. **Undo**: every drag can be taken back.
13. **Workload**: hours of planned work per day or week against capacity, so a
    freelancer sees an overloaded week before saying yes to more work.
14. **Shift a whole project**: the client delayed the start by two weeks.
15. **Filters**: by project, by client, hide what is done; remembered.
16. **Export and print**: CSV for a spreadsheet, a printable chart for a client.
17. **Working days**: no work scheduled on weekends or days off.

## What Fundur builds, ranked

Ranked by how much each changes what a freelancer can plan, then by cost.

| # | Feature | Status |
| --- | --- | --- |
| 1 | Project → phase → task rows that collapse, all on one chart | Built |
| 2 | Week / Month / Quarter zoom, Today jump, weekends shaded, remembered | Built |
| 3 | Drag tasks to move, drag edges to change start or due day; arrow keys | Built |
| 4 | "Waits on" links between tasks; moving one pushes the tasks waiting on it; arrows drawn | Built |
| 5 | Milestones (diamond) | Built |
| 6 | Progress fill on project and phase bars | Built |
| 7 | Overdue and dependency-conflict flags | Built |
| 8 | Critical path highlight | Built |
| 9 | Baseline: save the plan, see ghost bars and days slipped | Built |
| 10 | Unscheduled tasks shown in their phase; click the row to schedule | Built |
| 11 | Add a task inside a phase from the chart | Built |
| 12 | Undo (button and Ctrl/⌘ Z) | Built |
| 13 | Workload strip: planned hours per day or week against capacity, using task estimates | Built |
| 14 | Drag a project's bar to shift the whole project | Built |
| 15 | Filters: project, client, show done; all remembered | Built |
| 16 | CSV export and a print layout | Built |
| 17 | Working days from the calendar's working-hours setting | Waits on "Calendar views and remembered settings" landing its working-days setting |
| 18 | Lag on links and the other three link types (start-to-start, etc.) | Not planned: rarely used by one person, adds a lot of UI |
| 19 | Share a read-only timeline with the client | Later, on top of the client share-link work |

## Design rules kept

- Minimal by default: bars, a today line and the toolbar. Critical path,
  baseline and workload are toggles, off until wanted, and remembered.
- Every change is a project mutation like any other edit, saved and shared live,
  so the assistant can make the same changes (see `src/lib/studio/schedule.ts`).
- Moving a dependency only ever pushes later work forward; it never pulls work
  earlier without being asked, which is what surprises people in other tools.
