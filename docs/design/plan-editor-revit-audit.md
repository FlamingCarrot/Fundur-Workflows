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
| 1 | Multi-select: Ctrl+click to add, window and crossing selection boxes | Move, copy or delete many things at once | Live (increment 1) |
| 2 | Modify tools on a selection: Move, Copy (Ctrl+drag in Revit), Rotate, Mirror, Delete | Reworking layouts quickly | Live (increment 1): drag, Alt+drag copy, Space rotate, Shift+H / Shift+V mirror |
| 3 | Nudge with arrow keys, larger nudge with Shift | Fine placement | Live (increment 1), step is a setting |
| 4 | Keyboard shortcuts list (Revit's Keyboard Shortcuts dialog) | Learning and speed | Live (increment 1): press ? |
| 5 | Align and distribute | Rows of desks and chairs in line | Live (increment 1) |
| 6 | Copy / paste, including to another floor (Paste Aligned to Selected Levels) | Reusing a fit-out on several floors | Live (increment 1) |
| 7 | Pin (PN) to stop the existing shell moving | Not knocking the base build by accident | Increment 2 |
| 8 | Temporary dimensions: distances to the nearest walls shown on selection, typed to move | Placing furniture an exact distance off a wall | Increment 2 |
| 9 | Array (AR): linear copies at a spacing | Desk banks, rows of seats | Increment 2 |
| 10 | Hide / isolate in view (HH, HI) | Working on one kind of thing at a time | Increment 2 |
| 11 | Schedules: furniture (FF&E), rooms, doors, with CSV export | The quantity lists clients and suppliers ask for | Increment 3 |
| 12 | Phasing: existing, new, demolished walls and items, with phase graphics | The core of a fit-out drawing | Increment 3 |
| 13 | Room tags and area plans with department colours (color fill legend) | Presenting space plans | Increment 3 |
| 14 | Snaps: midpoints, wall faces, perpendicular, alignment lines | Accurate drawing without typing | Increment 4 |
| 15 | Measure tool (quick distance, not placed) | Checking clearances | Increment 4 |
| 16 | Split element (SL), Trim/Extend to corner (TR), Offset (OF) | Editing walls the way Revit does | Increment 4 |
| 17 | Groups (GP) | A workstation cluster that moves as one | Increment 5 |
| 18 | Sheets with a title block, print to PDF at a scale | Issuing drawings | Increment 5 |
| 19 | Reflected ceiling plan: ceilings, lights, grid | Interior designers do these too | Later |
| 20 | Finishes: floor finish per room, wall finish per face, with a finishes schedule | Specification | Later |
| 21 | Wall types (layers, fire rating) and door/window types with marks | Specification and tags | Later |
| 22 | Line styles, fill patterns, detail lines and regions | Drafting detail | Later |
| 23 | 3D view and sections / elevations | Presenting and checking heights | Later, after IFC import |
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
