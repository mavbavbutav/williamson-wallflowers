import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import worker from '../src/index.js';

const BASE_ENV = {
  MOMENTS_ADMIN_TOKEN: 'admin-token',
  MOMENTS_TOKEN_SECRET: 'test-secret',
  PUBLIC_SITE_URL: 'https://williamsonwallflowers.com',
  MOMENTS_API_URL: 'https://api.example.com',
  ALLOWED_ORIGINS: 'https://williamsonwallflowers.com',
  OPENAI_API_KEY: 'openai-test-key',
  REVERSE_GEOCODING_ENABLED: 'false'
};

test('media audit migration creates submission insights and event profiles', async () => {
  const migration = await readFile(new URL('../migrations/0016_wallflower_media_audit.sql', import.meta.url), 'utf8');
  const exifMigration = await readFile(new URL('../migrations/0017_wallflower_media_exif_audit.sql', import.meta.url), 'utf8');
  const reverseGeocodeMigration = await readFile(new URL('../migrations/0018_wallflower_media_reverse_geocode.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS submission_media_insights/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_media_profiles/);
  assert.match(migration, /vision_status TEXT NOT NULL DEFAULT 'not_requested'/);
  assert.match(migration, /idx_submission_media_insights_event/);
  assert.match(exifMigration, /uploader_ip_address TEXT/);
  assert.match(exifMigration, /exif_capture_time TEXT/);
  assert.match(exifMigration, /exif_gps_city TEXT/);
  assert.match(exifMigration, /exif_gps_region TEXT/);
  assert.match(exifMigration, /exif_gps_precision TEXT/);
  assert.match(exifMigration, /exif_metadata_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(reverseGeocodeMigration, /exif_gps_country TEXT/);
  assert.match(reverseGeocodeMigration, /exif_gps_display_name TEXT/);
  assert.match(reverseGeocodeMigration, /reverse_geocoding_status TEXT NOT NULL DEFAULT ''/);
  assert.match(reverseGeocodeMigration, /reverse_geocoding_version INTEGER NOT NULL DEFAULT 0/);
});

test('admin frontend exposes the private media audit report controls', async () => {
  const adminHtml = await readFile(new URL('../../moments/admin/index.html', import.meta.url), 'utf8');
  const adminJs = await readFile(new URL('../../moments/admin/admin.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../../moments/styles.css', import.meta.url), 'utf8');

  assert.match(adminHtml, /id="mediaAuditPanel"/);
  assert.match(adminHtml, /Run AI vision audit/);
  assert.match(adminHtml, /Location cues/);
  assert.match(adminHtml, /id="mediaAuditFaceBoxesToggle"/);
  assert.match(adminHtml, /id="mediaAuditFaceSummary"/);
  assert.match(adminHtml, /admin\.js\?v=20260607-face-toggle-1/);
  assert.match(adminHtml, /styles\.css\?v=20260607-face-toggle-1/);
  assert.match(adminJs, /\/admin\/events\/\$\{encodeURIComponent\(eventId\)\}\/media-audit/);
  assert.match(adminJs, /previewUrl/);
  assert.match(adminJs, /EXIF and upload/);
  assert.match(adminJs, /Face dedupe/);
  assert.match(adminJs, /renderMediaAuditFaceBoxes/);
  assert.match(adminJs, /buildMediaAuditFaceDedupeFacts/);
  assert.match(adminJs, /getFaceDisplayId/);
  assert.match(adminJs, /getDisplayFaceBoundingBox/);
  assert.match(adminJs, /getMediaAuditDisplayDimensions/);
  assert.match(adminJs, /isExifOrientationSwapped/);
  assert.doesNotMatch(adminJs, /case "6":/);
  assert.match(adminJs, /uploader IP/);
  assert.match(adminJs, /includeAi/);
  assert.match(adminJs, /exifGpsDisplayName/);
  assert.match(adminJs, /reverseGeocodingStatus/);
  assert.match(adminJs, /mediaAuditFaceBoxesToggle"\)\.addEventListener\("change", \(\) => renderMediaAudit\(\)\)/);
  assert.doesNotMatch(adminJs, /mediaAuditFaceBoxesToggle"\)\.addEventListener\("change", renderMediaAudit\)/);
  assert.match(styles, /\.media-audit-panel/);
  assert.match(styles, /\.media-audit-preview/);
  assert.match(styles, /\.media-audit-face-box/);
  assert.match(styles, /object-fit:\s*fill/);
  assert.doesNotMatch(styles, /\.media-audit-preview img\s*\{[^}]*object-fit:\s*cover/s);
});

test('media audit backfill is admin-only and rejects host tokens', async () => {
  const db = new MediaAuditFakeDb();
  const env = envWithDb(db, new FakeBucket());

  const hostResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-audit/media-audit/backfill', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer host-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 2 })
  }), env);
  const adminResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'wrong-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 2 })
  }), env);

  assert.equal(hostResponse.status, 404);
  assert.equal(adminResponse.status, 401);
  assert.equal(db.insights.length, 0);
});

test('event admin token can access only the scoped media audit endpoint', async () => {
  const photo = submission({
    id: 'photo-1',
    object_key: 'moments/event-audit/photo-1.png',
    mime_type: 'image/png',
    size: pngBytes(320, 240).byteLength
  });
  const db = new MediaAuditFakeDb({ submissions: [photo] });
  const env = envWithDb(db, new FakeBucket([[photo.object_key, pngBytes(320, 240)]]));
  const waitUntil = [];

  const overviewResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/overview', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'event-admin-token'
    }
  }), env);
  const backfillResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'event-admin-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 1 })
  }), env, { waitUntil: (work) => waitUntil.push(work) });

  assert.equal(overviewResponse.status, 401);
  assert.equal(backfillResponse.status, 202);
  await drainWaitUntil(waitUntil);
  assert.equal(db.insights.length, 1);
});

