-- ==============================================================================
-- Layout rule sets (P4-01).
--
-- The designer's layout rules (desk sizes, clearances, route widths, which
-- teams and rooms belong near each other) are kept once per workspace and
-- reused on every project. Each generated layout keeps its own copy of the
-- rules it was made with, inside the floor plan, so editing a rule set later
-- never changes what an earlier option was checked against.
--
-- The revision goes up with every save; a save made against an older revision
-- is refused, so two people editing the same rules never overwrite each other.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS layout_rule_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    rules JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layout_rule_sets_workspace ON layout_rule_sets(workspace_id, created_at);
