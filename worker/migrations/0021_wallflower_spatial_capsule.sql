CREATE TABLE IF NOT EXISTS time_capsule_spatial_layouts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  generation_status TEXT NOT NULL DEFAULT 'ready',
  layout_mode TEXT NOT NULL DEFAULT 'timeline_path',
  confidence_score REAL NOT NULL DEFAULT 0,
  input_fingerprint TEXT NOT NULL DEFAULT '',
  generator_version INTEGER NOT NULL DEFAULT 1,
  error_message TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_layout_one_published
  ON time_capsule_spatial_layouts(event_id, status)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_spatial_layouts_event_status
  ON time_capsule_spatial_layouts(event_id, status, updated_at);

CREATE TABLE IF NOT EXISTS time_capsule_spatial_clusters (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  route_order INTEGER NOT NULL DEFAULT 0,
  anchor_x REAL NOT NULL DEFAULT 0,
  anchor_y REAL NOT NULL DEFAULT 0,
  anchor_z REAL NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spatial_clusters_layout_order
  ON time_capsule_spatial_clusters(layout_id, route_order);

CREATE TABLE IF NOT EXISTS time_capsule_spatial_placements (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  time_capsule_item_id TEXT NOT NULL,
  route_order INTEGER NOT NULL DEFAULT 0,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  position_z REAL NOT NULL DEFAULT 0,
  rotation_x REAL NOT NULL DEFAULT 0,
  rotation_y REAL NOT NULL DEFAULT 0,
  rotation_z REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1,
  confidence_score REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_placements_layout_item
  ON time_capsule_spatial_placements(layout_id, time_capsule_item_id);

CREATE INDEX IF NOT EXISTS idx_spatial_placements_layout_order
  ON time_capsule_spatial_placements(layout_id, route_order);
