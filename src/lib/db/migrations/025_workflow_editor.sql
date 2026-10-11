ALTER TABLE projects ADD COLUMN workflow_definition JSONB;
ALTER TABLE projects ADD COLUMN form_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_snapshots ADD COLUMN form_values JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE workflow_drafts (
 workflow_id VARCHAR(100) PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 definition JSONB NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 published_version INTEGER NOT NULL DEFAULT 0,
 updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workflow_drafts_workspace ON workflow_drafts(workspace_id);
