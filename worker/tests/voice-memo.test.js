import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import worker from '../src/index.js';

const BASE_ENV = {
  MOMENTS_ADMIN_TOKEN: 'admin-token',
  MOMENTS_TOKEN_SECRET: 'test-secret',
  PUBLIC_SITE_URL: 'https://williamsonwallflowers.com',
  MOMENTS_API_URL: 'https://api.example.com',
  ALLOWED_ORIGINS: 'https://williamsonwallflowers.com'
};

test('guest upload accepts an audio-only voice memo', async () => {
  const db = new UploadFakeDb();
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const { uploadToken } = await tokenResponse.json();

  const formData = new FormData();
  formData.set('media', new File(['audio-bytes'], 'toast.webm', { type: 'audio/webm' }));
  formData.set('mediaType', 'audio');
  formData.set('durationSeconds', '42');
  formData.set('guestName', 'Jordan');
  formData.set('guestNote', 'A sweet toast');
  formData.set('consent', 'true');
  formData.set('uploadToken', uploadToken);

  const uploadResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);
  const payload = await uploadResponse.json();

  assert.equal(uploadResponse.status, 201);
  assert.equal(payload.submission.status, 'pending');
  assert.equal(db.submissions.length, 1);
  assert.equal(db.submissions[0].media_type, 'audio');
  assert.equal(db.submissions[0].mime_type, 'audio/webm');
  assert.equal(db.submissions[0].duration_seconds, 42);
  assert.equal(bucket.puts.length, 1);
  assert.equal(bucket.puts[0].metadata.httpMetadata.contentType, 'audio/webm');
  assert.equal(bucket.puts[0].metadata.customMetadata.mediaType, 'audio');
});

