import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const BASE_ENV = {
  FROM_EMAIL: 'Williamson Wallflowers <noreply@example.com>',
  TO_EMAIL: 'jami@example.com',
  SUPPORT_EMAIL: '',
  MOMENTS_ADMIN_TOKEN: 'admin-token',
  MOMENTS_TOKEN_SECRET: 'test-secret',
  PUBLIC_SITE_URL: 'https://williamsonwallflowers.com',
  MOMENTS_API_URL: 'https://api.example.com',
  ALLOWED_ORIGINS: 'https://williamsonwallflowers.com'
};

test('inquiry emails include Wallflower Time Capsule interest', async () => {
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sentEmails.push({ url, body: JSON.parse(init.body) });
    return new Response('', { status: 202 });
  };

  try {
    const formData = new FormData();
    formData.set('name', 'Taylor Smith');
    formData.set('email', 'taylor@example.com');
    formData.set('event-date', '2026-09-19');
    formData.set('event-type', 'Wedding');
    formData.set('preferred-wall', 'The Secret Garden');
    formData.set('ask-time-capsule', 'yes');

    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/', {
      method: 'POST',
      body: formData
    }), { ...BASE_ENV, resend: 'resend-test-key' });

    assert.equal(response.status, 200);
    assert.equal(sentEmails.length, 2);
    assert.match(sentEmails[0].body.text, /Wallflower Time Capsule: Yes/);
    assert.match(sentEmails[1].body.text, /Wallflower Time Capsule/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin can create a Time Capsule-enabled event with one-year retention', async () => {
  const db = new FakeMomentsDb();
  const response = await worker.fetch(jsonRequest('/moments-api/admin/events', {
    name: 'The Smith Wedding',
    eventDate: '2026-09-19',
    hostName: 'Taylor',
    hostEmail: 'taylor@example.com',
    timeCapsuleEnabled: true
  }, { 'X-Admin-Token': 'admin-token' }), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.event.timeCapsuleEnabled, true);
  assert.equal(payload.event.timeCapsuleStatus, 'published');
  assert.ok(payload.event.timeCapsuleShareToken);
  assert.ok(payload.event.timeCapsulePublishedAt);
  assert.match(payload.event.capsuleShareUrl, /^https:\/\/williamsonwallflowers\.com\/moments\/capsule\/\?event=.*#token=/);
  assert.equal(new Date(payload.event.retentionExpiresAt).toISOString().slice(0, 10), '2027-09-19');
});

test('published Time Capsule viewer can open before moments are added', async () => {
  const db = new FakeMomentsDb({
    events: [{
      id: 'event-empty',
      name: 'The Smith Wedding',
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
      timeCapsuleTitle: 'The Smith Wedding Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z'
    }]
  });

  const viewerResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/capsules/event-empty', {
    headers: { Authorization: 'Bearer share-token' }
  }), envWithDb(db));
  const viewerPayload = await viewerResponse.json();

  assert.equal(viewerResponse.status, 200);
  assert.equal(viewerPayload.event.title, 'The Smith Wedding Time Capsule');
  assert.equal(viewerPayload.items.length, 0);
});

test('host can publish a Time Capsule before moments are added', async () => {
  const db = new FakeMomentsDb({
    events: [{
      id: 'event-empty',
      name: 'The Smith Wedding',
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
      timeCapsuleStatus: 'draft',
      timeCapsuleTitle: 'The Smith Wedding Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: null
    }]
  });

  const publishResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-empty/time-capsule',
    { status: 'published', title: 'The Smith Wedding Time Capsule' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));
  const publishPayload = await publishResponse.json();

  assert.equal(publishResponse.status, 200);
  assert.equal(publishPayload.timeCapsule.status, 'published');
  assert.ok(publishPayload.timeCapsule.publishedAt);
  assert.match(publishPayload.timeCapsule.shareUrl, /^https:\/\/williamsonwallflowers\.com\/moments\/capsule\/\?event=event-empty#token=/);
});

