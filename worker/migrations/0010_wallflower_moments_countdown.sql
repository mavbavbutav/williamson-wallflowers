ALTER TABLE events
  ADD COLUMN event_start_at TEXT;

ALTER TABLE events
  ADD COLUMN countdown_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN countdown_message TEXT;
