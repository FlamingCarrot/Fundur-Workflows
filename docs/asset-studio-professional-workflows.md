# Professional 3D Asset Studio: research and iteration plan

16 October 2026. Goal: an artist's asset workspace built on Fundur's reusable blueprint mesh engine, with its own entry points and vocabulary. Floor plans, architectural measurements and technical documentation are separate workflows.

## Research basis

ZBrush distinguishes flexible concept sculpting from topology and detail workflows. Its DynaMesh documentation explicitly describes DynaMesh as a concept-creation tool rather than the final high-detail method. The relevant lesson is to separate blockout/remeshing from controlled detailing instead of presenting one subdivision button as a complete sculpting system. [Maxon DynaMesh methods](https://help.maxon.net/zbr/en-us/Content/html/user-guide/3d-modeling/modeling-basics/creating-meshes/dynamesh/methods/methods.html)

Maxon's geometry reference includes subdivision, remeshing and topology operations, while its documented controls cover SubTools, masks and painting. An asset artist needs both local surface tools and control over the separate pieces of an object. Our proposed equivalent is a parts hierarchy with isolation, locking and material assignment, alongside an explicit sculpt mode. [ZBrush geometry reference](https://help.maxon.net/zbr/en-us/Content/html/reference-guide/tool/polymesh/geometry/geometry.html), [ZBrush controls](https://help.maxon.net/zbr/en-us/Content/Resources/Uploads/ZBrush-Shortcuts.pdf)

Substance Painter has a distinct baking mode for mesh maps that support later painting and smart-material workflows. Its guide separates selecting texture sets/UV tiles, selecting bakers and adjusting baking settings. This supports an explicit surface-production stage rather than silently calling a coloured draft model textured and finished. [Adobe mesh-map baking](https://experienceleague.adobe.com/en/docs/substance-3d-painter/using/baking/how-to-bake-mesh-maps)

Substance Modeler documents separate exports for a full scene, selected objects and named assets. Our exports should likewise make asset scope explicit, retain editable source geometry and distinguish that from runtime delivery. [Adobe Modeler export workflow](https://helpx.adobe.com/substance-3d-modeler/desktop/export-mode/export-your-creations.html)

Three.js provides physical-material features and an example of fast subsurface scattering. The current WebGL preview combines physical material controls with a direct-light approximation; it does not calculate path-traced multiple scattering, measured thickness or a full volumetric skin model. [Three.js physical material](https://threejs.org/docs/#MeshPhysicalMaterial), [Three.js fast SSS example](https://threejs.org/examples/webgl_materials_subsurface_scattering.html)

These are sources for product design, not evidence that this browser implementation matches those products in scale or capability. No artist interviews or benchmark measurements have been performed. The priorities below are our synthesis of the documented workflows and the user's requests.

Maxon documents axis-based mirror symmetry and distinguishes local symmetry for offset parts. The first implementation here mirrors brush centers around the selected part's local bounding-box center, follows its vertical rotation, and fixes those planes for each gesture. It supports combinations of X/Y/Z, not radial or topology-aware posed symmetry. [Maxon symmetry guide](https://help.maxon.net/zbr/en-us/Content/html/user-guide/3d-modeling/sculpting/symmetry/symmetry.html), [Maxon transform controls](https://help.maxon.net/zbr/en-us/Content/html/reference-guide/transform/transform.html)

## Workflows the product needs to support

| Workflow | Typical sequence | Required evidence/output |
| --- | --- | --- |
| Organic sculpt / character | Reference and scale → silhouette blockout → primary/secondary forms → controlled surface detail → retopology → UVs/bakes → materials → rig preparation | Editable sculpt, clean animation topology, material maps, scale/pivot and engine checks |
| Hard-surface prop | References and dimensions → primitive/mesh blockout → bevels/panels → high/low geometry when needed → UV layout → baking → material wear/detail | Readable silhouette, shading/normals, texture maps, collision and LOD checks |
| Stylized asset | Shape language/reference → exaggerated blockout → silhouette iteration → deliberate edges and colour regions → simplified delivery | Consistent style, gameplay-distance readability, measured resource budget |
| Scan/photo reconstruction | Group references → distinguish observed/inferred geometry → model/import reconstruction → repair topology → optimize → rebuild materials → validate | Retained sources, uncertainty, cleaned geometry and reproducible export |
| Asset family / batch | Stable asset IDs and three-view groupings → shared style/materials → per-asset generation/review → variants → export manifest | Per-asset state, resumable jobs, no view mixing or silent duplicate models |

The order is adaptable. A low-poly stylized prop may not need a separate high-poly sculpt. A character needs topology and deformation checks that a static rock does not. The application should ask for the intended outcome and expose appropriate tools rather than impose a floor-plan process.

## Artist interface principles

Make the model the focus. Open a dedicated full-viewport asset route with a neutral backdrop, artist mode controls and an asset-specific return path. Do not show a plan grid, room layers or dimension annotations by default. Reuse the blueprint engine's actual geometry, mesh editing, undo and persistence functions.

Keep creation and interaction modes separate: Sculpt, Paint, Model, Parts and History. Brush radius, strength and falloff belong near the surface tools. Navigation must remain predictable: orbit/pan/zoom should not accidentally sculpt, and a sculpt stroke should make one undoable action rather than hundreds of unrelated history entries. Stylus pressure and a surface cursor are implemented; adjustable spacing remains planned.

Keep references and delivery requirements nearby without turning the canvas into a project form. A reference shelf needs explicit front/side/back labels, opacity/pinning and the ability to inspect saved sources. Production readiness needs its own review: topology, UVs, material channels, LODs, collisions, rigs, licences and engine validation must be reported honestly.

## Capability map and planned increments

| Area | Current foundation | Next implementation work |
| --- | --- | --- |
| Entry points | Separate Asset Studio module, legacy game-card correction, project-specific modeler route | Make every asset link and contextual action stay in the artist workspace |
| Sculpt | Direct surface drag strokes and cursor; Inflate, carve, smooth, flatten and pinch; pressure scaling; inverse/smooth modifiers; local X/Y/Z symmetry and mirrored-position markers; subdivision; one undo step per stroke | Adjustable stroke spacing/falloff, masks and sculpt layers |
| Geometry | Shapes, arbitrary meshes, point/face editing, extrusion, inset, joining and separation | Controlled density, topology repair, retopology helpers and non-destructive resolution workflows |
| Painting | Face/part materials with editable surface patches | Vertex colour strokes, masks/layers, texture-set workflow and UV painting/baking |
| Materials | Coating, sheen, transmission, volume tint, iridescence and fast SSS presets | Material preview stage, texture channels, normal/roughness maps and portable shader validation |
| Organization | Parts hierarchy, hide/lock, source references and revision history | Named groups, solo/isolation shortcuts, reference shelf and sculpt layers |
| Delivery | Editable JSON, triangulated glTF, physical extensions, production metadata and warnings | UV/bake output, LOD/collision helpers, import round trips and engine-specific validation |
| Automation | AI can inspect references, edit geometry/materials and save models with project context | Durable per-asset jobs, cancellation, retry/resume and service-backed reconstruction |

The browser mesh cap is currently 4,000 vertices and 4,000 faces per part. This is a bounded prototype, not a high-resolution production sculptor. Larger meshes require a deliberate performance design: typed geometry buffers, incremental viewport updates, worker computation, stroke-level history and measured memory limits. Simply raising the cap would make the tools less reliable.

## Test/release contract

Ship a usable increment, validate its geometry/data invariants and access rules, build production, push and verify deployment. Report what users can test and where. Preserve older workflow versions; existing projects receive compatible entry-point fixes while new projects use the separate Asset Studio module. Keep standard library/technical drawing behavior intact.

For sculpting, verify locality, topology preservation, inverse behavior, input bounds, undo/save/reload and interaction with camera navigation. For painting, verify surface coverage is preserved exactly once, materials remain editable, and export retains intended regions. For rendering, verify actual browser shader compilation in addition to schema tests. For reconstruction, test on representative three-view sets and explicitly record hidden-surface and scale assumptions.

An ongoing goal tracks this work. Completion means a validated professional asset-production workflow, not just a list of attractive feature names. Remaining capabilities stay visibly planned until implemented and tested.

### Direct-stroke increment verification

The artist workspace now uses surface ray hits for mouse/stylus strokes and hides point-editing overlays in Sculpt mode. Brush radius follows zoom/projection. Shift smooths, Ctrl reverses Inflate/Carve, and Escape or pointer cancellation discards the in-progress stroke. Background or Alt dragging keeps camera navigation available. Touch input retains camera gestures in this increment.

Browser verification in the local demo confirmed that a continuous drag changes the model, a single Undo restores the saved state, and background dragging does not create an edit. No browser rendering errors were reported. Unit checks cover immutable before/final snapshots, cancellation, one-time commit, pressure scaling, modifier behavior and cursor sizing. A physical stylus has not been tested. The mesh-density cap remains unchanged.

### Local-symmetry increment verification

The Sculpt panel now exposes independent X/Y/Z toggles and Off. These mirror within the active part; they do not duplicate geometry or modify other parts. A gesture retains its initial local frame so bounds refitting cannot move its symmetry planes mid-stroke. Mirrored positions appear as small cursor markers, including through the model; they indicate positions rather than guaranteed surface hits.

Brush influences are combined by the nearest mirrored center, applying strength once where brushes overlap. Flatten/Pinch average equal-distance influences to keep centerline behavior symmetric. Local symmetry is also available as an optional axis list in AI edit_blueprint sculpt operations. This does not repair pre-existing asymmetry, weld a seam, or perform topology-aware posed symmetry.

Geometry tests verify all five brushes on translated/rotated meshes, centerline strength, unique axis combinations, immutable session frames, cancellation and invalid inputs. Browser preview creation failed repeatedly because its webview did not attach; this release has no new visual-interaction verification. The preceding direct-stroke release was tested in the browser, but that does not prove the new controls or mirrored markers render correctly.

### Next increment: masking

Maxon's masking reference describes painted protection with a visible intensity, invert/clear/all operations, and blur/sharpen adjustments. This supports the next implementation: paint and erase protection, show it on the model, invert/clear/all controls, and honour weights during every sculpt brush. [Maxon masking reference](https://help.maxon.net/zbr/en-us/Content/html/reference-guide/tool/polymesh/masking/masking.html)

Implementation requirements: keep weights associated with vertices through save/reload and undo; interpolate them on subdivision; remap or explicitly clear them when topology changes; combine them with symmetry without repeatedly increasing protection in overlaps. Do not silently lose masks when material patches or mesh edits change vertex indices. Protection must affect brush displacement, not merely darken a preview. These are planned requirements, not current capabilities.
