# Plan editor: Revit feature audit

Andre asked (2026-10-07) for the plan editor to become a good alternative to
Revit for interior designers. This is the audit of what Revit does, held up
against what the editor does, ranked by how much each matters for drawing
interior layouts inside an existing shell. The editor is built down this list
in increments; the status column says what is live.

Revit is a 3D BIM modeller with sheets, schedules and families. Most of its
day-to-day value for an interior designer sits in a smaller set: precise 2D
editing of walls, doors, furniture and rooms, with tags, dimensions,
schedules, phasing (existing / new / demolished) and printable sheets.
Structural, MEP and analytical tools are out of scope.

## What the editor already had (phase 3, PR #9)

Walls and partitions with typed lengths, joined corners that move together,
four door types and windows, columns, rooms from walls or drawn outlines,
about 35 furniture items, notes, dimension lines, floors, a traced-over image
with scale, DXF import, DXF and IFC4 export, versions, compare, and a
corrections log. Layout options open in the editor (phase 4).

## Ranked list

| # | Revit feature | What it gives a designer | Status |
|---|---|---|---|
| 1 | Multi-select: Ctrl+click to add, window and crossing selection boxes | Move, copy or delete many things at once | Live for everything: Shift+click, window (left to right) and crossing (right to left) boxes with Ctrl+drag |
| 2 | Modify tools on a selection: Move, Copy (Ctrl+drag in Revit), Rotate, Mirror, Delete | Reworking layouts quickly | Live: drag, Alt+drag copy, Space rotate, Delete, Mirror on the selection bar |
| 3 | Nudge with arrow keys, larger nudge with Shift | Fine placement | Live: 10 mm, 100 mm with Shift |
| 4 | Keyboard shortcuts list (Revit's Keyboard Shortcuts dialog) | Learning and speed | Live: press ? or the keyboard button |
| 5 | Align and distribute | Rows of desks and chairs in line | Live on the selection bar (line up six ways, space evenly) |
| 6 | Copy / paste, including to another floor (Paste Aligned to Selected Levels) | Reusing a fit-out on several floors | Live: Ctrl+C / Ctrl+V and the selection bar; another floor pastes in the same place |
| 7 | Pin (PN) to stop the existing shell moving | Not knocking the base build by accident | Live: Pin on the selection bar for walls, columns, rooms and furniture; pinned things show a pin and refuse moves and deletes, from people and the assistant |
| 8 | Temporary dimensions: distances to the nearest walls shown on selection, typed to move | Placing furniture an exact distance off a wall | Live (distance guides, built in another thread) |
| 9 | Array (AR): linear copies at a spacing | Desk banks, rows of seats | Live: Repeat in a row on the selection bar (count, across or up, gap); the assistant can too |
| 10 | Hide / isolate in view (HH, HI) | Working on one kind of thing at a time | Live: H H hides the selection, H I shows only it, H R shows all (or the selection bar), in 2D and 3D with a teal frame; remembered per project; the plan itself never changes; the assistant can too |
| 11 | Schedules: furniture (FF&E), rooms, doors, with CSV export | The quantity lists clients and suppliers ask for | Live: Schedules button (furniture, rooms, doors and windows, walls), pick a row to select, CSV or keep in files; the assistant reads them |
| 12 | Phasing: existing, new, demolished walls and items, with phase graphics | The core of a fit-out drawing | Live: walls, doors and windows, columns and furniture are existing, to demolish or new (selection bar); Layers → Phases shows all (existing grey, to demolish dashed), as it is, demolition or new layout, in 2D, 3D and on sheets, with a key; schedules get a phase column; copies are new work; the assistant can set and show phases |
| 13 | Room tags and area plans with department colours (color fill legend) | Presenting space plans | Live: Layers → Colour rooms by name, floor finish or size, with a legend of areas; on sheets too; the assistant can set it |
| 14 | Snaps: midpoints, wall faces, perpendicular, alignment lines | Accurate drawing without typing | Live: corners, wall middles, column centres, points on walls and walls drawn into a wall, each marked and named; alignment lines; Alt turns snapping off |
| 15 | Measure tool (quick distance, not placed) | Checking clearances | Live: Tape tool (Q) reads length, across, up and slope between two snapped points, without adding anything to the plan |
| 16 | Split element (SL), Trim/Extend to corner (TR), Offset (OF) | Editing walls the way Revit does | Live: Split, Trim/Extend to corner and Offset on the selection bar for a wall; the assistant has split_wall, trim_walls and offset_wall |
| 17 | Groups (GP) | A workstation cluster that moves as one | Live (built in another thread) |
| 18 | Sheets with a title block, print to PDF at a scale | Issuing drawings | Live: Sheets button, A4 to A1, Fit or 1:20 to 1:200, title block with practice, project, drawing, scale, date, sheet number and revision; vector PDF, optional 3D view sheet; the assistant can print them |
| 19 | Reflected ceiling plan: ceilings, lights, grid | Interior designers do these too | Live: Layers → Ceiling plan; each room has a ceiling (plaster, 600 or 1200 grid centred in the room, timber slats, open to the soffit) and height, labelled CH; lights and lifted things show, doors and floor furniture step aside; on sheets and in the room schedule; the assistant can set ceilings and switch views |
| 20 | Finishes: floor finish per room, wall finish per face, with a finishes schedule | Specification | Floor finish per room live (design library materials); wall finishes come from wall types |
| 21 | Wall types (layers, fire rating) and door/window types with marks | Specification and tags | Wall types with layers live (design library); doors and windows are numbered D01, W01 (or typed), tagged on the plan and sheets (Layers → Door and window marks) and listed by mark in the door and window schedule; the assistant can mark them |
| 22 | Line styles, fill patterns, detail lines and regions | Drafting detail | Later |
| 23 | 3D view and sections / elevations | Presenting and checking heights | Live: 3D views, view cube, section planes and section boxes, cameras, renders |
| 24 | Worksharing and element borrowing | Several people in one model | Covered differently: versions, conflicts and live sync |

## Not planned

Structural framing, MEP systems, energy analysis, topography, rebar, and
Revit's family editor. Revit's own .rvt format cannot be written by anyone but
Autodesk; IFC and DXF stay the exchange formats.

## Notes for the AI work

Every editing tool above is a pure function in `src/lib/plan` that takes the
plan and returns the new plan with a line for the corrections log (see
`src/lib/plan/selection.ts`), so the assistant can call the same actions a
person makes. The editor's current selection is a list of `{ kind, id }`
(`PlanItem[]`), and `describeSelection` says it in words.
