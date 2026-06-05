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

test('admin can edit event host details and enable Time Capsule after setup', async () => {
  const db = new AdminEventEditFakeDb({
    events: [{
      id: 'event-edit',
      name: 'Original Event',
      eventDate: '2026-09-19',
      hostName: 'Taylor',
      hostEmail: 'taylor@example.com',
      hostToken: 'host-token',
      adminToken: 'event-admin-token',
      status: 'active',
      retentionExpiresAt: '2026-10-19T23:59:59.000Z',
      timeCapsuleEnabled: false,
      timeCapsuleStatus: 'draft',
      timeCapsuleTitle: '',
      timeCapsuleShareToken: '',
      timeCapsulePublishedAt: null,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z'
    }]
  });

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/events/event-edit', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': 'admin-token'
    },
    body: JSON.stringify({
      name: 'Edited Event',
      eventDate: '2026-12-25',
      hostName: 'Jordan',
      hostEmail: 'jordan@example.com',
      timeCapsuleEnabled: true
    })
  }), envWithDb(db));
  const payload = await response.json();
  const event = db.events[0];

  assert.equal(response.status, 200);
  assert.equal(payload.event.name, 'Edited Event');
  assert.equal(payload.event.hostName, 'Jordan');
  assert.equal(payload.event.hostEmail, 'jordan@example.com');
  assert.equal(payload.event.timeCapsuleEnabled, true);
  assert.equal(payload.event.timeCapsuleStatus, 'published');
  assert.equal(payload.event.timeCapsuleTitle, 'Edited Event Time Capsule');
  assert.ok(payload.event.timeCapsuleShareToken);
  assert.ok(payload.event.timeCapsulePublishedAt);

  assert.equal(event.name, 'Edited Event');
  assert.equal(event.eventDate, '2026-12-25');
  assert.equal(event.hostName, 'Jordan');
  assert.equal(event.hostEmail, 'jordan@example.com');
  assert.equal(event.timeCapsuleEnabled, true);
  assert.equal(event.timeCapsuleStatus, 'published');
  assert.equal(event.timeCapsuleTitle, 'Edited Event Time Capsule');
  assert.ok(event.timeCapsuleShareToken);
  assert.ok(event.timeCapsulePublishedAt);
});

function envWithDb(db) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: {}
  };
}

class AdminEventEditFakeDb {
  constructor(seed = {}) {
    this.events = seed.events ? seed.events.map((event) => ({ ...event })) : [];
  }

  prepare(sql) {
    return new AdminEventEditFakeStatement(this, sql);
  }
}

class AdminEventEditFakeStatement {
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

  async run() {
    if (this.sql.startsWith('UPDATE events')) {
      const [
        name,
        eventDate,
        hostName,
        hostEmail,
        status,
        hostToken,
        retentionExpiresAt,
        timeCapsuleEnabled,
        timeCapsuleStatus,
        timeCapsuleTitle,
        timeCapsuleShareToken,
        timeCapsulePublishedAt,
        updatedAt,
        eventId
      ] = this.params;
      const event = this.db.events.find((item) => item.id === eventId);

      if (event) {
        event.name = name;
        event.eventDate = eventDate;
        event.hostName = hostName;
        event.hostEmail = hostEmail;
        event.status = status;
        event.hostToken = hostToken;
        event.retentionExpiresAt = retentionExpiresAt;
        event.timeCapsuleEnabled = Boolean(timeCapsuleEnabled);
        event.timeCapsuleStatus = timeCapsuleStatus;
        event.timeCapsuleTitle = timeCapsuleTitle;
        event.timeCapsuleShareToken = timeCapsuleShareToken;
        event.timeCapsulePublishedAt = timeCapsulePublishedAt;
        event.updatedAt = updatedAt;
      }
    }

    return { success: true };
  }
}