test('host curates approved submissions and publishes a private capsule', async () => {
  const db = new FakeMomentsDb({
    events: [{
      id: 'event-1',
      name: 'The Smith Wedding',
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
      timeCapsuleStatus: 'draft',
      timeCapsuleTitle: 'The Smith Wedding Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: null
    }],
    submissions: [
      approvedSubmission({ id: 'approved-1', createdAt: '2026-09-19T20:15:00.000Z' }),
      approvedSubmission({ id: 'pending-1', status: 'pending' })
    ]
  });
  const env = envWithDb(db);

  const rejectedResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/time-capsule/items',
    { submissionId: 'pending-1' },
    { Authorization: 'Bearer host-token' }
  ), env);
  const rejectedPayload = await rejectedResponse.json();
  assert.equal(rejectedResponse.status, 400);
  assert.match(rejectedPayload.message, /approved/i);

  const addResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/time-capsule/items',
    { submissionId: 'approved-1', title: 'Flower wall smiles', chapter: 'Reception' },
    { Authorization: 'Bearer host-token' }
  ), env);
  const addPayload = await addResponse.json();
  assert.equal(addResponse.status, 201);
  assert.equal(addPayload.item.title, 'Flower wall smiles');
  assert.equal(addPayload.item.mediaUrl.includes('share-token'), false);

  const publishResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/time-capsule',
    { status: 'published', title: 'The Smith Wedding Time Capsule' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), env);
  const publishPayload = await publishResponse.json();
  assert.equal(publishResponse.status, 200);
  assert.equal(publishPayload.timeCapsule.status, 'published');
  assert.match(publishPayload.timeCapsule.shareUrl, /^https:\/\/williamsonwallflowers\.com\/moments\/capsule\/\?event=event-1#token=/);

  const badViewerResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/capsules/event-1', {
    headers: { Authorization: 'Bearer wrong-token' }
  }), env);
  assert.equal(badViewerResponse.status, 403);

  const viewerResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/capsules/event-1', {
    headers: { Authorization: 'Bearer share-token' }
  }), env);
  const viewerPayload = await viewerResponse.json();
  assert.equal(viewerResponse.status, 200);
  assert.equal(viewerPayload.event.title, 'The Smith Wedding Time Capsule');
  assert.equal(viewerPayload.items.length, 1);
  assert.equal(viewerPayload.items[0].title, 'Flower wall smiles');
});

function jsonRequest(path, body, headers = {}, method = 'POST') {
  return new Request(`https://williamsonwallflowers.com${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function envWithDb(db) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: {
      put: async () => undefined,
      get: async () => null,
      head: async () => null,
      delete: async () => undefined
    }
  };
}

function approvedSubmission(overrides = {}) {
  return {
    id: 'approved-1',
    event_id: 'event-1',
    eventId: 'event-1',
    media_type: 'photo',
    mediaType: 'photo',
    object_key: 'moments/event-1/approved-1.jpg',
    objectKey: 'moments/event-1/approved-1.jpg',
    original_filename: 'guest.jpg',
    originalFilename: 'guest.jpg',
    mime_type: 'image/jpeg',
    mimeType: 'image/jpeg',
    size: 1000,
    duration_seconds: 0,
    durationSeconds: 0,
    guest_name: 'Avery',
    guestName: 'Avery',
    guest_note: 'Loved this wall',
    guestNote: 'Loved this wall',
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

class FakeMomentsDb {
  constructor(seed = {}) {
    this.events = seed.events ? seed.events.map((event) => ({ ...event })) : [];
    this.submissions = seed.submissions ? seed.submissions.map((submission) => ({ ...submission })) : [];
    this.items = seed.items ? seed.items.map((item) => ({ ...item })) : [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
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

    if (this.sql.includes('FROM submissions') && this.sql.includes('WHERE s.id = ?')) {
      const submission = this.db.submissions.find((item) => item.id === this.params[0]);
      const event = submission && this.db.events.find((item) => item.id === (submission.eventId || submission.event_id));
      return submission && event
        ? { ...submission, hostToken: event.hostToken, eventAdminToken: event.adminToken }
        : null;
    }

    if (this.sql.includes('FROM time_capsule_items') && this.sql.includes('WHERE event_id = ? AND submission_id = ?')) {
      return this.db.items.find((item) => (item.event_id || item.eventId) === this.params[0] && (item.submission_id || item.submissionId) === this.params[1]) || null;
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
        .filter((item) => this.sql.includes('i.is_visible = 1') ? item.isVisible !== 0 : true)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      return { results: rows };
    }

    if (this.sql.includes('FROM submissions') && this.sql.includes('WHERE event_id = ?')) {
      const eventId = this.params[0];
      return {
        results: this.db.submissions.filter((item) => (item.event_id || item.eventId) === eventId && item.status !== 'deleted')
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes('INSERT INTO events')) {
      const [
        id,
        name,
        eventDate,
        hostName,
        hostEmail,
        hostToken,
        adminToken,
        retentionExpiresAt,
        createdAt,
        updatedAt,
        timeCapsuleEnabled,
        timeCapsuleStatus,
        timeCapsuleTitle,
        timeCapsuleShareToken,
        timeCapsulePublishedAt
      ] = this.params;
      this.db.events.push({
        id,
        name,
        eventDate,
        hostName,
        hostEmail,
        hostToken,
        adminToken,
        status: 'active',
        retentionExpiresAt,
        createdAt,
        updatedAt,
        timeCapsuleEnabled: Boolean(timeCapsuleEnabled),
        timeCapsuleStatus,
        timeCapsuleTitle,
        timeCapsuleShareToken,
        timeCapsulePublishedAt
      });
    }

    if (this.sql.includes('UPDATE events')) {
      const event = this.db.events.find((item) => item.id === this.params.at(-1));
      if (event && this.sql.includes('time_capsule_status')) {
        event.timeCapsuleStatus = this.params[0];
        event.timeCapsuleTitle = this.params[1];
        event.timeCapsulePublishedAt = this.params[2];
        event.updatedAt = this.params[3];
      }
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
