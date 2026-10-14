-- Conversations: following a thread (to hear about every reply) or leaving it
-- (to hear only when named), set by each person.
CREATE TABLE IF NOT EXISTS project_chat_follows (
    post_id UUID NOT NULL REFERENCES project_chat_messages(id) ON DELETE CASCADE,
    person_key VARCHAR(320) NOT NULL,
    follow BOOLEAN NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, person_key)
);
