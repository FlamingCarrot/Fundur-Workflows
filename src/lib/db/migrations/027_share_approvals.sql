CREATE TABLE share_approvals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 share_id UUID NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 decision VARCHAR(20) NOT NULL CHECK(decision IN ('approved','changes_requested')),
 author_name VARCHAR(100) NOT NULL,
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=3000),
 content_hash VARCHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(share_id,request_id)
);
CREATE INDEX idx_share_approvals_share ON share_approvals(share_id,created_at DESC,id DESC);
-- Serialize the per-link write limits; separate anonymous requests must not
-- all pass a count from the same earlier snapshot. This also preserves retries.
CREATE FUNCTION limit_share_approvals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM share_links WHERE id=NEW.share_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM share_approvals WHERE share_id=NEW.share_id AND request_id=NEW.request_id) THEN RETURN NULL; END IF;
 IF (SELECT COUNT(*) FROM share_approvals WHERE share_id=NEW.share_id)>=100 OR
    (SELECT COUNT(*) FROM share_approvals WHERE share_id=NEW.share_id AND created_at>NOW()-INTERVAL '1 minute')>=10 THEN RETURN NULL; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER share_approval_limits BEFORE INSERT ON share_approvals FOR EACH ROW EXECUTE FUNCTION limit_share_approvals();
