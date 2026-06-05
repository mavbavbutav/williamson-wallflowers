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
  OPENAI_API_KEY: 'openai-test-key'
};

test('guest upload stores AI artwork consent only when provided', async () => {
  const db = new GroupHeroFakeDb();
  const env = envWithDb(db, new FakeBucket());
  const token = await getUploadToken(env);

  const consentResponse = await submitGuestPhoto(env, token, { aiArtworkConsent: true });
  const privateResponse = await submitGuestPhoto(env, token, { filename: 'private.jpg' });

  assert.equal(consentResponse.status, 201);
  assert.equal(privateResponse.status, 201);
  assert.equal(db.submissions.length, 2);
  assert.ok(db.submissions[0].ai_artwork_consent_at);
  assert.equal(db.submissions[1].ai_artwork_consent_at, null);
});

test('approving an AI-consented photo generates a ready group hero from the latest 16 sources', async () => {
  const submissions = Array.from({ length: 18 }, (_, index) => guestSubmission({
    id: `guest-${String(index + 1).padStart(2, '0')}`,
    object_key: `moments/event-hero/guest-${String(index + 1).padStart(2, '0')}.jpg`,
    objectKey: `moments/event-hero/guest-${String(index + 1).padStart(2, '0')}.jpg`,
    status: index === 17 ? 'pending' : 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: new Date(Date.UTC(2026, 8, 19, 20, index, 0)).toISOString(),
    createdAt: new Date(Date.UTC(2026, 8, 19, 20, index, 0)).toISOString()
  }));
  const db = new GroupHeroFakeDb({ submissions });
  const bucket = new FakeBucket(submissions.map((submission) => [submission.object_key, `source-${submission.id}`]));
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(envWithDb(db, bucket), 'guest-18');
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 16);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 16);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), [
      'guest-18',
      'guest-17',
      'guest-16',
      'guest-15',
      'guest-14',
      'guest-13',
      'guest-12',
      'guest-11',
      'guest-10',
      'guest-09',
      'guest-08',
      'guest-07',
      'guest-06',
      'guest-05',
      'guest-04',
      'guest-03'
    ]);
    assert.equal(bucket.puts.at(-1).metadata.httpMetadata.contentType, 'image/png');
  } finally {
    restoreFetch();
  }
});

test('OpenAI failure stores failed group hero state without breaking approval', async () => {
  const submission = guestSubmission({
    id: 'guest-fail',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [submission] });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  mockOpenAi({ status: 500, body: { error: { message: 'provider failed with detail' } } });

  try {
    const response = await approveSubmission(envWithDb(db, bucket), submission.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(db.groupHeroes[0].status, 'failed');
    assert.match(db.groupHeroes[0].error_message, /provider failed/);
  } finally {
    restoreFetch();
  }
});

test('guest and host group hero endpoints enforce access tokens', async () => {
  const db = new GroupHeroFakeDb({
    groupHeroes: [readyHero()]
  });
  const env = envWithDb(db, new FakeBucket([['moments/event-hero/generated/group-hero.png', 'generated']]));
  const token = await getUploadToken(env);

  const badGuest = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-hero/group-hero', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer wrong-token'
    }
  }), env);
  assert.equal(badGuest.status, 403);

  const goodGuest = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-hero/group-hero', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: `Bearer ${token}`
    }
  }), env);
  const guestPayload = await goodGuest.json();
  assert.equal(goodGuest.status, 200);
  assert.equal(guestPayload.groupHero.status, 'ready');
  assert.match(guestPayload.groupHero.imageUrl, /group-hero\/image\?heroToken=/);

  const badHost = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer wrong-token'
    }
  }), env);
  assert.equal(badHost.status, 403);

  mockOpenAi();
  try {
    const goodHost = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);
    assert.equal(goodHost.status, 202);
  } finally {
    restoreFetch();
  }
});

