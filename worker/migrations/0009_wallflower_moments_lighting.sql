CREATE TABLE IF NOT EXISTS wall_devices (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  bridge_token_hash TEXT NOT NULL,
  scan_preset_id INTEGER NOT NULL DEFAULT 2 CHECK (scan_preset_id BETWEEN 1 AND 250),
  submission_preset_id INTEGER NOT NULL DEFAULT 3 CHECK (submission_preset_id BETWEEN 1 AND 250),
  manual_preset_id INTEGER NOT NULL DEFAULT 4 CHECK (manual_preset_id BETWEEN 1 AND 250),
  brightness INTEGER NOT NULL DEFAULT 180 CHECK (brightness BETWEEN 1 AND 255),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wall_devices_event ON wall_devices(event_id);
CREATE INDEX IF NOT EXISTS idx_wall_devices_status ON wall_devices(status);
CREATE INDEX IF NOT EXISTS idx_wall_devices_last_seen ON wall_devices(last_seen_at);

CREATE TABLE IF NOT EXISTS light_triggers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  wall_device_id TEXT NOT NULL REFERENCES wall_devices(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('tag_scan', 'submission_received', 'manual_test')),
  preset_id INTEGER NOT NULL CHECK (preset_id BETWEEN 1 AND 250),
  brightness INTEGER NOT NULL CHECK (brightness BETWEEN 1 AND 255),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_light_triggers_device_status ON light_triggers(wall_device_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_light_triggers_event ON light_triggers(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_light_triggers_cleanup ON light_triggers(status, updated_at);

CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_events_event_created ON scan_events(event_id, created_at);
