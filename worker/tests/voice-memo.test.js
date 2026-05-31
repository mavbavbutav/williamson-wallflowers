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

test('guest, host, and capsule frontends expose audio-only moments', async () => {
  const [guestHtml, guestJs, hostJs, capsuleJs] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/host/host.js'),
    readText('../../moments/capsule/capsule.js')
  ]);

  assert.match(guestHtml, /data-mode="audio"[^>]*>Voice Memo</);
  assert.match(guestJs, /MAX_AUDIO_SECONDS = 60/);
  assert.match(guestJs, /getSupportedAudioMimeType/);
  assert.match(guestJs, /audio\/\*/);
  assert.match(hostJs, /createElement\("audio"\)/);
  assert.match(capsuleJs, /createElement\("audio"\)/);
  assert.match(capsuleJs, /<audio /);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function envWithDb(db, bucket) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: bucket
  };
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
  constructor() {
    this.rateLimits = new Map();
    this.events = [{
      id: 'event-voice',
      name: 'Voice Memo Test',
      eventDate: '2026-09-19',
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
      timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z'
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
          hostName: event.hostName,
          eventStatus: event.status,
          retentionExpiresAt: event.retentionExpiresAt
        }
        : null;
    }

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ?')) {
      return this.db.events.find((event) => event.id === this.params[0]) || null;
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

    if (this.sql.includes('INSERT INTO submissions')) {
      const [
        id,
        eventId,
        mediaType,
        objectKey,
        originalFilename,
        mimeType,
        size,
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
