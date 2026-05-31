PRAGMA foreign_keys = OFF;

CREATE TABLE submissions_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'audio')),
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration_seconds REAL DEFAULT 0,
  guest_name TEXT,
  guest_note TEXT,
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO submissions_new (
  id,
  event_id,
  media_type,
  object_key,
  original_filename,
  mime_type,
  size,
  duration_seconds,
  guest_name,
  guest_note,
  consent_at,
  status,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  id,
  event_id,
  media_type,
  object_key,
  original_filename,
  mime_type,
  size,
  duration_seconds,
  guest_name,
  guest_note,
  consent_at,
  status,
  deleted_at,
  created_at,
  updated_at
FROM submissions;

DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;

CREATE INDEX IF NOT EXISTS idx_submissions_event_status ON submissions(event_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_deleted ON submissions(deleted_at);

PRAGMA foreign_keys = ON;
