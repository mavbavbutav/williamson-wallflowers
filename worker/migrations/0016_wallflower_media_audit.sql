CREATE TABLE IF NOT EXISTS submission_media_insights (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'analyzed', 'skipped', 'failed')),
  source_kind TEXT NOT NULL DEFAULT '',
  source_object_key TEXT,
  mime_type TEXT,
  format TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  orientation TEXT,
  quality_score REAL NOT NULL DEFAULT 0,
  vision_status TEXT NOT NULL DEFAULT 'not_requested',
  vision_model TEXT,
  people_count INTEGER,
  face_count INTEGER,
  dominant_colors TEXT NOT NULL DEFAULT '[]',
  scene_tags TEXT NOT NULL DEFAULT '[]',
  lighting_tags TEXT NOT NULL DEFAULT '[]',
  composition_tags TEXT NOT NULL DEFAULT '[]',
  background_cues TEXT NOT NULL DEFAULT '[]',
  visible_text TEXT,
  summary TEXT,
  skip_reason TEXT,
  error_message TEXT,
  analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submission_media_insights_event
  ON submission_media_insights(event_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_submission_media_insights_vision
  ON submission_media_insights(event_id, vision_status);

CREATE TABLE IF NOT EXISTS event_media_profiles (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'ready', 'partial', 'failed')),
  submission_count INTEGER NOT NULL DEFAULT 0,
  analyzed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  video_thumbnail_count INTEGER NOT NULL DEFAULT 0,
  ai_analyzed_count INTEGER NOT NULL DEFAULT 0,
  people_count INTEGER NOT NULL DEFAULT 0,
  face_count INTEGER NOT NULL DEFAULT 0,
  average_quality_score REAL NOT NULL DEFAULT 0,
  dominant_colors TEXT NOT NULL DEFAULT '[]',
  scene_tags TEXT NOT NULL DEFAULT '[]',
  lighting_tags TEXT NOT NULL DEFAULT '[]',
  composition_tags TEXT NOT NULL DEFAULT '[]',
  background_cues TEXT NOT NULL DEFAULT '[]',
  profile_summary TEXT,
  generated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_media_profiles_status
  ON event_media_profiles(status, updated_at);
