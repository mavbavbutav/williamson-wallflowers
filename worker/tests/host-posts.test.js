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

test('host can create an approved Host Post that is added to the Time Capsule', async () => {
  const db = new HostPostsFakeDb();
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);

  const formData = new FormData();
  formData.set('media', new File(['photo-bytes'], 'host-photo.jpg', { type: 'image/jpeg' }));
  formData.set('mediaType', 'photo');
  formData.set('title', 'Host Post');
  formData.set('caption', 'First dance is starting.');

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-host/posts', {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer host-token'
    },
    body: formData
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.submission.status, 'approved');
  assert.equal(payload.submission.source, 'host');
  assert.equal(payload.item.chapter, 'Host Posts');
  assert.equal(payload.item.title, 'Host Post');
  assert.equal(payload.item.caption, 'First dance is starting.');
  assert.equal(payload.item.mediaUrl.includes('host-token'), false);
  assert.equal(db.submissions.length, 1);
  assert.equal(db.submissions[0].status, 'approved');
  assert.equal(db.submissions[0].source, 'host');
  assert.equal(db.items.length, 1);
  assert.equal(bucket.puts[0].metadata.customMetadata.source, 'host');
});

test('guest can read Host Posts from the scanned event link with the upload token', async () => {
  const db = new HostPostsFakeDb({
    submissions: [hostSubmission()],
    items: [hostCapsuleItem()]
  });
  const env = envWithDb(db, new FakeBucket());

  const tokenResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/tags/host-tag', {
    headers: { Origin: 'https://williamsonwallflowers.com' }
  }), env);
  const { uploadToken } = await tokenResponse.json();

  const badResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-host/host-posts', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer wrong-token'
    }
  }), env);
  assert.equal(badResponse.status, 403);

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-host/host-posts', {
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: `Bearer ${uploadToken}`
    }
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].source, 'host');
  assert.equal(payload.items[0].chapter, 'Host Posts');
  assert.equal(payload.items[0].title, 'Host Post');
  assert.equal(payload.items[0].mediaUrl.includes('share-token'), false);
});