test('rejecting or deleting included submissions rebuilds or clears the group hero', async () => {
  const first = guestSubmission({
    id: 'guest-a',
    object_key: 'moments/event-hero/guest-a.jpg',
    objectKey: 'moments/event-hero/guest-a.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:10:00.000Z',
    createdAt: '2026-09-19T20:10:00.000Z'
  });
  const second = guestSubmission({
    id: 'guest-b',
    object_key: 'moments/event-hero/guest-b.jpg',
    objectKey: 'moments/event-hero/guest-b.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:09:00.000Z',
    createdAt: '2026-09-19T20:09:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [first, second],
    groupHeroes: [readyHero({ source_submission_ids: JSON.stringify(['guest-a', 'guest-b']), participant_count: 2 })]
  });
  const bucket = new FakeBucket([
    [first.object_key, 'source-a'],
    [second.object_key, 'source-b'],
    ['moments/event-hero/generated/group-hero.png', 'old-generated']
  ]);
  mockOpenAi();

  try {
    const rejectResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/submissions/guest-a', {
      method: 'PATCH',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'rejected' })
    }), envWithDb(db, bucket));

    assert.equal(rejectResponse.status, 200);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 1);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-b']);

    const deleteResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/submissions/guest-b', {
      method: 'DELETE',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), envWithDb(db, bucket));

    assert.equal(deleteResponse.status, 200);
    assert.equal(db.groupHeroes[0].status, 'empty');
    assert.equal(db.groupHeroes[0].participant_count, 0);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), []);
  } finally {
    restoreFetch();
  }
});

test('frontends expose AI group hero UI and cache-busted assets', async () => {
  const [guestHtml, guestJs, hostHtml, hostJs, styles, migration] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/host/index.html'),
    readText('../../moments/host/host.js'),
    readText('../../moments/styles.css'),
    readText('../migrations/0014_wallflower_ai_group_hero.sql')
  ]);

  assert.match(guestHtml, /AI event artwork use/);
  assert.match(guestHtml, /data-group-hero-panel/);
  assert.match(guestHtml, /app\.js\?v=20260605-ai-group-hero-1/);
  assert.match(guestJs, /function renderGroupHero/);
  assert.match(guestJs, /formData\.append\("aiArtworkConsent", "true"\)/);
  assert.match(hostHtml, /id="groupHeroHostCard"/);
  assert.match(hostHtml, /host\.js\?v=20260605-ai-group-hero-1/);
  assert.match(hostJs, /function regenerateGroupHero/);
  assert.match(hostJs, /group-hero\/regenerate/);
  assert.match(styles, /\.group-hero-panel/);
  assert.match(migration, /ai_artwork_consent_at TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_group_heroes/);
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

async function getUploadToken(env) {
  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/hero-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const payload = await response.json();
  return payload.uploadToken;
}

async function submitGuestPhoto(env, uploadToken, options = {}) {
  const formData = new FormData();
  formData.set('media', new File(['photo-bytes'], options.filename || 'guest-photo.jpg', { type: 'image/jpeg' }));
  formData.set('mediaType', 'photo');
  formData.set('durationSeconds', '0');
  formData.set('guestName', 'Jordan');
  formData.set('guestNote', 'Loved this wall');
  formData.set('consent', 'true');
  if (options.aiArtworkConsent) formData.set('aiArtworkConsent', 'true');
  formData.set('uploadToken', uploadToken);

  return worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-hero/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);
}

function approveSubmission(env, submissionId) {
  return worker.fetch(new Request(`https://williamsonwallflowers.com/moments-api/host/submissions/${submissionId}`, {
    method: 'PATCH',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer host-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'approved' })
  }), env);
}

let originalFetch = null;

