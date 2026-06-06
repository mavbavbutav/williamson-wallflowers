CREATE TABLE IF NOT EXISTS submission_face_analyses (
  submission_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  source_object_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  face_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  face_signature_version INTEGER NOT NULL DEFAULT 0,
  analyzed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submission_face_analyses_event
  ON submission_face_analyses(event_id, face_signature_version, status);

CREATE TABLE IF NOT EXISTS submission_faces (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  face_index INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  provider_face_id TEXT,
  cluster_id TEXT NOT NULL,
  confidence REAL,
  bounding_box_json TEXT,
  quality_json TEXT,
  match_confidence REAL,
  status TEXT NOT NULL DEFAULT 'ready',
  face_signature_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE (submission_id, face_index, face_signature_version)
);

CREATE INDEX IF NOT EXISTS idx_submission_faces_event_cluster
  ON submission_faces(event_id, cluster_id, face_signature_version);

CREATE INDEX IF NOT EXISTS idx_submission_faces_submission
  ON submission_faces(submission_id, face_signature_version);

CREATE TABLE IF NOT EXISTS event_face_clusters (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  representative_face_id TEXT,
  representative_submission_id TEXT,
  source_submission_ids TEXT NOT NULL DEFAULT '[]',
  face_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  face_signature_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_face_clusters_event
  ON event_face_clusters(event_id, face_signature_version, status);

CREATE TABLE IF NOT EXISTS event_group_hero_source_decisions (
  event_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  cluster_ids TEXT NOT NULL DEFAULT '[]',
  new_cluster_ids TEXT NOT NULL DEFAULT '[]',
  duplicate_cluster_ids TEXT NOT NULL DEFAULT '[]',
  guest_key TEXT,
  score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, submission_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);