test('event admin token cannot access another event media audit', async () => {
  const db = new MediaAuditFakeDb({
    events: [
      eventRecord({ id: 'event-audit', adminToken: 'event-admin-token' }),
      eventRecord({ id: 'other-event', adminToken: 'other-admin-token' })
    ]
  });
  const env = envWithDb(db, new FakeBucket());

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/other-event/media-audit', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'event-admin-token'
    }
  }), env);

  assert.equal(response.status, 401);
});

test('admin media audit backfill analyzes approved photos and video thumbnails', async () => {
  const photo = submission({
    id: 'photo-1',
    media_type: 'photo',
    object_key: 'moments/event-audit/photo-1.png',
    mime_type: 'image/png',
    size: pngBytes(640, 480).byteLength
  });
  const video = submission({
    id: 'video-1',
    media_type: 'video',
    object_key: 'moments/event-audit/video-1.mp4',
    mime_type: 'video/mp4',
    thumbnail_object_key: 'moments/event-audit/thumbnails/video-1.jpg',
    thumbnail_mime_type: 'image/jpeg',
    thumbnail_size: jpegBytes(800, 600).byteLength
  });
  const pending = submission({
    id: 'pending-photo',
    status: 'pending',
    object_key: 'moments/event-audit/pending.png'
  });
  const db = new MediaAuditFakeDb({ submissions: [photo, video, pending] });
  const bucket = new FakeBucket([
    [photo.object_key, pngBytes(640, 480)],
    [video.thumbnail_object_key, jpegBytes(800, 600)]
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'admin-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 5 })
  }), env, { waitUntil: (work) => waitUntil.push(work) });
  const payload = await response.json();

  assert.equal(response.status, 202);
  assert.equal(payload.queued, 2);
  await drainWaitUntil(waitUntil);

  assert.equal(db.insights.length, 2);
  const photoInsight = db.insights.find((row) => row.submission_id === 'photo-1');
  const videoInsight = db.insights.find((row) => row.submission_id === 'video-1');
  assert.equal(photoInsight.status, 'analyzed');
  assert.equal(photoInsight.format, 'png');
  assert.equal(photoInsight.width, 640);
  assert.equal(photoInsight.height, 480);
  assert.equal(videoInsight.source_kind, 'video_thumbnail');
  assert.equal(videoInsight.format, 'jpeg');
  assert.equal(videoInsight.width, 800);
  assert.equal(videoInsight.height, 600);
  assert.equal(db.profiles[0].analyzed_count, 2);
  assert.equal(db.profiles[0].photo_count, 1);
  assert.equal(db.profiles[0].video_thumbnail_count, 1);
});

test('admin media audit can return stored profile and insight rows', async () => {
  const db = new MediaAuditFakeDb({
    submissions: [submission({ id: 'photo-1' })],
    insights: [insight({ submission_id: 'photo-1', width: 1024, height: 768 })],
    profiles: [profile({ submission_count: 1, analyzed_count: 1, photo_count: 1 })],
    faceAnalyses: [faceAnalysis({ submission_id: 'photo-1', face_count: 1 })],
    faces: [
      faceRow({
        id: 'face-photo-1',
        submission_id: 'photo-1',
        cluster_id: 'face-matchabc123',
        bounding_box_json: JSON.stringify({ Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 }),
        match_confidence: 98.7
      }),
      faceRow({
        id: 'face-photo-2',
        submission_id: 'photo-2',
        cluster_id: 'face-matchabc123'
      })
    ],
    sourceDecisions: [sourceDecision({
      submission_id: 'photo-1',
      decision: 'selected',
      reason: 'new-face-cluster',
      cluster_ids: JSON.stringify(['face-matchabc123']),
      new_cluster_ids: JSON.stringify(['face-matchabc123'])
    })]
  });
  const env = envWithDb(db, new FakeBucket());

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'admin-token'
    }
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.audit.profile.analyzedCount, 1);
  assert.equal(payload.audit.faceDedupe.detectedFaces, 2);
  assert.equal(payload.audit.faceDedupe.uniqueFaceClusters, 1);
  assert.equal(payload.audit.faceDedupe.selectedSources, 1);
  assert.equal(payload.audit.insights.length, 1);
  assert.equal(payload.audit.insights[0].width, 1024);
  assert.equal(payload.audit.insights[0].displayAspectRatio, 1.3333);
  assert.equal(payload.audit.insights[0].previewKind, 'photo');
  assert.match(payload.audit.insights[0].previewUrl, /^https:\/\/api\.example\.com\/moments-api\/media\/photo-1\?mediaToken=/);
  assert.equal(payload.audit.insights[0].visionStatus, 'not_requested');
  assert.equal(payload.audit.insights[0].faceAnalysis.status, 'ready');
  assert.equal(payload.audit.insights[0].faceDedupe.decision, 'selected');
  assert.equal(payload.audit.insights[0].faces.length, 1);
  assert.equal(payload.audit.insights[0].faces[0].matched, true);
  assert.deepEqual(payload.audit.insights[0].faces[0].boundingBox, {
    left: 0.1,
    top: 0.2,
    width: 0.3,
    height: 0.4
  });
});

test('admin media audit backfill extracts JPEG EXIF capture, camera, and GPS metadata', async () => {
  const bytes = jpegWithExifBytes(640, 480);
  const photo = submission({
    id: 'exif-photo',
    object_key: 'moments/event-audit/exif-photo.jpg',
    mime_type: 'image/jpeg',
    size: bytes.byteLength,
    uploader_ip_address: '203.0.113.24',
    uploaderIpAddress: '203.0.113.24'
  });
  const db = new MediaAuditFakeDb({ submissions: [photo] });
  const env = envWithDb(db, new FakeBucket([[photo.object_key, bytes]]));
  const waitUntil = [];

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'admin-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 5 })
  }), env, { waitUntil: (work) => waitUntil.push(work) });

  assert.equal(response.status, 202);
  await drainWaitUntil(waitUntil);

  const insightRow = db.insights.find((row) => row.submission_id === 'exif-photo');
  assert.equal(insightRow.exif_capture_time, '2026-06-06T14:30:00');
  assert.equal(insightRow.exif_camera_make, 'Apple');
  assert.equal(insightRow.exif_camera_model, 'iPhone 15');
  assert.equal(insightRow.exif_lens_model, 'Main Camera');
  assert.equal(insightRow.exif_gps_precision, '12m');
  assert.equal(insightRow.exif_metadata_version, 1);
  assert.ok(Math.abs(insightRow.exif_gps_latitude - 36.123333) < 0.00001);
  assert.ok(Math.abs(insightRow.exif_gps_longitude + 86.67) < 0.00001);

  const report = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'admin-token'
    }
  }), env);
  const payload = await report.json();
  const insight = payload.audit.insights[0];
  assert.equal(insight.exifCaptureTime, '2026-06-06T14:30:00');
  assert.equal(insight.exifCameraMake, 'Apple');
  assert.equal(insight.uploaderIpAddress, '203.0.113.24');
  assert.equal(insight.exifMetadataVersion, 1);
});

