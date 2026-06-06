ALTER TABLE submissions ADD COLUMN uploader_ip_address TEXT;

ALTER TABLE submission_media_insights ADD COLUMN exif_capture_time TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_city TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_region TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_precision TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_latitude REAL;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_longitude REAL;
ALTER TABLE submission_media_insights ADD COLUMN exif_gps_altitude_meters REAL;
ALTER TABLE submission_media_insights ADD COLUMN exif_camera_make TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_camera_model TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_lens_model TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_software TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_orientation TEXT;
ALTER TABLE submission_media_insights ADD COLUMN exif_metadata_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_submission_media_insights_exif_version
  ON submission_media_insights(event_id, exif_metadata_version, updated_at);
