ALTER TABLE submissions ADD COLUMN ai_artwork_consent_at TEXT;

CREATE TABLE IF NOT EXISTS event_group_heroes (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'queued', 'generating', 'ready', 'failed')),
  object_key TEXT,
  mime_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  participant_count INTEGER NOT NULL DEFAULT 0,
  source_submission_ids TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  prompt TEXT,
  error_message TEXT,
  generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_group_heroes_status
  ON event_group_heroes(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_submissions_ai_group_hero
  ON submissions(event_id, status, source, media_type, ai_artwork_consent_at, created_at)
  WHERE ai_artwork_consent_at IS NOT NULL;