test('admin media audit backfill reverse geocodes embedded GPS metadata', async () => {
  const bytes = jpegWithExifBytes(640, 480);
  const photo = submission({
    id: 'gps-photo',
    object_key: 'moments/event-audit/gps-photo.jpg',
    mime_type: 'image/jpeg',
    size: bytes.byteLength
  });
  const db = new MediaAuditFakeDb({ submissions: [photo] });
  const env = envWithDb(db, new FakeBucket([[photo.object_key, bytes]]), {
    REVERSE_GEOCODING_ENABLED: 'true'
  });
  const waitUntil = [];
  const calls = mockReverseGeocode();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        'X-Admin-Token': 'admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ limit: 5 })
    }), env, { waitUntil: (work) => waitUntil.push(work) });

    assert.equal(response.status, 202);
    await drainWaitUntil(waitUntil);
  } finally {
    restoreFetch();
  }

  assert.equal(calls.length, 1);
  const geocodeUrl = new URL(calls[0].url);
  assert.equal(geocodeUrl.searchParams.get('format'), 'jsonv2');
  assert.equal(geocodeUrl.searchParams.get('addressdetails'), '1');

  const insightRow = db.insights.find((row) => row.submission_id === 'gps-photo');
  assert.equal(insightRow.exif_gps_city, 'Nashville');
  assert.equal(insightRow.exif_gps_region, 'Tennessee');
  assert.equal(insightRow.exif_gps_country, 'United States');
  assert.equal(insightRow.exif_gps_county, 'Davidson County');
  assert.equal(insightRow.exif_gps_postcode, '37201');
  assert.equal(insightRow.exif_gps_display_name, 'Nashville, Davidson County, Tennessee, 37201, United States');
  assert.equal(insightRow.reverse_geocoding_provider, 'nominatim');
  assert.equal(insightRow.reverse_geocoding_status, 'ready');
  assert.equal(insightRow.reverse_geocoding_version, 1);
  assert.match(insightRow.reverse_geocoded_at, /^\d{4}-\d{2}-\d{2}T/);

  const report = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'admin-token'
    }
  }), env);
  const payload = await report.json();
  const insight = payload.audit.insights[0];
  assert.equal(insight.exifGpsCity, 'Nashville');
  assert.equal(insight.exifGpsRegion, 'Tennessee');
  assert.equal(insight.exifGpsCountry, 'United States');
  assert.equal(insight.exifGpsDisplayName, 'Nashville, Davidson County, Tennessee, 37201, United States');
  assert.equal(insight.reverseGeocodingStatus, 'ready');
});

test('metadata-only media audit backfill preserves existing AI vision fields', async () => {
  const bytes = jpegWithExifBytes(640, 480);
  const photo = submission({
    id: 'vision-photo',
    object_key: 'moments/event-audit/vision-photo.jpg',
    mime_type: 'image/jpeg',
    size: bytes.byteLength
  });
  const db = new MediaAuditFakeDb({
    submissions: [photo],
    insights: [insight({
      submission_id: 'vision-photo',
      vision_status: 'ready',
      vision_model: 'gpt-4.1-mini',
      people_count: 3,
      face_count: 2,
      scene_tags: JSON.stringify(['lake house']),
      lighting_tags: JSON.stringify(['warm light']),
      background_cues: JSON.stringify(['oak ridge']),
      summary: 'existing vision summary',
      exif_metadata_version: 0
    })]
  });
  const env = envWithDb(db, new FakeBucket([[photo.object_key, bytes]]));
  const waitUntil = [];

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'X-Admin-Token': 'admin-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ limit: 5, includeAi: false })
  }), env, { waitUntil: (work) => waitUntil.push(work) });

  assert.equal(response.status, 202);
  await drainWaitUntil(waitUntil);

  const insightRow = db.insights.find((row) => row.submission_id === 'vision-photo');
  assert.equal(insightRow.vision_status, 'ready');
  assert.equal(insightRow.vision_model, 'gpt-4.1-mini');
  assert.equal(insightRow.people_count, 3);
  assert.equal(insightRow.summary, 'existing vision summary');
  assert.deepEqual(JSON.parse(insightRow.scene_tags), ['lake house']);
  assert.equal(insightRow.exif_capture_time, '2026-06-06T14:30:00');
  assert.equal(insightRow.exif_metadata_version, 1);
});

