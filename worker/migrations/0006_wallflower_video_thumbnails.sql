ALTER TABLE submissions
  ADD COLUMN thumbnail_object_key TEXT;

ALTER TABLE submissions
  ADD COLUMN thumbnail_mime_type TEXT;

ALTER TABLE submissions
  ADD COLUMN thumbnail_size INTEGER DEFAULT 0;

ALTER TABLE submissions
  ADD COLUMN thumbnail_created_at TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_thumbnail
  ON submissions(thumbnail_object_key);
