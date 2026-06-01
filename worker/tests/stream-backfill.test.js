import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const BASE_ENV = {
  MOMENTS_ADMIN_TOKEN: 'admin-token',
  MOMENTS_TOKEN_SECRET: 'test-secret',
  PUBLIC_SITE_URL: 'https://williamsonwallflowers.com',
  MOMENTS_API_URL: 'https://api.example.com',
  ALLOWED_ORIGINS: 'https://williamsonwallflowers.com',
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_API_TOKEN: 'stream-token'
};

test('admin Stream backfill dry run finds only approved unoptimized videos', async () => {
  const db = new StreamBackfillFakeDb({
    submissions: [
      submission({ id: 'eligible-video' }),
      submission({ id: 'approved-photo', media_type: 'photo', mediaType: 'photo' }),
      submission({ id: 'pending-video', status: 'pending' }),
      submission({ id: 'deleted-video', deleted_at: '2026-06-01T00:00:00.000Z', deletedAt: '2026-06-01T00:00:00.000Z' }),
      submission({ id: 'ready-video', stream_uid: 'ready-uid', streamUid: 'ready-uid', stream_status: 'ready', streamStatus: 'ready' }),
      submission({ id: 'error-video', stream_status: 'error', streamStatus: 'error' })
    ]
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('dry run should not call Cloudflare Stream');
  };

  try {
    const response = await worker.fetch(jsonRequest('/moments-api/admin/stream-backfill', {
      dryRun: true,
      limit: 25
    }), envWithDb(db));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.queued, 0);
    assert.equal(payload.eligible, 1);
    assert.equal(payload.remaining, 1);
    assert.deepEqual(payload.candidates.map((candidate) => candidate.id), ['eligible-video']);
    assert.equal(db.submissions.find((item) => item.id === 'eligible-video').stream_status, 'none');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin Stream backfill queues approved legacy videos in bounded batches', async () => {
  const db = new StreamBackfillFakeDb({
    submissions: [
      submission({ id: 'eligible-1', created_at: '2026-05-01T00:00:00.000Z', createdAt: '2026-05-01T00:00:00.000Z' }),
      submission({ id: 'eligible-2', created_at: '2026-05-02T00:00:00.000Z', createdAt: '2026-05-02T00:00:00.000Z' })
    ]
  });
  const copyRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    copyRequests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      success: true,
      result: {
        uid: 'stream-eligible-1',
        status: { state: 'queued' },
        created: '2026-06-01T00:00:00.000Z'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const response = await worker.fetch(jsonRequest('/moments-api/admin/stream-backfill', {
      limit: 1
    }), envWithDb(db));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.dryRun, false);
    assert.equal(payload.limit, 1);
    assert.equal(payload.queued, 1);
    assert.equal(payload.eligible, 2);
    assert.equal(payload.remaining, 1);
    assert.deepEqual(payload.candidates.map((candidate) => candidate.id), ['eligible-1']);
    assert.equal(copyRequests.length, 1);
    assert.match(copyRequests[0].url, /\/accounts\/account-id\/stream\/copy$/);
    assert.match(copyRequests[0].body.input, /^https:\/\/api\.example\.com\/moments-api\/media\/eligible-1\?mediaToken=/);
    assert.equal(copyRequests[0].body.requireSignedURLs, true);
    assert.equal(db.submissions[0].stream_uid, 'stream-eligible-1');
    assert.equal(db.submissions[0].stream_status, 'queued');
    assert.equal(db.submissions[1].stream_status, 'none');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonRequest(path, body) {
  return new Request(`https://williamsonwallflowers.com${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      'Content-Type': 'application/json',
      'X-Admin-Token': 'admin-token'
    },
    body: JSON.stringify(body)
  });
}

function envWithDb(db) {
  return {
    ...BASE_ENV,
    MOMENTS_DB: db,
    MOMENTS_BUCKET: {}
  };
}

function submission(overrides = {}) {
  return {
    id: 'eligible-video',
    event_id: 'event-1',
    eventId: 'event-1',
    media_type: 'video',
    mediaType: 'video',
    source: 'guest',
    object_key: 'moments/event-1/video.mp4',
    objectKey: 'moments/event-1/video.mp4',
    original_filename: 'video.mp4',
    originalFilename: 'video.mp4',
    mime_type: 'video/mp4',
    mimeType: 'video/mp4',
    size: 1024,
    status: 'approved',
    stream_uid: null,
    streamUid: null,
    stream_status: 'none',
    streamStatus: 'none',
    stream_error: null,
    streamError: null,
    stream_ready_at: null,
    streamReadyAt: null,
    stream_created_at: null,
    streamCreatedAt: null,
    stream_updated_at: null,
    streamUpdatedAt: null,
    deleted_at: null,
    deletedAt: null,
    created_at: '2026-05-01T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
  };
}

class StreamBackfillFakeDb {
  constructor(seed = {}) {
    this.submissions = seed.submissions ? seed.submissions.map((item) => ({ ...item })) : [];
  }

  prepare(sql) {
    return new StreamBackfillFakeStatement(this, sql);
  }
}

class StreamBackfillFakeStatement {
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
    if (this.sql.includes('COUNT(*) AS count') && this.sql.includes('FROM submissions')) {
      return { count: this.eligibleSubmissions().length };
    }

    return null;
  }

  async all() {
    if (this.sql.includes('FROM submissions') && this.sql.includes("media_type = 'video'")) {
      const limit = Number(this.params.at(-1) || 10);
      return { results: this.eligibleSubmissions().slice(0, limit) };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes('UPDATE submissions') && this.sql.includes('stream_uid = ?')) {
      const [uid, status, error, readyAt, createdAt, updatedAt, now, id] = this.params;
      const submission = this.db.submissions.find((item) => item.id === id);
      if (submission) {
        submission.stream_uid = uid;
        submission.streamUid = uid;
        submission.stream_status = status;
        submission.streamStatus = status;
        submission.stream_error = error;
        submission.streamError = error;
        submission.stream_ready_at = readyAt;
        submission.streamReadyAt = readyAt;
        submission.stream_created_at = submission.stream_created_at || createdAt;
        submission.streamCreatedAt = submission.streamCreatedAt || createdAt;
        submission.stream_updated_at = updatedAt;
        submission.streamUpdatedAt = updatedAt;
        submission.updated_at = now;
        submission.updatedAt = now;
      }
    }

    return { success: true };
  }

  eligibleSubmissions() {
    const retryErrors = this.sql.includes("stream_status = 'error'");
    return this.db.submissions
      .filter((item) => (item.media_type || item.mediaType) === 'video')
      .filter((item) => item.status === 'approved')
      .filter((item) => !(item.deleted_at || item.deletedAt))
      .filter((item) => {
        const uid = item.stream_uid || item.streamUid || '';
        const status = item.stream_status || item.streamStatus || 'none';
        if (status === 'error' && !retryErrors) return false;
        return !uid || status === 'none' || status === '' || (retryErrors && status === 'error');
      })
      .sort((a, b) => String(a.created_at || a.createdAt).localeCompare(String(b.created_at || b.createdAt)))
      .map((item) => ({
        id: item.id,
        eventId: item.event_id || item.eventId,
        mediaType: item.media_type || item.mediaType,
        source: item.source || 'guest',
        objectKey: item.object_key || item.objectKey,
        originalFilename: item.original_filename || item.originalFilename,
        mimeType: item.mime_type || item.mimeType,
        size: item.size,
        status: item.status,
        streamUid: item.stream_uid || item.streamUid || '',
        streamStatus: item.stream_status || item.streamStatus || 'none',
        streamError: item.stream_error || item.streamError || '',
        streamReadyAt: item.stream_ready_at || item.streamReadyAt || '',
        streamCreatedAt: item.stream_created_at || item.streamCreatedAt || '',
        streamUpdatedAt: item.stream_updated_at || item.streamUpdatedAt || '',
        deletedAt: item.deleted_at || item.deletedAt,
        createdAt: item.created_at || item.createdAt,
        updatedAt: item.updated_at || item.updatedAt
      }));
  }
}
