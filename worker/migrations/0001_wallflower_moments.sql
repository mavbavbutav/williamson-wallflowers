CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_date TEXT,
  host_name TEXT,
  host_email TEXT,
  host_token TEXT NOT NULL UNIQUE,
  admin_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  retention_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_host_token ON events(host_token);
CREATE INDEX IF NOT EXISTS idx_events_retention ON events(retention_expires_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  active_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_public_code ON tags(public_code);
CREATE INDEX IF NOT EXISTS idx_tags_active_event ON tags(active_event_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
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

CREATE INDEX IF NOT EXISTS idx_submissions_event_status ON submissions(event_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_deleted ON submissions(deleted_at);
