# Indie game development workflow and asset production

Research and first implementation: 16 October 2026. This is a practical production-process synthesis for a solo developer or small team, not a market-size study or a guarantee of commercial success. Platform rules and generation services must be checked again when shipping or integrating them.

## What the research changes

Use milestone decisions to control investment, and repeat short production cycles inside those milestones. A game is not a sequence of documents: playtests, playable builds and engine measurements are the evidence that should change the plan. Unity describes pre-production, production, post-production and operations, including design documentation, prototypes, version control, testing and ongoing maintenance. The ten milestones below expand those broad stages into reviewable units for this app. [Unity production cycle](https://learn.unity.com/tutorial/the-real-time-production-cycle?version=2020.3)

Keep creative intent, executable content and delivery evidence connected. Unity's current pipeline architecture explicitly supports APIs, storage, transformations and automation used by external tools and AI agents. Fundur's first pass applies that principle locally: the assistant can read the game's forms and tasks, inspect reference photos, create editable library geometry and read back its quality report. It does not imply that Unity or another game engine is connected. [Unity pipeline architecture](https://docs.unity.com/en-us/unity-production-pipeline/overview)

## Proposed milestones and exit evidence

The following decomposition, gates and defaults are our implementation choices. They are adaptable to genre, team size and platform; they are not a universal industry standard.

| Milestone | Work and retained context | Exit evidence |
| --- | --- | --- |
| Vision and feasibility | Player promise, audience, comparable games, core loop, pillars, exclusions, platform, capacity, runway and risks | A small feasible scope and an explicit continue / revise / stop decision |
| Prototype and game design | Disposable experiments, greybox play, mechanics, progression, narrative, economy, input, external observations | A playable core loop with evidence on the riskiest assumption |
| Pre-production | Architecture, repository, builds, art/audio bible, backlog, dependencies, acceptance criteria and budgets | Repeatable build and asset pipeline; a capacity-sized initial sprint |
| Asset design and production | Asset inventory, reference groups, rights/provenance, dimensions, editable models, material intent, optimization and animation requirements | Reviewed draft geometry plus an honest list of remaining production checks |
| Vertical slice | A small representative experience combining code, art, levels, UI, sound, VFX, lighting and saves | Playtest results, target-hardware performance and measured production effort |
| Production sprints | Feature and content implementation, integration, review, defect triage and process improvement | Repeated playable increments meeting their acceptance criteria |
| Alpha | End-to-end progression, systems/content coverage, localization preparation, credits and save compatibility | Documented content gaps and a controlled remaining scope |
| Beta and release candidate | Device matrix, accessibility, localization, profiling, regression and crash reporting | Candidate build with reproducible test evidence and no known release blockers |
| Publishing and launch | Store assets, demo, community, platform review, rights, disclosures, support and rollback | Approved release checklist and a verified deployable build |
| Operations | Feedback, crashes, support, hotfixes, save migrations, updates and retrospective | Prioritized post-launch work and retained learning |

Asset experiments can start immediately. They do not mean the prototype or feasibility gates have passed. The app exposes the studio through project navigation without marking earlier milestones complete. Marketing and community discovery should begin before launch; their final deliverables are checked at the publishing gate.

## Agile delivery adapted to an indie team

Maintain one ordered product backlog. Give each item a player outcome, acceptance criteria, dependencies, estimated effort and links to affected assets/builds. Pick a sprint goal and realistic capacity; review the playable result and improve the process before selecting the next increment. The Scrum Guide defines the Product Backlog, Sprint Goal, inspection/adaptation events and Definition of Done. Our lightweight recommendation is a one- or two-week cadence for a small team, adapted when experiments need shorter cycles; that duration is a suggested starting point, not a requirement. [Scrum Guide](https://scrumguides.org/scrum-guide.html)

An example item: “The player can recognize and open the supply crate.” Acceptance includes an imported model, readable silhouette at gameplay distance, usable interaction, audio feedback, collision behavior, save behavior and a reproducible build. A screenshot or an attractive model alone does not satisfy the gameplay item. Track uncertain work separately from accepted delivery and cut scope when repeated evidence undermines the plan.

## Three reference images per asset

One photo supports an inferred model; it cannot reveal the back, depth or true scale. Three views should depict the same object consistently: front, side and back, with a perspective view substituted when it reveals more useful structure. Include one known dimension, consistent lighting, a plain background and no contradictory pose or perspective when possible. These are intake recommendations for our modeling workflow.

Do not describe three concept views as photogrammetry. RealityScan's capture guidance calls for good image quality, visible texture and overlapping coverage from multiple positions; a measured scan is a different pipeline from interpreting a small reference set. Reflective, transparent, moving and featureless surfaces require particular care. [RealityScan capture guidance](https://rshelp.capturingreality.com/en-US/tutorials/takingpictures.htm)

For sheets, assign an asset key to each labelled row and identify each view and its region. The mapping should survive retries: `crate_01 → sheet_A row 1 → front/side/back → model ID`. Preserve filenames even before document filing is confirmed; add project-scoped document IDs after filing. Mark ambiguous groups blocked rather than mixing views from different assets. Keep inferred dimensions and occluded surfaces with the model as assumptions.

A dedicated image-to-3D provider is a possible later backend. Meshy documents a multi-image generation endpoint and a multiple-photo product recipe. Such a service would need credentials, explicit cost accounting, durable jobs, cancellation, retries, output validation and a mesh/texture import path; it is not connected in this release. The provider's existence does not prove that every generated result meets a game's requirements. [Meshy multi-photo recipe](https://www.meshy.ai/developers/cookbook/recipes/create-product-model/), [Meshy multi-image API](https://docs.meshy.ai/zh/api/multi-image-to-3d)

## Asset production beyond the initial model

Our proposed asset record connects identity and provenance to implementation: project and asset key; intended gameplay use; reference filenames, views, regions and saved document IDs; modeling brief; assumptions; target engine; triangle/texture budgets; collision and rig requirements; model ID and version. The first pass stores these fields with the versioned blueprint. Task and build links can be retained in its brief and project forms; they are not yet enforced relational links.

The subsequent production sequence is: refine silhouette and proportions; clean topology; unwrap UVs; author or bake PBR textures; produce and inspect LODs; configure collision; rig and animate where needed; establish pivot and scale; export; import and validate in the target engine. Blender's glTF documentation explains the material and animation information supported by its exporter and the restrictions on representing materials. Preserve source work as well as runtime delivery files. [Blender glTF documentation](https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html)

The new draft glTF exporter emits triangulated geometry, flat normals, colour/roughness/metalness/opacity factors and production metadata. It converts the editor's millimetres/Z-up coordinates into metres/Y-up coordinates. Those conventions follow glTF 2.0. Image textures and procedural patterns are deliberately identified as unbaked; the export does not contain UVs, skinning, animation, LODs or physics. [glTF specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)

The default 5,000-triangle and 1,024-pixel texture targets are editable starter values, not recommended universal budgets. A hero character, background prop and mobile environment have different needs. Measure the imported asset in the intended scene, camera distance, lighting and target hardware before choosing final limits. A triangle count is a useful signal, not a performance certification.

## Quality, accessibility and release work

Treat test plans as retained evidence: build/version, hardware, reproduction steps, expected/actual results, severity, owner and retest outcome. Budget for input remapping, readable UI, contrast, subtitles, audio alternatives, motion and cognitive accessibility throughout production. The Game Accessibility Guidelines provide concrete design checks; our workflow retains the game's selected requirements and validation evidence. [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/)

Publishing is a real workstream. Steam documents separate store-presence and build review processes; leave time to correct review findings and keep store promises aligned with what the player receives. The workflow asks the developer to verify current platform requirements rather than hard-coding approval timing. [Steam review process](https://partner.steamgames.com/doc/store/review_process)

Track reference/source rights, attribution, credits and AI provenance as assets are made. Steam's Content Survey includes questions about generated content, including different considerations for content generated during development and during play. Review the current wording for the actual release; the app records required work and does not certify legal compliance. [Steam Content Survey](https://partner.steamgames.com/doc/gettingstarted/contentsurvey?language=english)

## First release and subsequent increments

Implemented: ten-milestone workflow and forms; project asset studio; persistent queue in the existing shared 3D library; one-photo/three-view uploads and labelled image sheets; assistant tools for queue reads, saved reference inspection and arbitrary editable mesh saves; project-scoped reference checks; geometry counts and budget warnings; existing 3D editor; JSON and draft glTF export. A single chat request accepts six reference images of up to 5 MB each: two individual three-view assets, or labelled sheets describing a larger batch. The assistant has the existing finite turn limit; remaining work must be reported for continuation, not claimed complete. This is not an unattended durable worker queue.

Not yet verified with a live paid vision/modeling call. Output quality depends on the configured image-capable model and reference quality. File storage and AI access must be enabled. Model review does not mean production approval. Existing workspace access, subscription checks, cost logs and revision conflicts remain in effect.

Next small releases requested by the user: mesh sculpt brushes and subdivision; material painting on selected parts; richer physical material controls; then surface/texture painting, dedicated sculpt picking and higher-resolution mesh workflows. Physically accurate subsurface scattering, multires sculpt layers, retopology and texture baking require additional rendering and geometry work. Those are planned capabilities, not claims about the initial release.
