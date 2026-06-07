CREATE TABLE IF NOT EXISTS event_group_hero_generation_attempts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  phase TEXT NOT NULL DEFAULT 'queued',
  trigger_type TEXT NOT NULL DEFAULT '',
  source_submission_ids TEXT NOT NULL DEFAULT '[]',
  participant_count INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  object_key TEXT,
  source_selection_ms INTEGER NOT NULL DEFAULT 0,
  face_reference_ms INTEGER NOT NULL DEFAULT 0,
  openai_ms INTEGER NOT NULL DEFAULT 0,
  r2_write_ms INTEGER NOT NULL DEFAULT 0,
  total_ms INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_group_hero_attempts_event
  ON event_group_hero_generation_attempts(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_group_hero_attempts_status
  ON event_group_hero_generation_attempts(status, updated_at DESC);
