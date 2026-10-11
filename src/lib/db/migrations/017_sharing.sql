-- Explicit publication permissions and immutable snapshots. No raw bearer token
-- is retained: share_links.token holds SHA-256 for links created by this feature.
-- Legacy placeholders remain untouched. Readers require an assigned project
-- and a hashed, cryptographically generated token.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS phase_key VARCHAR(100);
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS snapshot JSONB;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS frozen_file JSONB;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_share_links_project ON share_links(workspace_id, project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS project_share_visibility (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('brief','plan','phase')),
  target_key VARCHAR(100) NOT NULL,
  client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (workspace_id, project_id, target_type, target_key)
);
CREATE TABLE IF NOT EXISTS share_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES share_comments(id) ON DELETE CASCADE,
  author_name VARCHAR(100) NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_share_comments_share ON share_comments(share_id, created_at);
