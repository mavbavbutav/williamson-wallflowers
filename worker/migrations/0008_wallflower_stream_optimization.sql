ALTER TABLE submissions
  ADD COLUMN stream_uid TEXT;

ALTER TABLE submissions
  ADD COLUMN stream_status TEXT DEFAULT 'none';

ALTER TABLE submissions
  ADD COLUMN stream_error TEXT;

ALTER TABLE submissions
  ADD COLUMN stream_ready_at TEXT;

ALTER TABLE submissions
  ADD COLUMN stream_created_at TEXT;

ALTER TABLE submissions
  ADD COLUMN stream_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_stream_uid
  ON submissions(stream_uid);

CREATE INDEX IF NOT EXISTS idx_submissions_stream_status
  ON submissions(stream_status);
