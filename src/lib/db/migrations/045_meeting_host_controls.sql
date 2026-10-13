-- Meetings: a waiting room (clients wait until someone in the studio lets
-- them in) and host controls (mute someone, mute everyone, remove someone).
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS waiting_room BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE meeting_peers ADD COLUMN IF NOT EXISTS admitted BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE meeting_peers ADD COLUMN IF NOT EXISTS removed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE meeting_peers ADD COLUMN IF NOT EXISTS mute_at TIMESTAMPTZ;
