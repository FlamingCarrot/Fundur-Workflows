-- Status, as in Teams: when someone was last around, and a status they set
-- themselves (busy or away, with a short note, until a time).
CREATE TABLE IF NOT EXISTS people_status (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    person_key VARCHAR(320) NOT NULL,
    seen_at TIMESTAMP WITH TIME ZONE,
    manual VARCHAR(10) CHECK (manual IN ('busy', 'away')),
    note VARCHAR(100) NOT NULL DEFAULT '',
    manual_until TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (workspace_id, person_key)
);