function mockOpenAi({ status = 200, body = { data: [{ b64_json: btoa('generated-png') }] } } = {}) {
  originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.openai.com/v1/images/edits')) {
      const entries = Array.from(init.body.entries());
      calls.push({
        url,
        model: entries.find(([key]) => key === 'model')?.[1],
        imageCount: entries.filter(([key]) => key === 'image[]').length
      });
      return new Response(JSON.stringify(body), {
        status,
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

function guestSubmission(overrides = {}) {
  return {
    id: 'guest-approved',
    event_id: 'event-hero',
    eventId: 'event-hero',
    media_type: 'photo',
    mediaType: 'photo',
    source: 'guest',
    object_key: 'moments/event-hero/guest-approved.jpg',
    objectKey: 'moments/event-hero/guest-approved.jpg',
    original_filename: 'guest-photo.jpg',
    originalFilename: 'guest-photo.jpg',
    mime_type: 'image/jpeg',
    mimeType: 'image/jpeg',
    size: 1200,
    duration_seconds: 0,
    durationSeconds: 0,
    guest_name: 'Avery',
    guestName: 'Avery',
    guest_note: 'A sweet guest moment.',
    guestNote: 'A sweet guest moment.',
    consent_at: '2026-09-19T20:20:00.000Z',
    consentAt: '2026-09-19T20:20:00.000Z',
    ai_artwork_consent_at: null,
    aiArtworkConsentAt: null,
    status: 'approved',
    guest_visible_at: null,
    guestVisibleAt: null,
    deleted_at: null,
    deletedAt: null,
    created_at: '2026-09-19T20:20:00.000Z',
    createdAt: '2026-09-19T20:20:00.000Z',
    updated_at: '2026-09-19T20:20:00.000Z',
    updatedAt: '2026-09-19T20:20:00.000Z',
    ...overrides
  };
}

function readyHero(overrides = {}) {
  return {
    event_id: 'event-hero',
    eventId: 'event-hero',
    status: 'ready',
    object_key: 'moments/event-hero/generated/group-hero.png',
    objectKey: 'moments/event-hero/generated/group-hero.png',
    mime_type: 'image/png',
    mimeType: 'image/png',
    size: 13,
    participant_count: 1,
    participantCount: 1,
    source_submission_ids: JSON.stringify(['guest-approved']),
    sourceSubmissionIds: JSON.stringify(['guest-approved']),
    model: 'gpt-image-1.5',
    prompt: 'prompt',
    error_message: '',
    errorMessage: '',
    generated_at: '2026-09-19T20:30:00.000Z',
    generatedAt: '2026-09-19T20:30:00.000Z',
    created_at: '2026-09-19T20:30:00.000Z',
    createdAt: '2026-09-19T20:30:00.000Z',
    updated_at: '2026-09-19T20:30:00.000Z',
    updatedAt: '2026-09-19T20:30:00.000Z',
    ...overrides
  };
}

class FakeBucket {
  constructor(seed = []) {
    this.objects = new Map();
    this.puts = [];
    this.deletes = [];
    seed.forEach(([key, value]) => {
      this.objects.set(key, toBytes(value));
    });
  }

  async put(key, body, metadata) {
    const bytes = body instanceof Uint8Array ? body : toBytes(body);
    this.objects.set(key, bytes);
    this.puts.push({ key, body: bytes, metadata });
  }

  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      body: new Blob([bytes]).stream(),
      size: bytes.byteLength,
      etag: `${key}-etag`,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      writeHttpMetadata(headers) {
        headers.set('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
      }
    };
  }

  async head(key) {
    return this.get(key);
  }

  async delete(key) {
    this.deletes.push(key);
    this.objects.delete(key);
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(String(value || ''));
}

class GroupHeroFakeDb {
  constructor(seed = {}) {
    this.rateLimits = new Map();
    this.events = [{
      id: 'event-hero',
      name: 'AI Hero Test',
      eventDate: '2026-09-19',
      eventStartAt: null,
      countdownEnabled: 0,
      countdownMessage: 'Party starts in',
      guestUploadsBeforeCountdownEnabled: 0,
      partyViewSwipeEnabled: 0,
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
      timeCapsuleTitle: 'AI Hero Test Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z'
    }];
    this.tags = [{
      id: 'tag-hero',
      publicCode: 'hero-tag',
      label: 'Hero tag',
      status: 'active',
      activeEventId: 'event-hero'
    }];
    this.submissions = seed.submissions ? seed.submissions.map((submission) => ({ ...submission })) : [];
    this.groupHeroes = seed.groupHeroes ? seed.groupHeroes.map((hero) => ({ ...hero })) : [];
  }

  prepare(sql) {
    return new GroupHeroFakeStatement(this, sql);
  }
}

class GroupHeroFakeStatement {
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
      if (this.sql.includes('active_event_id = ?')) {
        const tag = this.db.tags.find((item) => item.activeEventId === this.params[0] && item.status === 'active');
        return tag ? { id: tag.id, publicCode: tag.publicCode, label: tag.label } : null;
      }
      const tag = this.db.tags.find((item) => item.publicCode === this.params[0]);
      const event = tag && this.db.events.find((item) => item.id === tag.activeEventId);
      return tag && event ? tagEventRow(tag, event) : null;
    }

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ? AND host_token = ?')) {
      return this.db.events.find((event) => event.id === this.params[0] && event.hostToken === this.params[1]) || null;
    }

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ?')) {
      return this.db.events.find((event) => event.id === this.params[0]) || null;
    }

    if (this.sql.includes('FROM submissions s') && this.sql.includes('INNER JOIN events e') && this.sql.includes('WHERE s.id = ?')) {
      const submission = this.db.submissions.find((item) => item.id === this.params[0]);
      const event = submission && this.db.events.find((item) => item.id === (submission.event_id || submission.eventId));
      return submission && event ? submissionWithEventRow(submission, event) : null;
    }

    if (this.sql.includes('FROM event_group_heroes')) {
      return this.db.groupHeroes.find((hero) => (hero.event_id || hero.eventId) === this.params[0]) || null;
    }

    if (this.sql.includes('FROM rate_limits')) {
      return this.db.rateLimits.get(this.params[0]) || null;
    }

    if (this.sql.includes('COUNT(*) AS count')) {
      const eventId = this.params[0];
      const submissions = this.db.submissions.filter((item) => (item.event_id || item.eventId) === eventId && item.status !== 'deleted');
      return {
        count: submissions.length,
        bytes: submissions.reduce((sum, item) => sum + Number(item.size || 0), 0)
      };
    }

    return null;
  }

  async all() {
    if (this.sql.includes('FROM submissions') && this.sql.includes('ai_artwork_consent_at IS NOT NULL')) {
      const [eventId, limit] = this.params;
      return {
        results: this.db.submissions
          .filter((item) => (item.event_id || item.eventId) === eventId)
          .filter((item) => item.source === 'guest')
          .filter((item) => (item.media_type || item.mediaType) === 'photo')
          .filter((item) => item.status === 'approved')
          .filter((item) => !(item.deleted_at || item.deletedAt))
          .filter((item) => item.ai_artwork_consent_at || item.aiArtworkConsentAt)
          .filter((item) => ['image/jpeg', 'image/png', 'image/webp'].includes(item.mime_type || item.mimeType))
          .sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0))
          .slice(0, Number(limit || 16))
          .map((item) => ({
            id: item.id,
            eventId: item.event_id || item.eventId,
            objectKey: item.object_key || item.objectKey,
            originalFilename: item.original_filename || item.originalFilename,
            mimeType: item.mime_type || item.mimeType,
            createdAt: item.created_at || item.createdAt
          }))
      };
    }

    if (this.sql.includes('FROM submissions') && this.sql.includes('WHERE event_id = ?')) {
      return {
        results: this.db.submissions.filter((item) => (item.event_id || item.eventId) === this.params[0] && item.status !== 'deleted')
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
        eventId,
        media_type: mediaType,
        mediaType,
        source: 'guest',
        object_key: objectKey,
        objectKey,
        original_filename: originalFilename,
        originalFilename,
        mime_type: mimeType,
        mimeType,
        size,
        thumbnail_object_key: thumbnailObjectKey,
        thumbnailObjectKey,
        thumbnail_mime_type: thumbnailMimeType,
        thumbnailMimeType,
        thumbnail_size: thumbnailSize,
        thumbnailSize,
        thumbnail_created_at: thumbnailCreatedAt,
        thumbnailCreatedAt,
        duration_seconds: durationSeconds,
        durationSeconds,
        guest_name: guestName,
        guestName,
        guest_note: guestNote,
        guestNote,
        consent_at: consentAt,
        consentAt,
        ai_artwork_consent_at: null,
        aiArtworkConsentAt: null,
        status: 'pending',
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      });
    }

    if (this.sql.includes('UPDATE submissions') && this.sql.includes('ai_artwork_consent_at')) {
      const [aiArtworkConsentAt, updatedAt, id] = this.params;
      const submission = this.db.submissions.find((item) => item.id === id);
      if (submission) {
        submission.ai_artwork_consent_at = aiArtworkConsentAt;
        submission.aiArtworkConsentAt = aiArtworkConsentAt;
        submission.updated_at = updatedAt;
        submission.updatedAt = updatedAt;
      }
    }

    if (this.sql.includes('UPDATE submissions') && this.sql.includes('SET status = ?')) {
      const [status, statusForVisibility, updatedAt, id] = this.params;
      const submission = this.db.submissions.find((item) => item.id === id);
      if (submission) {
        submission.status = status;
        if (statusForVisibility !== 'approved') {
          submission.guest_visible_at = null;
          submission.guestVisibleAt = null;
        }
        submission.updated_at = updatedAt;
        submission.updatedAt = updatedAt;
      }
    }

    if (this.sql.includes("SET status = 'deleted'")) {
      const [deletedAt, updatedAt, id] = this.params;
      const submission = this.db.submissions.find((item) => item.id === id);
      if (submission) {
        submission.status = 'deleted';
        submission.deleted_at = deletedAt;
        submission.deletedAt = deletedAt;
        submission.updated_at = updatedAt;
        submission.updatedAt = updatedAt;
      }
    }

    if (this.sql.includes('DELETE FROM time_capsule_items')) {
      return { success: true };
    }

    if (this.sql.includes('INSERT INTO event_group_heroes')) {
      const [
        eventId,
        status,
        objectKey,
        mimeType,
        size,
        participantCount,
        sourceSubmissionIds,
        model,
        prompt,
        errorMessage,
        generatedAt,
        createdAt,
        updatedAt
      ] = this.params;
      const existing = this.db.groupHeroes.find((hero) => (hero.event_id || hero.eventId) === eventId);
      const next = {
        event_id: eventId,
        eventId,
        status,
        object_key: objectKey,
        objectKey,
        mime_type: mimeType,
        mimeType,
        size,
        participant_count: participantCount,
        participantCount,
        source_submission_ids: sourceSubmissionIds,
        sourceSubmissionIds,
        model,
        prompt,
        error_message: errorMessage,
        errorMessage,
        generated_at: generatedAt,
        generatedAt,
        created_at: existing?.created_at || createdAt,
        createdAt: existing?.createdAt || createdAt,
        updated_at: updatedAt,
        updatedAt
      };
      if (existing) Object.assign(existing, next);
      else this.db.groupHeroes.push(next);
    }

    return { success: true };
  }
}

