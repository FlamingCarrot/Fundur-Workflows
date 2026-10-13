-- Editing a message in the assistant chat, or asking for a reply again,
-- replaces that message and everything after it. The replaced messages are
-- kept (with their changes, so Undo still works) but no longer shown or read
-- back to the model.
ALTER TABLE ai_chat_messages ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMP WITH TIME ZONE;