test('optional media audit vision only sends AI-eligible guest media and host media', async () => {
  const aiGuest = submission({
    id: 'ai-guest',
    object_key: 'moments/event-audit/ai-guest.jpg',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z'
  });
  const privateGuest = submission({
    id: 'private-guest',
    object_key: 'moments/event-audit/private-guest.jpg',
    ai_artwork_consent_at: null,
    aiArtworkConsentAt: null
  });
  const host = submission({
    id: 'host-photo',
    source: 'host',
    object_key: 'moments/event-audit/host-photo.jpg',
    ai_artwork_consent_at: null
  });
  const db = new MediaAuditFakeDb({ submissions: [aiGuest, privateGuest, host] });
  const bucket = new FakeBucket([
    [aiGuest.object_key, jpegBytes(640, 480)],
    [privateGuest.object_key, jpegBytes(640, 480)],
    [host.object_key, jpegBytes(640, 480)]
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAiMediaAudit();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-audit/media-audit/backfill', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        'X-Admin-Token': 'admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ limit: 5, includeAi: true })
    }), env, { waitUntil: (work) => waitUntil.push(work) });

    assert.equal(response.status, 202);
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 2);
    assert.equal(db.insights.find((row) => row.submission_id === 'ai-guest').vision_status, 'ready');
    assert.equal(db.insights.find((row) => row.submission_id === 'host-photo').vision_status, 'ready');
    assert.equal(db.insights.find((row) => row.submission_id === 'private-guest').vision_status, 'not_allowed');
    assert.equal(db.profiles[0].ai_analyzed_count, 2);
    assert.deepEqual(JSON.parse(db.profiles[0].scene_tags), ['floral wall', 'group portrait']);
  } finally {
    restoreFetch();
  }
});

function envWithDb(db, bucket, overrides = {}) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: bucket,
    ...overrides
  };
}

function submission(overrides = {}) {
  return {
    id: 'photo-1',
    event_id: 'event-audit',
    eventId: 'event-audit',
    media_type: 'photo',
    mediaType: 'photo',
    source: 'guest',
    object_key: 'moments/event-audit/photo-1.jpg',
    objectKey: 'moments/event-audit/photo-1.jpg',
    original_filename: 'photo-1.jpg',
    originalFilename: 'photo-1.jpg',
    mime_type: 'image/jpeg',
    mimeType: 'image/jpeg',
    size: 1200,
    thumbnail_object_key: null,
    thumbnailObjectKey: null,
    thumbnail_mime_type: null,
    thumbnailMimeType: null,
    thumbnail_size: 0,
    thumbnailSize: 0,
    uploader_ip_address: '',
    uploaderIpAddress: '',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    status: 'approved',
    deleted_at: null,
    deletedAt: null,
    created_at: '2026-09-19T20:20:00.000Z',
    createdAt: '2026-09-19T20:20:00.000Z',
    updated_at: '2026-09-19T20:20:00.000Z',
    updatedAt: '2026-09-19T20:20:00.000Z',
    ...overrides
  };
}

function eventRecord(overrides = {}) {
  return {
    id: 'event-audit',
    name: 'Media Audit Test',
    eventDate: '2026-09-19',
    eventStartAt: null,
    countdownEnabled: 0,
    countdownMessage: 'Party starts in',
    guestUploadsBeforeCountdownEnabled: 0,
    partyViewSwipeEnabled: 0,
    autoApprovePartyViewEnabled: 0,
    autoApproveTimeCapsuleEnabled: 0,
    hostName: 'Taylor',
    hostEmail: 'taylor@example.com',
    hostToken: 'host-token',
    adminToken: 'event-admin-token',
    status: 'active',
    retentionExpiresAt: '2027-09-19T23:59:59.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    timeCapsuleEnabled: true,
    timeCapsuleStatus: 'published',
    timeCapsuleTitle: 'Media Audit Test Time Capsule',
    timeCapsuleShareToken: 'share-token',
    timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
  };
}

function insight(overrides = {}) {
  return {
    submission_id: 'photo-1',
    event_id: 'event-audit',
    status: 'analyzed',
    source_kind: 'photo',
    source_object_key: 'moments/event-audit/photo-1.jpg',
    mime_type: 'image/jpeg',
    format: 'jpeg',
    size: 1200,
    width: 640,
    height: 480,
    orientation: 'landscape',
    quality_score: 0.75,
    vision_status: 'not_requested',
    vision_model: '',
    people_count: null,
    face_count: null,
    dominant_colors: '[]',
    scene_tags: '[]',
    lighting_tags: '[]',
    composition_tags: '[]',
    background_cues: '[]',
    visible_text: '',
    summary: '',
    skip_reason: '',
    error_message: '',
    exif_capture_time: '',
    exif_gps_city: '',
    exif_gps_region: '',
    exif_gps_precision: '',
    exif_gps_latitude: null,
    exif_gps_longitude: null,
    exif_gps_altitude_meters: null,
    exif_gps_country: '',
    exif_gps_county: '',
    exif_gps_postcode: '',
    exif_gps_display_name: '',
    reverse_geocoding_provider: '',
    reverse_geocoding_status: 'no_gps',
    reverse_geocoding_error: '',
    reverse_geocoded_at: '',
    reverse_geocoding_version: 1,
    exif_camera_make: '',
    exif_camera_model: '',
    exif_lens_model: '',
    exif_software: '',
    exif_orientation: '',
    exif_metadata_version: 1,
    analyzed_at: '2026-09-19T20:30:00.000Z',
    created_at: '2026-09-19T20:30:00.000Z',
    updated_at: '2026-09-19T20:30:00.000Z',
    ...overrides
  };
}

function profile(overrides = {}) {
  return {
    event_id: 'event-audit',
    status: 'ready',
    submission_count: 0,
    analyzed_count: 0,
    skipped_count: 0,
    failed_count: 0,
    photo_count: 0,
    video_thumbnail_count: 0,
    ai_analyzed_count: 0,
    people_count: 0,
    face_count: 0,
    average_quality_score: 0,
    dominant_colors: '[]',
    scene_tags: '[]',
    lighting_tags: '[]',
    composition_tags: '[]',
    background_cues: '[]',
    profile_summary: '',
    generated_at: '2026-09-19T20:30:00.000Z',
    created_at: '2026-09-19T20:30:00.000Z',
    updated_at: '2026-09-19T20:30:00.000Z',
    ...overrides
  };
}

function faceAnalysis(overrides = {}) {
  return {
    submission_id: 'photo-1',
    event_id: 'event-audit',
    source_object_key: 'moments/event-audit/photo-1.jpg',
    provider: 'aws-rekognition',
    status: 'ready',
    face_count: 1,
    error_message: '',
    face_signature_version: 1,
    analyzed_at: '2026-09-19T20:31:00.000Z',
    created_at: '2026-09-19T20:31:00.000Z',
    updated_at: '2026-09-19T20:31:00.000Z',
    ...overrides
  };
}

