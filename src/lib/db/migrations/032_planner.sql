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

-- A private address someone's own calendar app subscribes to. Only a hash of
-- the token is kept; resetting it makes the old address stop working.
CREATE TABLE IF NOT EXISTS calendar_feeds (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- Links clients book meetings through, limited to a range of dates. The token
-- is kept as it is so the owner can copy the link again; turning a link off or
-- deleting it is how access ends.
CREATE TABLE IF NOT EXISTS booking_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    note TEXT,
    project_slug VARCHAR(120),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_links_owner ON booking_links(workspace_id, user_id);

CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id UUID REFERENCES booking_links(id) ON DELETE SET NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    note TEXT,
    project_slug VARCHAR(120),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
-- Two clients picking the same time at once: only one gets it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_start ON bookings(user_id, starts_at) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_owner ON bookings(workspace_id, user_id, starts_at);
