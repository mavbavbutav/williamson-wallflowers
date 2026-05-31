ALTER TABLE events ADD COLUMN time_capsule_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN time_capsule_status TEXT NOT NULL DEFAULT 'draft' CHECK (time_capsule_status IN ('draft', 'published'));
ALTER TABLE events ADD COLUMN time_capsule_title TEXT;
ALTER TABLE events ADD COLUMN time_capsule_share_token TEXT;
ALTER TABLE events ADD COLUMN time_capsule_published_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_time_capsule_share_token
  ON events(time_capsule_share_token)
  WHERE time_capsule_share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS time_capsule_items (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  caption TEXT,
  chapter TEXT NOT NULL DEFAULT 'Guest moments',
  captured_at TEXT,
  location TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_capsule_items_event_submission
  ON time_capsule_items(event_id, submission_id);

CREATE INDEX IF NOT EXISTS idx_time_capsule_items_event_sort
  ON time_capsule_items(event_id, is_visible, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_time_capsule_items_submission
  ON time_capsule_items(submission_id);
