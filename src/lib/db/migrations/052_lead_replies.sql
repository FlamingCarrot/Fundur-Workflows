-- A reply the AI drafted for an enquiry, for her to check and send.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS draft_reply TEXT;