test('guest media upload sends an internal Resend notification email', async () => {
  const db = new UploadFakeDb();
  const bucket = new FakeBucket();
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sentEmails.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response('', { status: 202 });
  };

  try {
    const env = envWithDb(db, bucket, {
      resend: 'resend-test-key',
      FROM_EMAIL: 'Williamson Wallflowers <noreply@example.com>'
    });

    const response = await submitGuestPhoto(env);

    assert.equal(response.status, 201);
    assert.equal(sentEmails.length, 1);
    const submissionId = db.submissions[0].id;
    assert.equal(sentEmails[0].url, 'https://api.resend.com/emails');
    assert.equal(sentEmails[0].headers.Authorization, 'Bearer resend-test-key');
    assert.deepEqual(sentEmails[0].body.to, ['contact@jjentertainmentsolutions.com', 'taylor@example.com']);
    assert.match(sentEmails[0].body.subject, /Guest photo upload/i);
    assert.match(sentEmails[0].body.text, /Event: Voice Memo Test/);
    assert.match(sentEmails[0].body.text, /Source: Guest upload/);
    assert.match(sentEmails[0].body.text, /Media type: photo/);
    assert.match(sentEmails[0].body.text, /Guest name: Jordan/);
    assert.match(sentEmails[0].body.text, /Note: Loved this wall/);
    assert.match(sentEmails[0].body.text, /Review this submission:/);
    assert.match(sentEmails[0].body.text, new RegExp(`submission=${submissionId}`));
    assert.match(sentEmails[0].body.text, /#token=host-token/);
    assert.match(sentEmails[0].body.html, /A new photo is waiting for review/);
    assert.match(sentEmails[0].body.html, /Media preview/);
    assert.match(sentEmails[0].body.html, /moments-api\/media\/[^"']+mediaToken=/);
    assert.match(sentEmails[0].body.html, /Review submission/);
    assert.match(sentEmails[0].body.html, new RegExp(`submission=${submissionId}`));
    assert.match(sentEmails[0].body.html, /#token=host-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest video upload email previews the reusable thumbnail still', async () => {
  const db = new UploadFakeDb();
  const bucket = new FakeBucket();
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sentEmails.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response('', { status: 202 });
  };

  try {
    const env = envWithDb(db, bucket, {
      resend: 'resend-test-key',
      FROM_EMAIL: 'Williamson Wallflowers <noreply@example.com>'
    });
    const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
      headers: { Origin: 'https://williamsonwallflowers.com' }
    }), env);
    const { uploadToken } = await tokenResponse.json();
    const formData = new FormData();
    formData.set('media', new File(['video-bytes'], 'dance.mp4', { type: 'video/mp4' }));
    formData.set('thumbnail', new File(['jpeg-bytes'], 'dance-thumb.jpg', { type: 'image/jpeg' }));
    formData.set('mediaType', 'video');
    formData.set('durationSeconds', '12');
    formData.set('guestName', 'Jordan');
    formData.set('guestNote', 'Dance floor');
    formData.set('consent', 'true');
    formData.set('uploadToken', uploadToken);

    const uploadResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com' },
      body: formData
    }), env);

    assert.equal(uploadResponse.status, 201);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].body.subject, /Guest video upload/i);
    assert.match(sentEmails[0].body.html, /Media preview/);
    assert.match(sentEmails[0].body.html, /moments-api\/media\/[^"']+\/thumbnail\?thumbnailToken=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest media upload dedupes support and host notification recipients', async () => {
  const db = new UploadFakeDb({ hostEmail: 'contact@jjentertainmentsolutions.com' });
  const bucket = new FakeBucket();
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sentEmails.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response('', { status: 202 });
  };

  try {
    const env = envWithDb(db, bucket, {
      resend: 'resend-test-key',
      FROM_EMAIL: 'Williamson Wallflowers <noreply@example.com>'
    });

    const response = await submitGuestPhoto(env);

    assert.equal(response.status, 201);
    assert.equal(sentEmails.length, 1);
    assert.deepEqual(sentEmails[0].body.to, ['contact@jjentertainmentsolutions.com']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest video upload stores a reusable thumbnail and returns a thumbnail URL', async () => {
  const db = new UploadFakeDb();
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const { uploadToken } = await tokenResponse.json();

  const formData = new FormData();
  formData.set('media', new File(['video-bytes'], 'dance.mp4', { type: 'video/mp4' }));
  formData.set('thumbnail', new File(['jpeg-bytes'], 'dance-thumb.jpg', { type: 'image/jpeg' }));
  formData.set('mediaType', 'video');
  formData.set('durationSeconds', '12');
  formData.set('guestName', 'Jordan');
  formData.set('guestNote', 'Dance floor');
  formData.set('consent', 'true');
  formData.set('uploadToken', uploadToken);

  const uploadResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);

  assert.equal(uploadResponse.status, 201);
  assert.equal(bucket.puts.length, 2);
  assert.match(bucket.puts[1].key, /\/thumbnails\//);
  assert.equal(bucket.puts[1].metadata.httpMetadata.contentType, 'image/jpeg');
  assert.equal(bucket.puts[1].metadata.customMetadata.mediaType, 'thumbnail');
  assert.match(db.submissions[0].thumbnail_object_key, /\/thumbnails\//);
  assert.equal(db.submissions[0].thumbnail_mime_type, 'image/jpeg');

  const hostResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-voice/submissions', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer host-token'
    }
  }), env);
  const payload = await hostResponse.json();

  assert.equal(hostResponse.status, 200);
  assert.match(payload.submissions[0].thumbnailUrl, /\/moments-api\/media\/.+\/thumbnail\?thumbnailToken=/);
  assert.equal(payload.submissions[0].thumbnailUrl.includes('host-token'), false);
});

test('guest upload is blocked before the countdown unless the host allows it', async () => {
  const db = new UploadFakeDb({
    eventStartAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    countdownEnabled: 1,
    guestUploadsBeforeCountdownEnabled: 0
  });
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const tagPayload = await tokenResponse.json();

  assert.equal(tagPayload.event.guestUploadsBeforeCountdownEnabled, false);

  const formData = new FormData();
  formData.set('media', new File(['photo-bytes'], 'before-party.jpg', { type: 'image/jpeg' }));
  formData.set('mediaType', 'photo');
  formData.set('durationSeconds', '0');
  formData.set('consent', 'true');
  formData.set('uploadToken', tagPayload.uploadToken);

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.match(payload.message, /party has not started/i);
  assert.equal(db.submissions.length, 0);
  assert.equal(bucket.puts.length, 0);
});