function tagEventRow(tag, event) {
  return {
    tagId: tag.id,
    publicCode: tag.publicCode,
    tagLabel: tag.label,
    tagStatus: tag.status,
    eventId: event.id,
    eventName: event.name,
    eventDate: event.eventDate,
    hostName: event.hostName,
    eventStartAt: event.eventStartAt,
    countdownEnabled: event.countdownEnabled,
    countdownMessage: event.countdownMessage,
    guestUploadsBeforeCountdownEnabled: event.guestUploadsBeforeCountdownEnabled,
    partyViewSwipeEnabled: event.partyViewSwipeEnabled,
    eventStatus: event.status,
    retentionExpiresAt: event.retentionExpiresAt
  };
}

function submissionWithEventRow(submission, event) {
  return {
    ...submission,
    eventId: submission.event_id || submission.eventId,
    mediaType: submission.media_type || submission.mediaType,
    objectKey: submission.object_key || submission.objectKey,
    originalFilename: submission.original_filename || submission.originalFilename,
    mimeType: submission.mime_type || submission.mimeType,
    thumbnailObjectKey: submission.thumbnail_object_key || submission.thumbnailObjectKey,
    thumbnailMimeType: submission.thumbnail_mime_type || submission.thumbnailMimeType,
    thumbnailSize: submission.thumbnail_size || submission.thumbnailSize,
    thumbnailCreatedAt: submission.thumbnail_created_at || submission.thumbnailCreatedAt,
    durationSeconds: submission.duration_seconds || submission.durationSeconds,
    guestName: submission.guest_name || submission.guestName,
    guestNote: submission.guest_note || submission.guestNote,
    consentAt: submission.consent_at || submission.consentAt,
    aiArtworkConsentAt: submission.ai_artwork_consent_at || submission.aiArtworkConsentAt,
    guestVisibleAt: submission.guest_visible_at || submission.guestVisibleAt,
    deletedAt: submission.deleted_at || submission.deletedAt,
    createdAt: submission.created_at || submission.createdAt,
    updatedAt: submission.updated_at || submission.updatedAt,
    hostToken: event.hostToken,
    eventAdminToken: event.adminToken
  };
}
