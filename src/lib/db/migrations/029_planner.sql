-- ==============================================================================
-- Each person's own planning in a workspace: to-dos that belong to no project,
-- the lists they keep them on, their Kanban board's columns and where each card
-- sits, and their working week.
--
-- It is one small document per person, changed only through the same pure
-- function the browser and the assistant use (src/lib/planner/state.ts). The
-- revision lets the server apply a change on top of the latest copy.
--
-- Projects keep the working days they were planned with, so a step never falls
-- due on a day off. Projects from before this hold NULL: Monday to Friday.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS planner_states (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS work_days JSONB;
