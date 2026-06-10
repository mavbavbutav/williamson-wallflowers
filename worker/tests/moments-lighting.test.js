import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import worker from '../src/index.js';

const API_URL = 'https://api.example.test/moments-api';
const ORIGIN = 'https://williamsonwallflowers.com';

describe('Wallflower Moments lighting integration', () => {
  test('active tag lookup queues a scan light trigger for the event wall device', async () => {
    const db = new FakeD1({
      tagRow: activeTagRow(),
      devices: [activeDevice()]
    });
    const env = testEnv(db);

    const response = await worker.fetch(jsonRequest(`${API_URL}/tags/ww-butterfly`), env);

    assert.equal(response.status, 200);
    assert.equal(db.lightTriggers.length, 1);
    assert.deepEqual(db.lightTriggers[0], {
      eventId: 'event-1',
      wallDeviceId: 'device-1',
      triggerType: 'tag_scan',
      presetId: 2,
      brightness: 180,
      status: 'pending'
    });
  });

  test('inactive tag lookup does not queue a scan light trigger', async () => {
    const db = new FakeD1({
      tagRow: {
        ...activeTagRow(),
        tagStatus: 'inactive'
      },
      devices: [activeDevice()]
    });
    const env = testEnv(db);

    const response = await worker.fetch(jsonRequest(`${API_URL}/tags/ww-butterfly`), env);

    assert.equal(response.status, 404);
    assert.equal(db.lightTriggers.length, 0);
  });

  test('bridge polling rejects an invalid bridge token', async () => {
    const db = new FakeD1({
      devices: [activeDevice()]
    });
    const env = testEnv(db);

    const response = await worker.fetch(jsonRequest(`${API_URL}/bridge/devices/device-1/triggers`, {
      headers: {
        Authorization: 'Bearer wrong-token'
      }
    }), env);

    assert.equal(response.status, 403);
  });

  test('admin test button queues a manual trigger for the device', async () => {
    const db = new FakeD1({
      devices: [activeDevice()]
    });
    const env = testEnv(db);

    const response = await worker.fetch(jsonRequest(`${API_URL}/admin/wall-devices/device-1/triggers`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ triggerType: 'manual_test' })
    }), env);
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.ok, true);
    assert.equal(db.lightTriggers.length, 1);
    assert.deepEqual(db.lightTriggers[0], {
      eventId: 'event-1',
      wallDeviceId: 'device-1',
      triggerType: 'manual_test',
      presetId: 4,
      brightness: 180,
      status: 'pending'
    });
  });

  test('admin can delete a wall device along with its queued triggers', async () => {
    const db = new FakeD1({
      devices: [activeDevice()]
    });
    db.lightTriggers.push({ wallDeviceId: 'device-1', status: 'pending' });
    const env = testEnv(db);

    const response = await worker.fetch(jsonRequest(`${API_URL}/admin/wall-devices/device-1`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer admin-secret'
      }
    }), env);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.deletedDeviceId, 'device-1');
    assert.equal(db.devices.length, 0);
    assert.equal(db.lightTriggers.length, 0);
  });

  test('wall device delete requires the admin token', async () => {
    const db = new FakeD1({
      devices: [activeDevice()]
    });
    const env = testEnv(db);

    const response = await worker.fetch(jsonRequest(`${API_URL}/admin/wall-devices/device-1`, {
      method: 'DELETE'
    }), env);

    assert.equal(response.status, 401);
    assert.equal(db.devices.length, 1);
  });
});

function jsonRequest(url, options = {}) {
  return new Request(url, {
    method: options.method || 'GET',
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json',
      ...(options.headers || {})
    },
    body: options.body
  });
}

function testEnv(db) {
  return {
    MOMENTS_DB: db,
    MOMENTS_BUCKET: {
      put: async () => {},
      get: async () => null,
      head: async () => null,
      delete: async () => {}
    },
    MOMENTS_ADMIN_TOKEN: 'admin-secret',
    MOMENTS_TOKEN_SECRET: 'token-secret',
    PUBLIC_SITE_URL: 'https://williamsonwallflowers.com',
    MOMENTS_API_URL: 'https://api.example.test',
    ALLOWED_ORIGINS: ORIGIN
  };
}

function activeTagRow() {
  return {
    tagId: 'tag-1',
    publicCode: 'ww-butterfly',
    tagLabel: 'Butterfly tag',
    tagStatus: 'active',
    eventId: 'event-1',
    eventName: 'The Smith Wedding',
    eventDate: '2026-06-20',
    hostName: 'The Smiths',
    eventStatus: 'active',
    retentionExpiresAt: '2999-01-01T00:00:00.000Z'
  };
}

function activeDevice() {
  return {
    id: 'device-1',
    eventId: 'event-1',
    name: 'Butterfly Wall',
    status: 'active',
    bridgeTokenHash: 'expected-later',
    scanPresetId: 2,
    submissionPresetId: 3,
    manualPresetId: 4,
    brightness: 180,
    lastSeenAt: null
  };
}

class FakeD1 {
  constructor(seed = {}) {
    this.tagRow = seed.tagRow || null;
    this.eventRow = seed.eventRow || null;
    this.devices = seed.devices || [];
    this.lightTriggers = [];
    this.rateLimits = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    const normalized = normalizeSql(this.sql);

    if (normalized.includes('from rate_limits where key = ?')) {
      return this.db.rateLimits.get(this.values[0]) || null;
    }

    if (normalized.includes('from tags t') && normalized.includes('where t.public_code = ?')) {
      return this.db.tagRow;
    }

    if (normalized.includes('from wall_devices') && normalized.includes('event_id = ?')) {
      return this.db.devices.find((device) => device.eventId === this.values[0] && device.status === 'active') || null;
    }

    if (normalized.includes('from wall_devices') && normalized.includes('id = ?')) {
      return this.db.devices.find((device) => device.id === this.values[0]) || null;
    }

    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    const normalized = normalizeSql(this.sql);

    if (normalized.includes('insert into rate_limits')) {
      this.db.rateLimits.set(this.values[0], {
        windowStart: this.values[1],
        count: 1
      });
      return { success: true };
    }

    if (normalized.includes('update rate_limits set count = count + 1')) {
      const current = this.db.rateLimits.get(this.values[1]);
      if (current) current.count += 1;
      return { success: true };
    }

    if (normalized.includes('insert into light_triggers')) {
      this.db.lightTriggers.push({
        eventId: this.values[1],
        wallDeviceId: this.values[2],
        triggerType: this.values[3],
        presetId: this.values[4],
        brightness: this.values[5],
        status: this.values[6]
      });
      return { success: true };
    }

    if (normalized.includes('delete from light_triggers where wall_device_id = ?')) {
      this.db.lightTriggers = this.db.lightTriggers.filter((trigger) => trigger.wallDeviceId !== this.values[0]);
      return { success: true };
    }

    if (normalized.includes('delete from wall_devices where id = ?')) {
      this.db.devices = this.db.devices.filter((device) => device.id !== this.values[0]);
      return { success: true };
    }

    return { success: true };
  }
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}
