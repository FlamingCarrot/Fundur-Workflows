-- Emoji reactions on conversation posts: { "👍": [{ "key": "...", "name": "..." }], ... }
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;
