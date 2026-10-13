-- When the autopilot last drafted a payment reminder for an overdue invoice,
-- so it reminds once a week rather than on every run.
ALTER TABLE business_docs ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