test('guest upload is accepted before the countdown when the host allows it', async () => {
  const db = new UploadFakeDb({
    eventStartAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    countdownEnabled: 1,
    guestUploadsBeforeCountdownEnabled: 1
  });
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const tagPayload = await tokenResponse.json();

  assert.equal(tagPayload.event.guestUploadsBeforeCountdownEnabled, true);

  const formData = new FormData();
  formData.set('media', new File(['photo-bytes'], 'before-party.jpg', { type: 'image/jpeg' }));
  formData.set('mediaType', 'photo');
  formData.set('durationSeconds', '0');
  formData.set('consent', 'true');
  formData.set('uploadToken', tagPayload.uploadToken);

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);

  assert.equal(response.status, 201);
  assert.equal(db.submissions.length, 1);
  assert.equal(bucket.puts.length, 1);
});

test('viewer-generated video thumbnails can be saved once for older videos', async () => {
  const db = new UploadFakeDb();
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const { uploadToken } = await tokenResponse.json();

  const formData = new FormData();
  formData.set('media', new File(['video-bytes'], 'toast.mp4', { type: 'video/mp4' }));
  formData.set('mediaType', 'video');
  formData.set('durationSeconds', '10');
  formData.set('consent', 'true');
  formData.set('uploadToken', uploadToken);

  await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);

  const hostResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-voice/submissions', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer host-token'
    }
  }), env);
  const payload = await hostResponse.json();
  const uploadUrl = payload.submissions[0].thumbnailUploadUrl;

  assert.equal(payload.submissions[0].thumbnailUrl, '');
  assert.match(uploadUrl, /\/moments-api\/media\/.+\/thumbnail\?thumbnailToken=/);

  const thumbnailForm = new FormData();
  thumbnailForm.set('thumbnail', new File(['jpeg-bytes'], 'generated.jpg', { type: 'image/jpeg' }));

  const saveResponse = await worker.fetch(new Request(uploadUrl, {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: thumbnailForm
  }), env);
  const saved = await saveResponse.json();

  assert.equal(saveResponse.status, 200);
  assert.match(saved.thumbnailUrl, /\/moments-api\/media\/.+\/thumbnail\?thumbnailToken=/);
  assert.match(db.submissions[0].thumbnail_object_key, /\/thumbnails\//);
  assert.equal(bucket.puts.length, 2);
});

test('guest upload rejects voice memos longer than 60 seconds', async () => {
  const db = new UploadFakeDb();
  const env = envWithDb(db, new FakeBucket());

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const { uploadToken } = await tokenResponse.json();

  const formData = new FormData();
  formData.set('media', new File(['audio-bytes'], 'toast.webm', { type: 'audio/webm' }));
  formData.set('mediaType', 'audio');
  formData.set('durationSeconds', '65');
  formData.set('consent', 'true');
  formData.set('uploadToken', uploadToken);

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.match(payload.message, /60 seconds or shorter/i);
  assert.equal(db.submissions.length, 0);
});

test('voice memo migration widens the submissions media_type constraint', async () => {
  const migration = await readText('../../worker/migrations/0004_wallflower_voice_memos.sql');

  assert.match(migration, /media_type TEXT NOT NULL CHECK \(media_type IN \('photo', 'video', 'audio'\)\)/);
  assert.match(migration, /INSERT INTO submissions_new/);
  assert.match(migration, /DROP TABLE submissions/);
  assert.match(migration, /ALTER TABLE submissions_new RENAME TO submissions/);
});

test('video thumbnail migration adds reusable thumbnail metadata', async () => {
  const migration = await readText('../../worker/migrations/0006_wallflower_video_thumbnails.sql');

  assert.match(migration, /thumbnail_object_key TEXT/);
  assert.match(migration, /thumbnail_mime_type TEXT/);
  assert.match(migration, /thumbnail_size INTEGER/);
  assert.match(migration, /thumbnail_created_at TEXT/);
});

test('countdown guest upload migration stores the host pre-party choice', async () => {
  const migration = await readText('../../worker/migrations/0011_wallflower_guest_pre_countdown_uploads.sql');

  assert.match(migration, /ALTER TABLE events/);
  assert.match(migration, /guest_uploads_before_countdown_enabled INTEGER NOT NULL DEFAULT 0/);
});

test('guest, host, and capsule frontends expose audio-only moments', async () => {
  const [guestHtml, guestJs, hostJs, capsuleJs] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/host/host.js'),
    readText('../../moments/capsule/capsule.js')
  ]);

  assert.match(guestHtml, /data-mode="audio"[\s\S]*Voice Memo/);
  assert.match(guestJs, /MAX_AUDIO_SECONDS = 60/);
  assert.match(guestJs, /getSupportedAudioMimeType/);
  assert.match(guestJs, /audio\/\*/);
  assert.match(hostJs, /createElement\("audio"\)/);
  assert.match(capsuleJs, /createElement\("audio"\)/);
  assert.match(capsuleJs, /<audio /);
});

