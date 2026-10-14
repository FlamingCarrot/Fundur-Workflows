-- Meetings: when the "starts soon" reminder went out, so it goes out once.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_meetings_remind ON meetings(workspace_id, starts_at) WHERE reminded_at IS NULL AND status = 'scheduled';
