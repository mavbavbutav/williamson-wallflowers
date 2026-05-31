import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const BASE_ENV = {
  MOMENTS_ADMIN_TOKEN: 'admin-token',
  MOMENTS_TOKEN_SECRET: 'test-secret',
  PUBLIC_SITE_URL: 'https://williamsonwallflowers.com',
  MOMENTS_API_URL: 'https://api.example.com',
  ALLOWED_ORIGINS: 'https://williamsonwallflowers.com'
};

test('admin can permanently delete an event and its dependent moments data', async () => {
  const db = new AdminDeleteFakeDb({
    events: [{
      id: 'event-delete',
      name: 'Delete Me Wedding',
      eventDate: '2026-09-19',
      hostName: 'Taylor',
      hostEmail: 'taylor@example.com',
      hostToken: 'host-token',
      adminToken: 'event-admin-token',
      status: 'active',
      retentionExpiresAt: '2027-09-19T23:59:59.000Z',
      timeCapsuleEnabled: true,
      timeCapsuleStatus: 'published',
      timeCapsuleTitle: 'Delete Me Wedding Time Capsule',
      timeCapsuleShareToken: 'share-token',
      timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z'
    }],
    tags: [{
      id: 'tag-1',
      active_event_id: 'event-delete',
      activeEventId: 'event-delete'
    }],
    submissions: [{
      id: 'submission-1',
      event_id: 'event-delete',
      eventId: 'event-delete',
      object_key: 'moments/event-delete/submission-1.jpg',
      objectKey: 'moments/event-delete/submission-1.jpg'
    }, {
      id: 'submission-2',
      event_id: 'event-delete',
      eventId: 'event-delete',
      object_key: 'moments/event-delete/submission-2.webm',
      objectKey: 'moments/event-delete/submission-2.webm'
    }],
    items: [{
      id: 'item-1',
      event_id: 'event-delete',
      eventId: 'event-delete',
      submission_id: 'submission-1',
      submissionId: 'submission-1'
    }]
  });
  const bucket = new AdminDeleteFakeBucket();

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-delete', {
    method: 'DELETE',
    headers: { 'X-Admin-Token': 'admin-token' }
  }), envWithDb(db, bucket));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.deletedEventId, 'event-delete');
  assert.equal(payload.deletedMedia, 2);
  assert.deepEqual(bucket.deletedKeys, [
    'moments/event-delete/submission-1.jpg',
    'moments/event-delete/submission-2.webm'
  ]);
  assert.equal(db.events.length, 0);
  assert.equal(db.submissions.length, 0);
  assert.equal(db.items.length, 0);
  assert.equal(db.tags[0].active_event_id, null);
  assert.equal(db.tags[0].activeEventId, null);
});

function envWithDb(db, bucket) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: bucket
  };
}

class AdminDeleteFakeBucket {
  constructor() {
    this.deletedKeys = [];
  }

  async delete(key) {
    this.deletedKeys.push(key);
  }
}

class AdminDeleteFakeDb {
  constructor(seed = {}) {
    this.events = seed.events ? seed.events.map((event) => ({ ...event })) : [];
    this.tags = seed.tags ? seed.tags.map((tag) => ({ ...tag })) : [];
    this.submissions = seed.submissions ? seed.submissions.map((submission) => ({ ...submission })) : [];
    this.items = seed.items ? seed.items.map((item) => ({ ...item })) : [];
  }

  prepare(sql) {
    return new AdminDeleteFakeStatement(this, sql);
  }
}

class AdminDeleteFakeStatement {
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
    if (this.sql.includes('FROM events') && this.sql.includes('WHERE id = ?')) {
      return this.db.events.find((event) => event.id === this.params[0]) || null;
    }

    return null;
  }

  async all() {
    if (this.sql.includes('FROM submissions') && this.sql.includes('WHERE event_id = ?')) {
      const eventId = this.params[0];
      return {
        results: this.db.submissions
          .filter((submission) => (submission.event_id || submission.eventId) === eventId)
          .map((submission) => ({
            id: submission.id,
            objectKey: submission.object_key || submission.objectKey
          }))
      };
    }

    return { results: [] };
  }

  async run() {
    const eventId = this.params.at(-1);

    if (this.sql.startsWith('UPDATE tags SET active_event_id = NULL')) {
      this.db.tags
        .filter((tag) => (tag.active_event_id || tag.activeEventId) === eventId)
        .forEach((tag) => {
          tag.active_event_id = null;
          tag.activeEventId = null;
        });
    }

    if (this.sql.startsWith('DELETE FROM time_capsule_items')) {
      this.db.items = this.db.items.filter((item) => (item.event_id || item.eventId) !== eventId);
    }

    if (this.sql.startsWith('DELETE FROM submissions')) {
      this.db.submissions = this.db.submissions.filter((submission) => (submission.event_id || submission.eventId) !== eventId);
    }

    if (this.sql.startsWith('DELETE FROM events')) {
      this.db.events = this.db.events.filter((event) => event.id !== eventId);
    }

    return { success: true };
  }
}
