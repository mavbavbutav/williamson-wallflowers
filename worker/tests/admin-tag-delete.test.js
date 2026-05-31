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

test('admin can delete a reusable tag without deleting event data', async () => {
  const db = new AdminTagDeleteFakeDb({
    events: [{ id: 'event-1', name: 'Keep Me Wedding' }],
    submissions: [{ id: 'submission-1', event_id: 'event-1' }],
    tags: [{
      id: 'tag-delete',
      public_code: 'ww-delete',
      publicCode: 'ww-delete',
      label: 'Delete me tag',
      status: 'active',
      active_event_id: 'event-1',
      activeEventId: 'event-1'
    }]
  });

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/admin/tags/tag-delete', {
    method: 'DELETE',
    headers: { 'X-Admin-Token': 'admin-token' }
  }), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.deletedTagId, 'tag-delete');
  assert.equal(db.tags.length, 0);
  assert.equal(db.events.length, 1);
  assert.equal(db.submissions.length, 1);
});

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

class AdminTagDeleteFakeDb {
  constructor(seed = {}) {
    this.events = seed.events ? seed.events.map((event) => ({ ...event })) : [];
    this.submissions = seed.submissions ? seed.submissions.map((submission) => ({ ...submission })) : [];
    this.tags = seed.tags ? seed.tags.map((tag) => ({ ...tag })) : [];
  }

  prepare(sql) {
    return new AdminTagDeleteFakeStatement(this, sql);
  }
}

class AdminTagDeleteFakeStatement {
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
    if (this.sql.includes('FROM tags') && this.sql.includes('WHERE id = ?')) {
      return this.db.tags.find((tag) => tag.id === this.params[0]) || null;
    }

    return null;
  }

  async run() {
    if (this.sql.startsWith('DELETE FROM tags')) {
      this.db.tags = this.db.tags.filter((tag) => tag.id !== this.params[0]);
    }

    return { success: true };
  }
}
