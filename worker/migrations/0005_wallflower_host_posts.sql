ALTER TABLE submissions
  ADD COLUMN source TEXT NOT NULL DEFAULT 'guest' CHECK (source IN ('guest', 'host'));

CREATE INDEX IF NOT EXISTS idx_submissions_event_source
  ON submissions(event_id, source, status, created_at);
