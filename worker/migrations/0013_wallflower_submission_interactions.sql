CREATE TABLE IF NOT EXISTS submission_reactions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike', 'laugh', 'cry', 'surprised')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submission_reactions_submission
  ON submission_reactions (submission_id);

CREATE INDEX IF NOT EXISTS idx_submission_reactions_event
  ON submission_reactions (event_id);

CREATE TABLE IF NOT EXISTS submission_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submission_comments_submission
  ON submission_comments (submission_id);

CREATE INDEX IF NOT EXISTS idx_submission_comments_event
  ON submission_comments (event_id);
