-- ==============================================================================
-- Project settings: each project's own changes to its workflow.
--
-- A project stays pinned to the published workflow version it started on. What
-- it changes (default phases and steps switched off or renamed, phases and
-- steps it added, modules added, a different order) is kept here as an overlay
-- laid over that definition. See src/lib/workflow/custom.ts for the shape.
-- ==============================================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workflow_custom JSONB NOT NULL DEFAULT '{}';
