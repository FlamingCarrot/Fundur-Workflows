CREATE TABLE IF NOT EXISTS project_design (
 project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 data JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_design_workspace ON project_design(workspace_id,project_id);
ALTER TABLE project_share_visibility DROP CONSTRAINT IF EXISTS project_share_visibility_target_type_check;
ALTER TABLE project_share_visibility ADD CONSTRAINT project_share_visibility_target_type_check CHECK(target_type IN ('brief','plan','phase','board','schedule'));
ALTER TABLE workspace_user_features DROP CONSTRAINT IF EXISTS workspace_user_features_feature_key_check;
ALTER TABLE workspace_user_features ADD CONSTRAINT workspace_user_features_feature_key_check CHECK(feature_key IN ('ai','floor_plan','layout','sharing','design'));
