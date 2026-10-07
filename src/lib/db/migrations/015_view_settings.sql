-- ==============================================================================
-- How each person last left the app's views: the calendar on week or month, a
-- filter on the projects list, the layers shown on a plan, and so on.
--
-- One row per setting, kept per person rather than per workspace, so the
-- screens open the way they left them on any device. Values are small JSON
-- that the screen checks before using, so a stale or odd value falls back to
-- the screen's default rather than breaking it.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS user_view_settings (
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(200) NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);
