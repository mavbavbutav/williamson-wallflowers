ALTER TABLE submission_media_insights ADD COLUMN exif_gps_country TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_county TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_postcode TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_display_name TEXT;
ALTER TABLE submission_media_insights ADD COLUMN reverse_geocoding_provider TEXT;
ALTER TABLE submission_media_insights ADD COLUMN reverse_geocoding_status TEXT NOT NULL DEFAULT '';
ALTER TABLE submission_media_insights ADD COLUMN reverse_geocoding_error TEXT;
ALTER TABLE submission_media_insights ADD COLUMN reverse_geocoded_at TEXT;
ALTER TABLE submission_media_insights ADD COLUMN reverse_geocoding_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_submission_media_insights_reverse_geocode
  ON submission_media_insights(event_id, reverse_geocoding_version, exif_gps_latitude, exif_gps_longitude);
