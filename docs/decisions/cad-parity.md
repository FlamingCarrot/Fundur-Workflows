# CAD features compared with CADCraft (2026-10-21)

Andre asked to compare our plan, blueprint and 3D editors with CADCraft
(github.com/storytold/cadcraft), an open-source AutoCAD-style drafting app, and
to build what we lack, in our own look, with every feature also an AI tool.

CADCraft is a 2D drafting tool: it has almost no 3D (its own roadmap rates 3D at
2%). Our 3D, blueprint modelling, materials and renders are already well beyond
it, so the gaps are all in precise 2D drafting on the floor plan.

## What we already had

| CADCraft | Ours |
|---|---|
| Pan, zoom, pinch, ViewCube, grid | Plan canvas and 3D view, ViewCube, fit (F) |
| Object snaps: endpoint, midpoint, centre, nearest | Corner, middle, centre and on-wall snaps |
| Ortho / polar | Angles lock to 45° steps (Alt for any angle) |
| Direct distance entry | Type a length then Enter while drawing walls |
| MOVE, COPY, ROTATE, MIRROR, rectangular ARRAY, ERASE | Move, Alt-drag copy, turn, mirror, array, align, distribute, delete |
| TRIM / OFFSET / BREAK on walls | Trim walls to a corner, offset a wall, split a wall |
| Aligned dimensions | Dimension tool; door marks; measure tape |
| Layers on/off, isolate | Layer toggles, hide / isolate (H H, H I) |
| BLOCK / INSERT, nested blocks | Blueprints (nested) and furniture groups / assemblies |
| Hatch (solid) | Colour fill by room data, room floor materials |
| Layouts, viewports, PLOT to PDF | Sheets with scales, PDF export, schedules |
| DXF read and write | DXF import (walls) and DXF + IFC export |
| MCP / agent control | AI tools for every plan action (and MCP via the registry) |

## What we are adding (in this order)

1. **Drafting shapes** on the plan: line, polyline with arcs, rectangle, circle,
   arc, polygon and ellipse, each with colour, line type (solid, dashed, hidden,
   centre) and line weight. For joinery setting out, ceiling lines, floor
   patterns and details. They export to and import from DXF.
2. **Drawing layers** like CAD: named layers with colour, line type, weight,
   on/off and lock; a current layer.
3. **Precision**: more object snaps (intersection, perpendicular, quadrant,
   tangent, endpoints of drafting shapes), polar tracking, and a command bar
   where you can type commands (L, PL, C, REC, O, TR…) and coordinates
   (`x,y`, `@dx,dy`, `@length<angle`).
4. **Modify**: offset, trim, extend, fillet, chamfer, break, join, explode,
   scale, polar array and stretch for drafting shapes.
5. **Annotation**: horizontal/vertical, angular, radius and diameter
   dimensions, dimension chains, leaders with text, text sizes, and tables.
6. **Hatches**: tile, timber, stone, concrete, insulation and diagonal
   patterns on rooms or any closed shape, with scale and angle.
7. **Inquiry**: area and perimeter of any picked outline, point coordinates,
   and a list of a shape's properties.

## Done so far

- 1, 2 and 6: the Draw (L) and Hatch (B) tools, drawing layers, ten hatch
  patterns, DXF export (`src/lib/plan/drafting.ts`); AI tool `draft_on_plan`.
- 4: offset, trim, extend, fillet, chamfer, break, join, explode, polar array
  and scale (`src/lib/plan/draft-modify.ts`); on the Draw bar and the shape's
  panel, and as `draft_on_plan` operations. Stretch is still to do.
- 3: intersection, perpendicular and tangent snaps; the command line under the
  plan (`src/lib/plan/command.ts`). Polar tracking beyond 45° steps is still to
  do.
- 5: horizontal, vertical, aligned, angle, radius, diameter and chained
  dimensions as drawn shapes on drawing layers (Draw bar, command line DLI,
  DAN, DRA, DDI, DCO, and `draft_on_plan`); drawn shapes and dimensions print
  on sheet PDFs (`src/lib/plan/draft-pdf.ts`). Tables are still to do.

Not planned: AutoLISP, plot styles, xrefs and parametric constraints, which
matter little to interior designers.