test('host and guest frontends expose Host Posts controls and party view', async () => {
  const [hostHtml, hostJs, guestHtml, guestJs, styles] = await Promise.all([
    readText('../../moments/host/index.html'),
    readText('../../moments/host/host.js'),
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(hostHtml, /data-view="host-posts"/);
  assert.match(hostHtml, /id="hostPostsPanel"/);
  assert.match(hostJs, /createHostPost/);
  assert.match(hostJs, /\/host\/events\/\$\{encodeURIComponent\(eventId\)\}\/posts/);
  assert.match(guestHtml, /id="hostPostsView"/);
  assert.match(guestHtml, /Host Posts/);
  assert.match(guestJs, /loadHostPosts/);
  assert.match(guestJs, /\/events\/\$\{encodeURIComponent\(state\.event\.id\)\}\/host-posts/);
  assert.match(styles, /\.host-posts-panel/);
  assert.match(styles, /\.party-feed/);
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

function hostSubmission(overrides = {}) {
  return {
    id: 'host-submission-1',
    event_id: 'event-host',
    eventId: 'event-host',
    media_type: 'photo',
    mediaType: 'photo',
    source: 'host',
    object_key: 'moments/event-host/host-submission-1.jpg',
    objectKey: 'moments/event-host/host-submission-1.jpg',
    original_filename: 'host-photo.jpg',
    originalFilename: 'host-photo.jpg',
    mime_type: 'image/jpeg',
    mimeType: 'image/jpeg',
    size: 1000,
    duration_seconds: 0,
    durationSeconds: 0,
    guest_name: 'Host',
    guestName: 'Host',
    guest_note: 'First dance is starting.',
    guestNote: 'First dance is starting.',
    consent_at: '2026-09-19T20:15:00.000Z',
    consentAt: '2026-09-19T20:15:00.000Z',
    status: 'approved',
    deleted_at: null,
    deletedAt: null,
    created_at: '2026-09-19T20:15:00.000Z',
    createdAt: '2026-09-19T20:15:00.000Z',
    updated_at: '2026-09-19T20:15:00.000Z',
    updatedAt: '2026-09-19T20:15:00.000Z',
    ...overrides
  };
}

function hostCapsuleItem(overrides = {}) {
  return {
    id: 'host-item-1',
    event_id: 'event-host',
    eventId: 'event-host',
    submission_id: 'host-submission-1',
    submissionId: 'host-submission-1',
    title: 'Host Post',
    caption: 'First dance is starting.',
    chapter: 'Host Posts',
    captured_at: '2026-09-19T20:15:00.000Z',
    capturedAt: '2026-09-19T20:15:00.000Z',
    location: '',
    sort_order: 1,
    sortOrder: 1,
    is_visible: 1,
    isVisible: 1,
    created_at: '2026-09-19T20:15:00.000Z',
    createdAt: '2026-09-19T20:15:00.000Z',
    updated_at: '2026-09-19T20:15:00.000Z',
    updatedAt: '2026-09-19T20:15:00.000Z',
    ...overrides
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

class HostPostsFakeDb {
  constructor(seed = {}) {
    this.rateLimits = new Map();
    this.events = seed.events ? seed.events.map((event) => ({ ...event })) : [{
      id: 'event-host',
      name: 'Host Post Test',
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
      timeCapsuleTitle: 'Host Post Test Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z'
    }];
    this.tags = [{
      id: 'tag-host',
      publicCode: 'host-tag',
      label: 'Host tag',
      status: 'active',
      activeEventId: 'event-host'
    }];
    this.submissions = seed.submissions ? seed.submissions.map((submission) => ({ ...submission })) : [];
    this.items = seed.items ? seed.items.map((item) => ({ ...item })) : [];
  }

  prepare(sql) {
    return new HostPostsFakeStatement(this, sql);
  }
}

class HostPostsFakeStatement {
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

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ? AND host_token = ?')) {
      return this.db.events.find((event) => event.id === this.params[0] && event.hostToken === this.params[1]) || null;
    }

    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ?')) {
      return this.db.events.find((event) => event.id === this.params[0]) || null;
    }

    if (this.sql.includes('FROM rate_limits')) {
      return this.db.rateLimits.get(this.params[0]) || null;
    }

    if (this.sql.includes('COUNT(*) AS count')) {
      const eventId = this.params[0];
      const submissions = this.db.submissions.filter((item) => (item.event_id || item.eventId) === eventId);
      return {
        count: submissions.length,
        bytes: submissions.reduce((sum, item) => sum + Number(item.size || 0), 0)
      };
    }

    if (this.sql.includes('MAX(sort_order)')) {
      const eventItems = this.db.items.filter((item) => (item.event_id || item.eventId) === this.params[0]);
      const maxSort = eventItems.reduce((max, item) => Math.max(max, Number(item.sort_order || item.sortOrder || 0)), 0);
      return { nextSortOrder: maxSort + 1 };
    }

    if (this.sql.includes('FROM time_capsule_items') && (this.sql.includes('WHERE i.id = ?') || this.sql.includes('WHERE id = ?'))) {
      return this.buildCapsuleItem(this.db.items.find((item) => item.id === this.params[0])) || null;
    }

    return null;
  }

  async all() {
    if (this.sql.includes('FROM time_capsule_items')) {
      const eventId = this.params[0];
      const rows = this.db.items
        .filter((item) => item.event_id === eventId || item.eventId === eventId)
        .map((item) => this.buildCapsuleItem(item))
        .filter((item) => item && item.submissionStatus === 'approved' && !item.deletedAt)
        .filter((item) => this.sql.includes("s.source = 'host'") ? item.source === 'host' : true)
        .filter((item) => this.sql.includes('i.is_visible = 1') ? item.isVisible !== 0 : true)
        .sort((a, b) => (a.sort_order || a.sortOrder || 0) - (b.sort_order || b.sortOrder || 0));
      return { results: rows };
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
        source,
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
        status,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.submissions.push({
        id,
        event_id: eventId,
        eventId,
        media_type: mediaType,
        mediaType,
        source,
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
        status,
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      });
    }

    if (this.sql.includes('INSERT INTO time_capsule_items')) {
      const [
        id,
        eventId,
        submissionId,
        title,
        caption,
        chapter,
        capturedAt,
        location,
        sortOrder,
        isVisible,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.items.push({
        id,
        event_id: eventId,
        eventId,
        submission_id: submissionId,
        submissionId,
        title,
        caption,
        chapter,
        captured_at: capturedAt,
        capturedAt,
        location,
        sort_order: sortOrder,
        sortOrder,
        is_visible: isVisible,
        isVisible,
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      });
    }

    return { success: true };
  }

  buildCapsuleItem(item) {
    if (!item) return null;
    const submissionId = item.submission_id || item.submissionId;
    const submission = this.db.submissions.find((entry) => entry.id === submissionId);
    if (!submission) return null;

    return {
      ...item,
      submissionId,
      eventId: item.event_id || item.eventId,
      sortOrder: item.sort_order ?? item.sortOrder,
      isVisible: item.is_visible ?? item.isVisible,
      createdAt: item.created_at || item.createdAt,
      updatedAt: item.updated_at || item.updatedAt,
      source: submission.source || 'guest',
      mediaType: submission.media_type || submission.mediaType,
      mimeType: submission.mime_type || submission.mimeType,
      size: submission.size,
      thumbnailObjectKey: submission.thumbnail_object_key || submission.thumbnailObjectKey,
      thumbnailMimeType: submission.thumbnail_mime_type || submission.thumbnailMimeType,
      thumbnailSize: submission.thumbnail_size || submission.thumbnailSize,
      thumbnailCreatedAt: submission.thumbnail_created_at || submission.thumbnailCreatedAt,
      durationSeconds: submission.duration_seconds || submission.durationSeconds,
      guestName: submission.guest_name || submission.guestName,
      guestNote: submission.guest_note || submission.guestNote,
      submissionStatus: submission.status,
      deletedAt: submission.deleted_at || submission.deletedAt,
      submissionCreatedAt: submission.created_at || submission.createdAt,
      submissionUpdatedAt: submission.updated_at || submission.updatedAt
    };
  }
}