function faceRow(overrides = {}) {
  return {
    id: 'face-photo-1',
    event_id: 'event-audit',
    submission_id: 'photo-1',
    face_index: 0,
    provider: 'aws-rekognition',
    provider_face_id: 'provider-face-1',
    cluster_id: 'face-unique123456',
    confidence: 99.2,
    bounding_box_json: JSON.stringify({ Left: 0.2, Top: 0.2, Width: 0.4, Height: 0.4 }),
    quality_json: JSON.stringify({ Brightness: 80, Sharpness: 92 }),
    match_confidence: 0,
    status: 'ready',
    face_signature_version: 1,
    created_at: '2026-09-19T20:31:00.000Z',
    updated_at: '2026-09-19T20:31:00.000Z',
    ...overrides
  };
}

function sourceDecision(overrides = {}) {
  return {
    event_id: 'event-audit',
    submission_id: 'photo-1',
    decision: 'selected',
    reason: 'new-face-cluster',
    cluster_ids: JSON.stringify(['face-unique123456']),
    new_cluster_ids: JSON.stringify(['face-unique123456']),
    duplicate_cluster_ids: '[]',
    guest_key: '',
    score: 0.75,
    created_at: '2026-09-19T20:32:00.000Z',
    ...overrides
  };
}

class FakeBucket {
  constructor(seed = []) {
    this.objects = new Map(seed.map(([key, value]) => [key, toBytes(value)]));
  }

  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      size: bytes.byteLength,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  }
}

class MediaAuditFakeDb {
  constructor(seed = {}) {
    this.events = seed.events ? seed.events.map((item) => ({ ...item })) : [eventRecord()];
    this.submissions = seed.submissions ? seed.submissions.map((item) => ({ ...item })) : [];
    this.insights = seed.insights ? seed.insights.map((item) => ({ ...item })) : [];
    this.profiles = seed.profiles ? seed.profiles.map((item) => ({ ...item })) : [];
    this.faceAnalyses = seed.faceAnalyses ? seed.faceAnalyses.map((item) => ({ ...item })) : [];
    this.faces = seed.faces ? seed.faces.map((item) => ({ ...item })) : [];
    this.faceClusters = seed.faceClusters ? seed.faceClusters.map((item) => ({ ...item })) : [];
    this.sourceDecisions = seed.sourceDecisions ? seed.sourceDecisions.map((item) => ({ ...item })) : [];
  }

  prepare(sql) {
    return new MediaAuditFakeStatement(this, sql);
  }
}

class MediaAuditFakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ? AND host_token = ?')) {
      return this.db.events.find((event) => event.id === this.params[0] && event.hostToken === this.params[1]) || null;
    }

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ?')) {
      return this.db.events.find((event) => event.id === this.params[0]) || null;
    }

    if (this.sql.includes('FROM event_media_profiles')) {
      return this.db.profiles.find((profileRow) => profileRow.event_id === this.params[0] || profileRow.eventId === this.params[0]) || null;
    }

    if (this.sql.includes('submission_face_analyses') && this.sql.includes('event_group_hero_source_decisions')) {
      const eventId = this.params[0];
      const analyses = this.db.faceAnalyses.filter((row) => (row.event_id || row.eventId) === eventId);
      const readyFaces = this.db.faces.filter((row) => (row.event_id || row.eventId) === eventId && (row.status || 'ready') === 'ready');
      const decisions = this.db.sourceDecisions.filter((row) => (row.event_id || row.eventId) === eventId);
      const clusters = new Set(readyFaces.map((row) => row.cluster_id || row.clusterId).filter(Boolean));
      const storedClusters = this.db.faceClusters.filter((row) => (row.event_id || row.eventId) === eventId && (row.status || 'ready') === 'ready');
      return {
        analyzedSubmissions: analyses.length,
        readyAnalyses: analyses.filter((row) => row.status === 'ready').length,
        failedAnalyses: analyses.filter((row) => row.status === 'failed').length,
        detectedFaces: readyFaces.length,
        uniqueFaceClusters: clusters.size,
        storedFaceClusters: storedClusters.length,
        selectedSources: decisions.filter((row) => row.decision === 'selected').length,
        skippedSources: decisions.filter((row) => row.decision === 'skipped').length,
        latestDecisionAt: decisions.reduce((latest, row) => String(row.created_at || row.createdAt || '').localeCompare(latest) > 0 ? row.created_at || row.createdAt || '' : latest, '')
      };
    }

    if (this.sql.includes('FROM submission_media_insights') && this.sql.includes('WHERE submission_id = ?')) {
      const row = this.db.insights.find((item) => item.submission_id === this.params[0] || item.submissionId === this.params[0]);
      if (!row) return null;
      return {
        visionStatus: row.vision_status || row.visionStatus,
        visionModel: row.vision_model || row.visionModel,
        peopleCount: row.people_count ?? row.peopleCount,
        faceCount: row.face_count ?? row.faceCount,
        dominantColors: row.dominant_colors || row.dominantColors,
        sceneTags: row.scene_tags || row.sceneTags,
        lightingTags: row.lighting_tags || row.lightingTags,
        compositionTags: row.composition_tags || row.compositionTags,
        backgroundCues: row.background_cues || row.backgroundCues,
        visibleText: row.visible_text || row.visibleText,
        summary: row.summary || '',
        errorMessage: row.error_message || row.errorMessage
      };
    }

    if (this.sql.includes('COUNT(*) AS count') && this.sql.includes('LEFT JOIN submission_media_insights')) {
      return { count: this.mediaAuditCandidates().length };
    }

    return null;
  }

  async all() {
    if (this.sql.includes('FROM submissions s') && this.sql.includes('LEFT JOIN submission_media_insights')) {
      return { results: this.mediaAuditCandidates().slice(0, Number(this.params[4] || 10)) };
    }

    if (this.sql.includes('FROM submission_media_insights i') && this.sql.includes('INNER JOIN submissions s')) {
      const eventId = this.params[0];
      return {
        results: this.db.insights
          .filter((row) => row.event_id === eventId || row.eventId === eventId)
          .map((row) => {
            const submissionRow = this.db.submissions.find((item) => item.id === row.submission_id || item.id === row.submissionId);
            return {
              ...row,
              submissionId: row.submission_id || row.submissionId,
              eventId: row.event_id || row.eventId,
              sourceKind: row.source_kind || row.sourceKind,
              sourceObjectKey: row.source_object_key || row.sourceObjectKey,
              mimeType: row.mime_type || row.mimeType,
              qualityScore: row.quality_score || row.qualityScore,
              visionStatus: row.vision_status || row.visionStatus,
              visionModel: row.vision_model || row.visionModel,
              peopleCount: row.people_count ?? row.peopleCount,
              faceCount: row.face_count ?? row.faceCount,
              dominantColors: row.dominant_colors || row.dominantColors,
              sceneTags: row.scene_tags || row.sceneTags,
              lightingTags: row.lighting_tags || row.lightingTags,
              compositionTags: row.composition_tags || row.compositionTags,
              backgroundCues: row.background_cues || row.backgroundCues,
              visibleText: row.visible_text || row.visibleText,
              skipReason: row.skip_reason || row.skipReason,
              errorMessage: row.error_message || row.errorMessage,
              exifCaptureTime: row.exif_capture_time || row.exifCaptureTime,
              exifGpsCity: row.exif_gps_city || row.exifGpsCity,
              exifGpsRegion: row.exif_gps_region || row.exifGpsRegion,
              exifGpsPrecision: row.exif_gps_precision || row.exifGpsPrecision,
              exifGpsLatitude: row.exif_gps_latitude ?? row.exifGpsLatitude,
              exifGpsLongitude: row.exif_gps_longitude ?? row.exifGpsLongitude,
              exifGpsAltitudeMeters: row.exif_gps_altitude_meters ?? row.exifGpsAltitudeMeters,
              exifGpsCountry: row.exif_gps_country || row.exifGpsCountry,
              exifGpsCounty: row.exif_gps_county || row.exifGpsCounty,
              exifGpsPostcode: row.exif_gps_postcode || row.exifGpsPostcode,
              exifGpsDisplayName: row.exif_gps_display_name || row.exifGpsDisplayName,
              reverseGeocodingProvider: row.reverse_geocoding_provider || row.reverseGeocodingProvider,
              reverseGeocodingStatus: row.reverse_geocoding_status || row.reverseGeocodingStatus,
              reverseGeocodingError: row.reverse_geocoding_error || row.reverseGeocodingError,
              reverseGeocodedAt: row.reverse_geocoded_at || row.reverseGeocodedAt,
              reverseGeocodingVersion: row.reverse_geocoding_version || row.reverseGeocodingVersion,
              exifCameraMake: row.exif_camera_make || row.exifCameraMake,
              exifCameraModel: row.exif_camera_model || row.exifCameraModel,
              exifLensModel: row.exif_lens_model || row.exifLensModel,
              exifSoftware: row.exif_software || row.exifSoftware,
              exifOrientation: row.exif_orientation || row.exifOrientation,
              exifMetadataVersion: row.exif_metadata_version || row.exifMetadataVersion,
              analyzedAt: row.analyzed_at || row.analyzedAt,
              updatedAt: row.updated_at || row.updatedAt,
              mediaType: submissionRow?.media_type || submissionRow?.mediaType,
              source: submissionRow?.source || 'guest',
              originalFilename: submissionRow?.original_filename || submissionRow?.originalFilename,
              guestName: submissionRow?.guest_name || submissionRow?.guestName,
              guestNote: submissionRow?.guest_note || submissionRow?.guestNote,
              uploaderIpAddress: submissionRow?.uploader_ip_address || submissionRow?.uploaderIpAddress,
              thumbnailObjectKey: submissionRow?.thumbnail_object_key || submissionRow?.thumbnailObjectKey,
              thumbnailMimeType: submissionRow?.thumbnail_mime_type || submissionRow?.thumbnailMimeType,
              submissionCreatedAt: submissionRow?.created_at || submissionRow?.createdAt
            };
          })
      };
    }

    if (this.sql.includes('FROM submission_face_analyses') && this.sql.includes('WHERE event_id = ?')) {
      const eventId = this.params[0];
      return {
        results: this.db.faceAnalyses.filter((row) => (row.event_id || row.eventId) === eventId)
      };
    }

    if (this.sql.includes('FROM submission_faces') && this.sql.includes('WHERE event_id = ?')) {
      const eventId = this.params[0];
      return {
        results: this.db.faces.filter((row) => (row.event_id || row.eventId) === eventId && (row.status || 'ready') === 'ready')
      };
    }

    if (this.sql.includes('FROM event_group_hero_source_decisions') && this.sql.includes('WHERE event_id = ?')) {
      const eventId = this.params[0];
      return {
        results: this.db.sourceDecisions.filter((row) => (row.event_id || row.eventId) === eventId)
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes('INSERT INTO submission_media_insights')) {
      const [
        submissionId,
        eventId,
        status,
        sourceKind,
        sourceObjectKey,
        mimeType,
        format,
        size,
        width,
        height,
        orientation,
        qualityScore,
        visionStatus,
        visionModel,
        peopleCount,
        faceCount,
        dominantColors,
        sceneTags,
        lightingTags,
        compositionTags,
        backgroundCues,
        visibleText,
        summary,
        skipReason,
        errorMessage,
        exifCaptureTime,
        exifGpsCity,
        exifGpsRegion,
        exifGpsPrecision,
        exifGpsLatitude,
        exifGpsLongitude,
        exifGpsAltitudeMeters,
        exifGpsCountry,
        exifGpsCounty,
        exifGpsPostcode,
        exifGpsDisplayName,
        reverseGeocodingProvider,
        reverseGeocodingStatus,
        reverseGeocodingError,
        reverseGeocodedAt,
        reverseGeocodingVersion,
        exifCameraMake,
        exifCameraModel,
        exifLensModel,
        exifSoftware,
        exifOrientation,
        exifMetadataVersion,
        analyzedAt,
        createdAt,
        updatedAt
      ] = this.params;
      const row = {
        submission_id: submissionId,
        event_id: eventId,
        status,
        source_kind: sourceKind,
        source_object_key: sourceObjectKey,
        mime_type: mimeType,
        format,
        size,
        width,
        height,
        orientation,
        quality_score: qualityScore,
        vision_status: visionStatus,
        vision_model: visionModel,
        people_count: peopleCount,
        face_count: faceCount,
        dominant_colors: dominantColors,
        scene_tags: sceneTags,
        lighting_tags: lightingTags,
        composition_tags: compositionTags,
        background_cues: backgroundCues,
        visible_text: visibleText,
        summary,
        skip_reason: skipReason,
        error_message: errorMessage,
        exif_capture_time: exifCaptureTime,
        exif_gps_city: exifGpsCity,
        exif_gps_region: exifGpsRegion,
        exif_gps_precision: exifGpsPrecision,
        exif_gps_latitude: exifGpsLatitude,
        exif_gps_longitude: exifGpsLongitude,
        exif_gps_altitude_meters: exifGpsAltitudeMeters,
        exif_gps_country: exifGpsCountry,
        exif_gps_county: exifGpsCounty,
        exif_gps_postcode: exifGpsPostcode,
        exif_gps_display_name: exifGpsDisplayName,
        reverse_geocoding_provider: reverseGeocodingProvider,
        reverse_geocoding_status: reverseGeocodingStatus,
        reverse_geocoding_error: reverseGeocodingError,
        reverse_geocoded_at: reverseGeocodedAt,
        reverse_geocoding_version: reverseGeocodingVersion,
        exif_camera_make: exifCameraMake,
        exif_camera_model: exifCameraModel,
        exif_lens_model: exifLensModel,
        exif_software: exifSoftware,
        exif_orientation: exifOrientation,
        exif_metadata_version: exifMetadataVersion,
        analyzed_at: analyzedAt,
        created_at: createdAt,
        updated_at: updatedAt
      };
      const index = this.db.insights.findIndex((item) => item.submission_id === submissionId);
      if (index >= 0) this.db.insights[index] = row;
      else this.db.insights.push(row);
    }

    if (this.sql.includes('INSERT INTO event_media_profiles')) {
      const [
        eventId,
        status,
        submissionCount,
        analyzedCount,
        skippedCount,
        failedCount,
        photoCount,
        videoThumbnailCount,
        aiAnalyzedCount,
        peopleCount,
        faceCount,
        averageQualityScore,
        dominantColors,
        sceneTags,
        lightingTags,
        compositionTags,
        backgroundCues,
        profileSummary,
        generatedAt,
        createdAt,
        updatedAt
      ] = this.params;
      const row = {
        event_id: eventId,
        status,
        submission_count: submissionCount,
        analyzed_count: analyzedCount,
        skipped_count: skippedCount,
        failed_count: failedCount,
        photo_count: photoCount,
        video_thumbnail_count: videoThumbnailCount,
        ai_analyzed_count: aiAnalyzedCount,
        people_count: peopleCount,
        face_count: faceCount,
        average_quality_score: averageQualityScore,
        dominant_colors: dominantColors,
        scene_tags: sceneTags,
        lighting_tags: lightingTags,
        composition_tags: compositionTags,
        background_cues: backgroundCues,
        profile_summary: profileSummary,
        generated_at: generatedAt,
        created_at: createdAt,
        updated_at: updatedAt
      };
      const index = this.db.profiles.findIndex((item) => item.event_id === eventId);
      if (index >= 0) this.db.profiles[index] = row;
      else this.db.profiles.push(row);
    }

    return { meta: { changes: 1 } };
  }

  mediaAuditCandidates() {
    const eventId = this.params[0];
    const retryFailed = Number(this.params[1] || 0) === 1;
    return this.db.submissions
      .filter((item) => (item.event_id || item.eventId) === eventId)
      .filter((item) => item.status === 'approved')
      .filter((item) => !(item.deleted_at || item.deletedAt))
      .filter((item) => {
        const mediaType = item.media_type || item.mediaType;
        return (mediaType === 'photo' && (item.object_key || item.objectKey))
          || (mediaType === 'video' && (item.thumbnail_object_key || item.thumbnailObjectKey));
      })
      .filter((item) => {
        const existing = this.db.insights.find((row) => row.submission_id === item.id || row.submissionId === item.id);
        if (!existing) return true;
        const hasGps = Number.isFinite(Number(existing.exif_gps_latitude ?? existing.exifGpsLatitude))
          && Number.isFinite(Number(existing.exif_gps_longitude ?? existing.exifGpsLongitude));
        const needsExif = Number(existing.exif_metadata_version || existing.exifMetadataVersion || 0) < 1;
        const needsReverseGeocode = hasGps && Number(existing.reverse_geocoding_version || existing.reverseGeocodingVersion || 0) < 1;
        return existing.status === 'pending' || (retryFailed && existing.status === 'failed') || needsExif || needsReverseGeocode;
      })
      .sort((left, right) => new Date(left.created_at || left.createdAt || 0) - new Date(right.created_at || right.createdAt || 0))
      .map((item) => ({
        id: item.id,
        eventId: item.event_id || item.eventId,
        mediaType: item.media_type || item.mediaType,
        source: item.source || 'guest',
        objectKey: item.object_key || item.objectKey,
        originalFilename: item.original_filename || item.originalFilename,
        mimeType: item.mime_type || item.mimeType,
        size: item.size,
        thumbnailObjectKey: item.thumbnail_object_key || item.thumbnailObjectKey,
        thumbnailMimeType: item.thumbnail_mime_type || item.thumbnailMimeType,
        thumbnailSize: item.thumbnail_size || item.thumbnailSize,
        uploaderIpAddress: item.uploader_ip_address || item.uploaderIpAddress,
        aiArtworkConsentAt: item.ai_artwork_consent_at || item.aiArtworkConsentAt,
        status: item.status,
        createdAt: item.created_at || item.createdAt,
        updatedAt: item.updated_at || item.updatedAt
      }));
  }
}