test('guest and host uploads generate video thumbnails before posting', async () => {
  const [guestJs, hostJs] = await Promise.all([
    readText('../../moments/app.js'),
    readText('../../moments/host/host.js')
  ]);

  assert.match(guestJs, /createVideoThumbnailFile/);
  assert.match(guestJs, /formData\.append\("thumbnail"/);
  assert.match(hostJs, /createVideoThumbnailFile/);
  assert.match(hostJs, /formData\.append\("thumbnail"/);
});

test('host prerecorded video selection previews before mobile media probes', async () => {
  const hostJs = await readText('../../moments/host/host.js');
  const acceptStart = hostJs.indexOf('async function acceptHostPostFile(file)');
  const previewIndex = hostJs.indexOf('renderHostPostPreview();', acceptStart);
  const durationIndex = hostJs.indexOf('readMediaDuration(file, mediaType)', acceptStart);
  const thumbnailIndex = hostJs.indexOf('createVideoThumbnailFile(file', acceptStart);

  assert.notEqual(acceptStart, -1);
  assert.ok(previewIndex > acceptStart, 'host file selection should render the chosen media preview');
  assert.ok(previewIndex < durationIndex, 'preview should render before waiting for mobile metadata duration');
  assert.ok(previewIndex < thumbnailIndex, 'preview should render before generating a JPEG video thumbnail');
});

test('host media duration reader resolves when mobile metadata never loads', async () => {
  const hostJs = await readText('../../moments/host/host.js');
  const durationStart = hostJs.indexOf('function readMediaDuration(file, mediaType');
  const durationEnd = hostJs.indexOf('function renderThumb', durationStart);
  const durationSource = hostJs.slice(durationStart, durationEnd);

  assert.notEqual(durationStart, -1);
  assert.match(durationSource, /window\.setTimeout/);
  assert.match(durationSource, /finish\(0\)/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function envWithDb(db, bucket, overrides = {}) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: bucket,
    ...overrides
  };
}

async function submitGuestPhoto(env, overrides = {}) {
  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/voice-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const { uploadToken } = await tokenResponse.json();

  const formData = new FormData();
  formData.set('media', overrides.media || new File(['photo-bytes'], 'flower-wall.jpg', { type: 'image/jpeg' }));
  formData.set('mediaType', overrides.mediaType || 'photo');
  formData.set('durationSeconds', String(overrides.durationSeconds || 0));
  formData.set('guestName', overrides.guestName || 'Jordan');
  formData.set('guestNote', overrides.guestNote || 'Loved this wall');
  formData.set('consent', 'true');
  formData.set('uploadToken', uploadToken);

  return worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-voice/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);
}

class FakeBucket {
  constructor() {
    this.puts = [];
  }

  async put(key, body, metadata) {
    this.puts.push({ key, body, metadata });
  }

  async get() {
    return null;
  }

  async head() {
    return null;
  }

  async delete() {}
}

class UploadFakeDb {
  constructor(eventOverrides = {}) {
    this.rateLimits = new Map();
    this.events = [{
      id: 'event-voice',
      name: 'Voice Memo Test',
      eventDate: '2026-09-19',
      eventStartAt: null,
      countdownEnabled: 0,
      countdownMessage: 'Party starts in',
      guestUploadsBeforeCountdownEnabled: 0,
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
      timeCapsuleTitle: 'Voice Memo Test Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z',
      ...eventOverrides
    }];
    this.tags = [{
      id: 'tag-voice',
      publicCode: 'voice-tag',
      label: 'Voice tag',
      status: 'active',
      activeEventId: 'event-voice'
    }];
    this.submissions = [];
  }

  prepare(sql) {
    return new UploadFakeStatement(this, sql);
  }
}

class UploadFakeStatement {
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
    if (this.sql.includes('FROM tags')) {
      const tag = this.db.tags.find((item) => item.publicCode === this.params[0]);
      const event = tag && this.db.events.find((item) => item.id === tag.activeEventId);
      return tag && event
        ? {
          tagId: tag.id,
          publicCode: tag.publicCode,
          tagLabel: tag.label,
          tagStatus: tag.status,
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          eventStartAt: event.eventStartAt,
          countdownEnabled: event.countdownEnabled,
          countdownMessage: event.countdownMessage,
          guestUploadsBeforeCountdownEnabled: event.guestUploadsBeforeCountdownEnabled,
          hostName: event.hostName,
          eventStatus: event.status,
          retentionExpiresAt: event.retentionExpiresAt
        }
        : null;
    }

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ?')) {
      return this.db.events.find((event) => event.id === this.params[0]) || null;
    }

    if (this.sql.includes('FROM submissions s') && this.sql.includes('WHERE s.id = ?')) {
      const submission = this.db.submissions.find((item) => item.id === this.params[0]);
      const event = submission && this.db.events.find((item) => item.id === submission.event_id);
      return submission && event
        ? {
          id: submission.id,
          eventId: submission.event_id,
          mediaType: submission.media_type,
          source: submission.source || 'guest',
          objectKey: submission.object_key,
          originalFilename: submission.original_filename,
          mimeType: submission.mime_type,
          size: submission.size,
          thumbnailObjectKey: submission.thumbnail_object_key,
          thumbnailMimeType: submission.thumbnail_mime_type,
          thumbnailSize: submission.thumbnail_size,
          thumbnailCreatedAt: submission.thumbnail_created_at,
          durationSeconds: submission.duration_seconds,
          guestName: submission.guest_name,
          guestNote: submission.guest_note,
          consentAt: submission.consent_at,
          status: submission.status,
          deletedAt: submission.deleted_at,
          createdAt: submission.created_at,
          updatedAt: submission.updated_at,
          hostToken: event.hostToken,
          eventAdminToken: event.adminToken
        }
        : null;
    }

    if (this.sql.includes('FROM rate_limits')) {
      return this.db.rateLimits.get(this.params[0]) || null;
    }

    if (this.sql.includes('COUNT(*) AS count')) {
      return { count: this.db.submissions.length, bytes: this.db.submissions.reduce((sum, item) => sum + Number(item.size || 0), 0) };
    }

    return null;
  }

  async all() {
    if (this.sql.includes('FROM submissions') && this.sql.includes('WHERE event_id = ?')) {
      return {
        results: this.db.submissions.filter((item) => item.event_id === this.params[0] && item.status !== 'deleted')
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes('INSERT INTO rate_limits')) {
      this.db.rateLimits.set(this.params[0], {
        windowStart: this.params[1],
        count: 1,
        updatedAt: this.params[2]
      });
    }

    if (this.sql.includes('UPDATE rate_limits')) {
      const key = this.params[1];
      const current = this.db.rateLimits.get(key) || { windowStart: 0, count: 0 };
      this.db.rateLimits.set(key, { ...current, count: current.count + 1, updatedAt: this.params[0] });
    }

    if (this.sql.includes('UPDATE submissions') && this.sql.includes('thumbnail_object_key')) {
      const submission = this.db.submissions.find((item) => item.id === this.params[5]);
      if (submission) {
        submission.thumbnail_object_key = this.params[0];
        submission.thumbnail_mime_type = this.params[1];
        submission.thumbnail_size = this.params[2];
        submission.thumbnail_created_at = this.params[3];
        submission.updated_at = this.params[4];
      }
    }

    if (this.sql.includes('INSERT INTO submissions')) {
      const [
        id,
        eventId,
        mediaType,
        objectKey,
        originalFilename,
        mimeType,
        size,
        thumbnailObjectKey,
        thumbnailMimeType,
        thumbnailSize,
        thumbnailCreatedAt,
        durationSeconds,
        guestName,
        guestNote,
        consentAt,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.submissions.push({
        id,
        event_id: eventId,
        media_type: mediaType,
        object_key: objectKey,
        original_filename: originalFilename,
        mime_type: mimeType,
        size,
        thumbnail_object_key: thumbnailObjectKey,
        thumbnail_mime_type: thumbnailMimeType,
        thumbnail_size: thumbnailSize,
        thumbnail_created_at: thumbnailCreatedAt,
        duration_seconds: durationSeconds,
        guest_name: guestName,
        guest_note: guestNote,
        consent_at: consentAt,
        status: 'pending',
        created_at: createdAt,
        updated_at: updatedAt
      });
    }

    return { success: true };
  }
}
