-- ==============================================================================
-- Tasks (P2-01 to P2-03).
--
-- A phase's checklist steps are already tasks: they carry a due date from the
-- workflow definition and are ticked on the phase screen. This table holds what
-- the definition cannot: a date the designer moved, the document a step
-- produced, and tasks they added themselves.
--
-- A row with step_item_id set belongs to that checklist step; a row without one
-- is a task of their own, which carries its own title and done state.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The checklist step this is about, from the workflow definition; null for a task of their own.
    step_item_id VARCHAR(100),
    phase_key VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL DEFAULT '',
    due_date DATE,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    -- What the task produced, when it produced a file.
    output_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One row per step, so moving a step's date twice changes the same row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_tasks_step ON project_tasks(project_id, step_item_id)
    WHERE step_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id, due_date);