function pngBytes(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32BE(bytes, 16, width);
  writeUint32BE(bytes, 20, height);
  return bytes;
}

function jpegBytes(width, height) {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9
  ]);
  return bytes;
}

function jpegWithExifBytes(width, height) {
  const tiff = new Uint8Array(325);
  writeAscii(tiff, 0, 'MM');
  writeUint16BE(tiff, 2, 42);
  writeUint32BE(tiff, 4, 8);

  writeUint16BE(tiff, 8, 6);
  writeTiffEntry(tiff, 10, 0x010f, 2, 6, 86);
  writeTiffEntry(tiff, 22, 0x0110, 2, 10, 92);
  writeTiffEntry(tiff, 34, 0x0112, 3, 1, 6);
  writeTiffEntry(tiff, 46, 0x0131, 2, 7, 102);
  writeTiffEntry(tiff, 58, 0x8769, 4, 1, 109);
  writeTiffEntry(tiff, 70, 0x8825, 4, 1, 171);
  writeUint32BE(tiff, 82, 0);
  writeAscii(tiff, 86, 'Apple\0');
  writeAscii(tiff, 92, 'iPhone 15\0');
  writeAscii(tiff, 102, 'iOS 18\0');

  writeUint16BE(tiff, 109, 2);
  writeTiffEntry(tiff, 111, 0x9003, 2, 20, 139);
  writeTiffEntry(tiff, 123, 0xa434, 2, 12, 159);
  writeUint32BE(tiff, 135, 0);
  writeAscii(tiff, 139, '2026:06:06 14:30:00\0');
  writeAscii(tiff, 159, 'Main Camera\0');

  writeUint16BE(tiff, 171, 7);
  writeTiffAsciiInline(tiff, 173, 0x0001, 'N');
  writeTiffEntry(tiff, 185, 0x0002, 5, 3, 261);
  writeTiffAsciiInline(tiff, 197, 0x0003, 'W');
  writeTiffEntry(tiff, 209, 0x0004, 5, 3, 285);
  writeTiffEntry(tiff, 221, 0x0005, 1, 1, 0);
  writeTiffEntry(tiff, 233, 0x0006, 5, 1, 309);
  writeTiffEntry(tiff, 245, 0x001f, 5, 1, 317);
  writeUint32BE(tiff, 257, 0);
  writeRational(tiff, 261, 36, 1);
  writeRational(tiff, 269, 7, 1);
  writeRational(tiff, 277, 24, 1);
  writeRational(tiff, 285, 86, 1);
  writeRational(tiff, 293, 40, 1);
  writeRational(tiff, 301, 12, 1);
  writeRational(tiff, 309, 300, 1);
  writeRational(tiff, 317, 12, 1);

  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const app1Length = exifHeader.byteLength + tiff.byteLength + 2;
  const app1 = new Uint8Array(4 + exifHeader.byteLength + tiff.byteLength);
  app1.set([0xff, 0xe1], 0);
  writeUint16BE(app1, 2, app1Length);
  app1.set(exifHeader, 4);
  app1.set(tiff, 4 + exifHeader.byteLength);

  const base = jpegBytes(width, height);
  const output = new Uint8Array(2 + app1.byteLength + base.byteLength - 2);
  output.set(base.slice(0, 2), 0);
  output.set(app1, 2);
  output.set(base.slice(2), 2 + app1.byteLength);
  return output;
}

