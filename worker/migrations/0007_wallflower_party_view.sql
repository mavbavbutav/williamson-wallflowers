ALTER TABLE submissions ADD COLUMN guest_visible_at TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_party_view
  ON submissions (event_id, guest_visible_at)
  WHERE guest_visible_at IS NOT NULL;
