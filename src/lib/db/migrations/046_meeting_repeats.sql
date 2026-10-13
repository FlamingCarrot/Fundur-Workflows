-- Repeating meetings: weekly, fortnightly or monthly. Each occurrence is its
-- own meeting (own call, chat thread, notes and transcript), linked by
-- series_id; the next one is made once the latest has passed.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS repeat VARCHAR(12) NOT NULL DEFAULT 'none';
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_repeat_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_repeat_check CHECK (repeat IN ('none', 'weekly', 'fortnightly', 'monthly'));
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS series_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_series_start ON meetings (series_id, starts_at) WHERE series_id IS NOT NULL;