function writeUint32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint16BE(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeAscii(bytes, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function writeTiffEntry(bytes, offset, tag, type, count, value) {
  writeUint16BE(bytes, offset, tag);
  writeUint16BE(bytes, offset + 2, type);
  writeUint32BE(bytes, offset + 4, count);
  if ((type === 3 || type === 1) && count === 1) {
    if (type === 3) writeUint16BE(bytes, offset + 8, value);
    else bytes[offset + 8] = value & 0xff;
    bytes[offset + 10] = 0;
    bytes[offset + 11] = 0;
    return;
  }
  writeUint32BE(bytes, offset + 8, value);
}

function writeTiffAsciiInline(bytes, offset, tag, value) {
  writeUint16BE(bytes, offset, tag);
  writeUint16BE(bytes, offset + 2, 2);
  writeUint32BE(bytes, offset + 4, 2);
  bytes[offset + 8] = value.charCodeAt(0);
  bytes[offset + 9] = 0;
  bytes[offset + 10] = 0;
  bytes[offset + 11] = 0;
}

function writeRational(bytes, offset, numerator, denominator) {
  writeUint32BE(bytes, offset, numerator);
  writeUint32BE(bytes, offset + 4, denominator);
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(String(value || ''));
}

async function drainWaitUntil(tasks) {
  for (let index = 0; index < tasks.length; index += 1) {
    await tasks[index];
  }
}

let originalFetch = null;

function mockReverseGeocode(payload = null) {
  originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('nominatim.openstreetmap.org/reverse')) {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(payload || {
        display_name: 'Nashville, Davidson County, Tennessee, 37201, United States',
        address: {
          city: 'Nashville',
          county: 'Davidson County',
          state: 'Tennessee',
          postcode: '37201',
          country: 'United States'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(url, init);
  };
  return calls;
}

function mockOpenAiMediaAudit() {
  originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.openai.com/v1/responses')) {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          people_count: 2,
          face_count: 2,
          dominant_colors: ['ivory', 'sage'],
          scene_tags: ['floral wall', 'group portrait'],
          lighting_tags: ['warm light'],
          composition_tags: ['portrait'],
          background_cues: ['flower wall'],
          visible_text: '',
          summary: 'warm floral guest moment'
        })
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(url, init);
  };
  return calls;
}

function restoreFetch() {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}
