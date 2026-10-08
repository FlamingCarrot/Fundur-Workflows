CREATE TABLE project_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name VARCHAR(200) NOT NULL,
 data JSONB NOT NULL,
 created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_project_templates_workspace ON project_templates(workspace_id,name,id);
