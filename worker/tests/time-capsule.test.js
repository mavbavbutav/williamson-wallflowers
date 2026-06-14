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

test('spatial capsule migration creates layout, cluster, and placement tables', async () => {
  const migration = await readText('../migrations/0021_wallflower_spatial_capsule.sql');
  const compactMigration = migration.replace(/\s+/g, ' ');
  const layoutTable = tableSchema(migration, 'time_capsule_spatial_layouts');
  const clusterTable = tableSchema(migration, 'time_capsule_spatial_clusters');
  const placementTable = tableSchema(migration, 'time_capsule_spatial_placements');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS time_capsule_spatial_layouts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS time_capsule_spatial_clusters/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS time_capsule_spatial_placements/);

  assert.match(layoutTable, /event_id TEXT NOT NULL REFERENCES events\(id\) ON DELETE CASCADE/);
  assert.match(layoutTable, /status TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'published', 'failed', 'archived'\)\)/);
  assert.match(layoutTable, /version INTEGER NOT NULL DEFAULT 1/);
  assert.match(layoutTable, /generation_status TEXT NOT NULL DEFAULT 'ready' CHECK \(generation_status IN \('queued', 'running', 'ready', 'failed'\)\)/);
  assert.match(layoutTable, /layout_mode TEXT NOT NULL DEFAULT 'timeline_path' CHECK \(layout_mode IN \('spatial', 'visual_cluster', 'timeline_path'\)\)/);
  assert.match(layoutTable, /input_fingerprint TEXT NOT NULL DEFAULT ''/);
  assert.match(layoutTable, /generator_version INTEGER NOT NULL DEFAULT 1/);
  assert.match(layoutTable, /published_at TEXT/);

  assert.match(clusterTable, /layout_id TEXT NOT NULL REFERENCES time_capsule_spatial_layouts\(id\) ON DELETE CASCADE/);
  assert.match(clusterTable, /anchor_x REAL NOT NULL DEFAULT 0/);
  assert.match(clusterTable, /anchor_y REAL NOT NULL DEFAULT 0/);
  assert.match(clusterTable, /anchor_z REAL NOT NULL DEFAULT 0/);
  assert.match(clusterTable, /evidence_json TEXT NOT NULL DEFAULT '\{\}'/);

  assert.match(placementTable, /event_id TEXT NOT NULL/);
  assert.match(placementTable, /layout_id TEXT NOT NULL/);
  assert.match(placementTable, /cluster_id TEXT NOT NULL/);
  assert.match(placementTable, /time_capsule_item_id TEXT NOT NULL/);
  assert.match(placementTable, /position_x REAL NOT NULL DEFAULT 0/);
  assert.match(placementTable, /position_y REAL NOT NULL DEFAULT 0/);
  assert.match(placementTable, /position_z REAL NOT NULL DEFAULT 0/);
  assert.match(placementTable, /rotation_x REAL NOT NULL DEFAULT 0/);
  assert.match(placementTable, /rotation_y REAL NOT NULL DEFAULT 0/);
  assert.match(placementTable, /rotation_z REAL NOT NULL DEFAULT 0/);
  assert.match(placementTable, /scale REAL NOT NULL DEFAULT 1/);
  assert.match(placementTable, /evidence_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(placementTable, /FOREIGN KEY \(event_id, layout_id\) REFERENCES time_capsule_spatial_layouts\(event_id, id\) ON DELETE CASCADE/);
  assert.match(placementTable, /FOREIGN KEY \(layout_id, cluster_id\) REFERENCES time_capsule_spatial_clusters\(layout_id, id\) ON DELETE CASCADE/);
  assert.match(placementTable, /FOREIGN KEY \(event_id, time_capsule_item_id\) REFERENCES time_capsule_items\(event_id, id\) ON DELETE CASCADE/);

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_layout_one_published/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_spatial_layouts_event_status/);
  assert.match(compactMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_layouts_event_id ON time_capsule_spatial_layouts\(event_id, id\)/);
  assert.match(compactMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_clusters_layout_id ON time_capsule_spatial_clusters\(layout_id, id\)/);
  assert.match(compactMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_time_capsule_items_event_id_spatial ON time_capsule_items\(event_id, id\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_spatial_clusters_layout_order/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_spatial_placements_layout_item/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_spatial_placements_layout_order/);
});

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

test('host can generate and publish an adaptive spatial layout', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1', createdAt: '2026-09-19T20:00:00.000Z' }),
      approvedSubmission({ id: 'photo-2', createdAt: '2026-09-19T20:10:00.000Z' }),
      approvedSubmission({ id: 'audio-1', media_type: 'audio', mediaType: 'audio', mime_type: 'audio/mpeg', mimeType: 'audio/mpeg', createdAt: '2026-09-19T20:12:00.000Z' })
    ],
    items: [
      capsuleItem({ id: 'item-1', submissionId: 'photo-1', sortOrder: 1, capturedAt: '2026-09-19T20:00:00.000Z' }),
      capsuleItem({ id: 'item-2', submissionId: 'photo-2', sortOrder: 2, capturedAt: '2026-09-19T20:10:00.000Z' }),
      capsuleItem({ id: 'item-3', submissionId: 'audio-1', sortOrder: 3, capturedAt: '2026-09-19T20:12:00.000Z' })
    ],
    insights: [
      mediaInsight({ submissionId: 'photo-1', backgroundCues: ['soft gold backdrop'], lightingTags: ['warm'], dominantColors: ['gold'] }),
      mediaInsight({ submissionId: 'photo-2', backgroundCues: ['soft gold backdrop'], lightingTags: ['warm'], dominantColors: ['gold'] })
    ]
  });

  const generateResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const generated = await generateResponse.json();

  assert.equal(generateResponse.status, 201);
  assert.equal(generated.spatialLayout.status, 'draft');
  assert.equal(generated.spatialLayout.layoutMode, 'visual_cluster');
  assert.equal(generated.spatialClusters.length >= 1, true);
  assert.equal(generated.spatialPlacements.length, 3);
  assert.ok(generated.spatialPlacements.find((placement) => placement.itemId === 'item-3'));

  const publishResponse = await worker.fetch(jsonRequest(
    `/moments-api/host/spatial-layouts/${generated.spatialLayout.id}/publish`,
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const published = await publishResponse.json();

  assert.equal(publishResponse.status, 200);
  assert.equal(published.spatialLayout.status, 'published');
});

test('published capsule includes guest-safe spatial layout without private evidence', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [approvedSubmission({ id: 'photo-1' })],
    items: [capsuleItem({ id: 'item-1', submissionId: 'photo-1' })],
    layouts: [spatialLayout({ id: 'layout-published', status: 'published', inputFingerprint: 'private-fingerprint', input_fingerprint: 'private-fingerprint' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-published', evidenceJson: '{"gps":[36,-86]}' })],
    placements: [spatialPlacement({ id: 'placement-1', layoutId: 'layout-published', clusterId: 'cluster-1', itemId: 'item-1', evidenceJson: '{"rawGps":"secret"}' })]
  });

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/capsules/event-1', {
    headers: { Authorization: 'Bearer share-token' }
  }), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.spatialLayout.status, 'published');
  assert.equal(payload.spatialLayout.inputFingerprint, undefined);
  assert.equal(payload.spatialClusters[0].evidence, undefined);
  assert.equal(payload.spatialPlacements[0].evidence, undefined);
  assert.equal(JSON.stringify(payload).includes('private-fingerprint'), false);
  assert.equal(JSON.stringify(payload).includes('rawGps'), false);
});

test('spatial generator falls back to timeline path when visual evidence is weak', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1', createdAt: '2026-09-19T20:00:00.000Z' }),
      approvedSubmission({ id: 'photo-2', createdAt: '2026-09-19T20:25:00.000Z' })
    ],
    items: [
      capsuleItem({ id: 'item-1', submissionId: 'photo-1', sortOrder: 1 }),
      capsuleItem({ id: 'item-2', submissionId: 'photo-2', sortOrder: 2 })
    ]
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.spatialLayout.layoutMode, 'timeline_path');
  assert.equal(payload.spatialClusters.length, 1);
  assert.match(payload.spatialClusters[0].label, /Story|Sequence|Moments/);
});

test('spatial generator ignores repeated cues outside visible capsule items', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1', createdAt: '2026-09-19T20:00:00.000Z' }),
      approvedSubmission({ id: 'photo-2', createdAt: '2026-09-19T20:25:00.000Z' }),
      approvedSubmission({ id: 'stray-1', createdAt: '2026-09-19T20:30:00.000Z' }),
      approvedSubmission({ id: 'stray-2', createdAt: '2026-09-19T20:35:00.000Z' })
    ],
    items: [
      capsuleItem({ id: 'item-1', submissionId: 'photo-1', sortOrder: 1 }),
      capsuleItem({ id: 'item-2', submissionId: 'photo-2', sortOrder: 2 })
    ],
    insights: [
      mediaInsight({ submissionId: 'stray-1', backgroundCues: ['velvet arch'] }),
      mediaInsight({ submissionId: 'stray-2', backgroundCues: ['velvet arch'] })
    ]
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.spatialLayout.layoutMode, 'timeline_path');
  assert.equal(payload.spatialClusters.length, 1);
  assert.match(payload.spatialClusters[0].label, /Story|Sequence|Moments/);
});

test('spatial generator ignores repeated cues from failed visual insights', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1', createdAt: '2026-09-19T20:00:00.000Z' }),
      approvedSubmission({ id: 'photo-2', createdAt: '2026-09-19T20:25:00.000Z' })
    ],
    items: [
      capsuleItem({ id: 'item-1', submissionId: 'photo-1', sortOrder: 1 }),
      capsuleItem({ id: 'item-2', submissionId: 'photo-2', sortOrder: 2 })
    ],
    insights: [
      mediaInsight({ submissionId: 'photo-1', status: 'failed', visionStatus: 'failed', vision_status: 'failed', backgroundCues: ['green wall'] }),
      mediaInsight({ submissionId: 'photo-2', status: 'failed', visionStatus: 'failed', vision_status: 'failed', backgroundCues: ['green wall'] })
    ]
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.spatialLayout.layoutMode, 'timeline_path');
  assert.match(payload.spatialClusters[0].label, /Story|Sequence|Moments/);
});

test('spatial generator ignores analyzed insights when vision status failed', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1', createdAt: '2026-09-19T20:00:00.000Z' }),
      approvedSubmission({ id: 'photo-2', createdAt: '2026-09-19T20:25:00.000Z' })
    ],
    items: [
      capsuleItem({ id: 'item-1', submissionId: 'photo-1', sortOrder: 1 }),
      capsuleItem({ id: 'item-2', submissionId: 'photo-2', sortOrder: 2 })
    ],
    insights: [
      mediaInsight({ submissionId: 'photo-1', status: 'analyzed', visionStatus: 'failed', vision_status: 'failed', backgroundCues: ['green wall'] }),
      mediaInsight({ submissionId: 'photo-2', status: 'analyzed', visionStatus: 'failed', vision_status: 'failed', backgroundCues: ['green wall'] })
    ]
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.spatialLayout.layoutMode, 'timeline_path');
  assert.match(payload.spatialClusters[0].label, /Story|Sequence|Moments/);
});

test('host can fetch generated draft with private spatial evidence', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1' }),
      approvedSubmission({ id: 'photo-2' })
    ],
    items: [
      capsuleItem({ id: 'item-1', submissionId: 'photo-1', sortOrder: 1 }),
      capsuleItem({ id: 'item-2', submissionId: 'photo-2', sortOrder: 2 })
    ],
    insights: [
      mediaInsight({ submissionId: 'photo-1', backgroundCues: ['soft gold backdrop'] }),
      mediaInsight({ submissionId: 'photo-2', backgroundCues: ['soft gold backdrop'] })
    ]
  });

  const generateResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const generated = await generateResponse.json();
  const draftResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-1/spatial-layouts/draft', {
    headers: { Authorization: 'Bearer host-token' }
  }), envWithDb(db));
  const draft = await draftResponse.json();

  assert.equal(generateResponse.status, 201);
  assert.equal(draftResponse.status, 200);
  assert.equal(draft.spatialLayout.id, generated.spatialLayout.id);
  assert.equal(typeof draft.spatialLayout.inputFingerprint, 'string');
  assert.ok(draft.spatialLayout.inputFingerprint);
  assert.equal(draft.spatialClusters[0].evidence.cue, 'soft gold backdrop');
  assert.equal(draft.spatialPlacements[0].evidence.submissionId, 'photo-1');
});

test('host can patch draft spatial cluster and placement', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft' })],
    clusters: [
      spatialCluster({ id: 'cluster-1', layoutId: 'layout-draft', label: 'Story path', routeOrder: 1 }),
      spatialCluster({ id: 'cluster-2', layoutId: 'layout-draft', label: 'Second path', routeOrder: 2 })
    ],
    placements: [
      spatialPlacement({ id: 'placement-1', layoutId: 'layout-draft', clusterId: 'cluster-1', routeOrder: 1 })
    ]
  });

  const clusterResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/clusters/cluster-1',
    { label: 'Reception glow', summary: 'Warm reception moments', routeOrder: 3 },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));
  const clusterPayload = await clusterResponse.json();
  const placementResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/placements/placement-1',
    { clusterId: 'cluster-2', routeOrder: 9 },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));
  const placementPayload = await placementResponse.json();

  assert.equal(clusterResponse.status, 200);
  assert.equal(clusterPayload.spatialCluster.label, 'Reception glow');
  assert.equal(clusterPayload.spatialCluster.summary, 'Warm reception moments');
  assert.equal(clusterPayload.spatialCluster.routeOrder, 3);
  assert.equal(placementResponse.status, 200);
  assert.equal(placementPayload.spatialPlacement.clusterId, 'cluster-2');
  assert.equal(placementPayload.spatialPlacement.routeOrder, 9);
});

test('spatial patch routes reject published layouts', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-published', status: 'published' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-published', label: 'Published path' })],
    placements: [spatialPlacement({ id: 'placement-1', layoutId: 'layout-published', clusterId: 'cluster-1', routeOrder: 1 })]
  });

  const layoutResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-published',
    { layoutMode: 'timeline_path' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));
  const clusterResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-published/clusters/cluster-1',
    { label: 'Should not save' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));
  const placementResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-published/placements/placement-1',
    { routeOrder: 5 },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));

  assert.equal(layoutResponse.status, 400);
  assert.match((await layoutResponse.json()).message, /draft/i);
  assert.equal(clusterResponse.status, 400);
  assert.match((await clusterResponse.json()).message, /draft/i);
  assert.equal(placementResponse.status, 400);
  assert.match((await placementResponse.json()).message, /draft/i);
  assert.equal(db.clusters[0].label, 'Published path');
  assert.equal(db.placements[0].routeOrder, 1);
});

test('spatial patch routes reject stale draft transitions at write time', async () => {
  const layoutDb = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft', layoutMode: 'timeline_path', layout_mode: 'timeline_path' })]
  });
  layoutDb.beforeRun = (statement) => {
    if (statement.sql.includes('layout_mode = ?')) {
      layoutDb.layouts[0].status = 'published';
      layoutDb.beforeRun = null;
    }
  };

  const layoutResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft',
    { layoutMode: 'visual_cluster' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(layoutDb));

  assert.equal(layoutResponse.status, 409);
  assert.match((await layoutResponse.json()).message, /draft|changed|stale/i);
  assert.equal(layoutDb.layouts[0].layoutMode, 'timeline_path');

  const clusterDb = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-draft', label: 'Story path' })]
  });
  clusterDb.beforeRun = (statement) => {
    if (statement.sql.includes('UPDATE time_capsule_spatial_clusters')) {
      clusterDb.layouts[0].status = 'archived';
      clusterDb.beforeRun = null;
    }
  };

  const clusterResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/clusters/cluster-1',
    { label: 'Changed label' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(clusterDb));

  assert.equal(clusterResponse.status, 409);
  assert.match((await clusterResponse.json()).message, /draft|changed|stale/i);
  assert.equal(clusterDb.clusters[0].label, 'Story path');

  const placementDb = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-draft' })],
    placements: [spatialPlacement({ id: 'placement-1', layoutId: 'layout-draft', clusterId: 'cluster-1', routeOrder: 1 })]
  });
  placementDb.beforeRun = (statement) => {
    if (statement.sql.includes('UPDATE time_capsule_spatial_placements')) {
      placementDb.layouts[0].status = 'published';
      placementDb.beforeRun = null;
    }
  };

  const placementResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/placements/placement-1',
    { routeOrder: 7 },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(placementDb));

  assert.equal(placementResponse.status, 409);
  assert.match((await placementResponse.json()).message, /draft|changed|stale/i);
  assert.equal(placementDb.placements[0].routeOrder, 1);
});

test('spatial publish rejects drafts that are not ready', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [
      spatialLayout({ id: 'layout-running', status: 'draft', generationStatus: 'running', generation_status: 'running' }),
      spatialLayout({ id: 'layout-failed', status: 'draft', generationStatus: 'failed', generation_status: 'failed' }),
      spatialLayout({ id: 'layout-not-ready', status: 'draft', generationStatus: 'not_ready', generation_status: 'not_ready' })
    ]
  });

  for (const layoutId of ['layout-running', 'layout-failed', 'layout-not-ready']) {
    const response = await worker.fetch(jsonRequest(
      `/moments-api/host/spatial-layouts/${layoutId}/publish`,
      {},
      { Authorization: 'Bearer host-token' }
    ), envWithDb(db));
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.match(payload.message, /ready/i);
  }
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-running').status, 'draft');
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-failed').status, 'draft');
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-not-ready').status, 'draft');
});

test('failed spatial publish keeps the previous published layout usable', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [
      spatialLayout({ id: 'layout-old', status: 'published' }),
      spatialLayout({ id: 'layout-draft', status: 'draft', generationStatus: 'ready', generation_status: 'ready' })
    ],
    failOnSqlIncludes: "SET status = 'published'"
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/publish',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));

  assert.equal(response.status, 500);
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-old').status, 'published');
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-draft').status, 'draft');
});

test('spatial publish replaces an existing published layout under the unique status constraint', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [
      spatialLayout({ id: 'layout-old', status: 'published' }),
      spatialLayout({ id: 'layout-draft', status: 'draft', generationStatus: 'ready', generation_status: 'ready' })
    ],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-draft' })],
    placements: [spatialPlacement({ id: 'placement-1', layoutId: 'layout-draft', clusterId: 'cluster-1' })]
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/publish',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const payload = await response.json();
  const publishedLayouts = db.layouts.filter((layout) => layout.status === 'published');

  assert.equal(response.status, 200);
  assert.equal(payload.spatialLayout.id, 'layout-draft');
  assert.equal(publishedLayouts.length, 1);
  assert.equal(publishedLayouts[0].id, 'layout-draft');
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-old').status, 'archived');
});

test('spatial publish rejects stale draft readiness at write time', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [
      spatialLayout({ id: 'layout-old', status: 'published' }),
      spatialLayout({ id: 'layout-draft', status: 'draft', generationStatus: 'ready', generation_status: 'ready' })
    ]
  });
  db.beforeRun = (statement) => {
    if (statement.sql.includes("status = 'archived'")) {
      const draft = db.layouts.find((layout) => layout.id === 'layout-draft');
      draft.generationStatus = 'running';
      draft.generation_status = 'running';
      db.beforeRun = null;
    }
  };

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/publish',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.match(payload.message, /ready|draft|changed|stale/i);
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-old').status, 'published');
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-draft').status, 'draft');
  assert.equal(db.layouts.find((layout) => layout.id === 'layout-draft').generationStatus, 'running');
});

test('unauthorized host spatial route rejects wrong token', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [approvedSubmission({ id: 'photo-1' })],
    items: [capsuleItem({ id: 'item-1', submissionId: 'photo-1' })]
  });

  const response = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate',
    {},
    { Authorization: 'Bearer wrong-token' }
  ), envWithDb(db));

  assert.equal(response.status, 403);
});

test('layout scoped spatial routes reject wrong token', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft' })]
  });

  const patchResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft',
    { layoutMode: 'visual_cluster' },
    { Authorization: 'Bearer wrong-token' },
    'PATCH'
  ), envWithDb(db));
  const publishResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/publish',
    {},
    { Authorization: 'Bearer wrong-token' }
  ), envWithDb(db));

  assert.equal(patchResponse.status, 403);
  assert.equal(publishResponse.status, 403);
});

test('host, event admin, and global admin tokens can access spatial draft routes', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-draft' })],
    placements: [spatialPlacement({ id: 'placement-1', layoutId: 'layout-draft', clusterId: 'cluster-1' })]
  });

  for (const token of ['host-token', 'event-admin-token', 'admin-token']) {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-1/spatial-layouts/draft', {
      headers: { Authorization: `Bearer ${token}` }
    }), envWithDb(db));
    assert.equal(response.status, 200);
  }
});

test('guest capsule filters hidden spatial placements', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [
      approvedSubmission({ id: 'photo-1' }),
      approvedSubmission({ id: 'photo-hidden' })
    ],
    items: [
      capsuleItem({ id: 'item-visible', submissionId: 'photo-1', is_visible: 1, isVisible: 1 }),
      capsuleItem({ id: 'item-hidden', submissionId: 'photo-hidden', is_visible: 0, isVisible: 0 })
    ],
    layouts: [spatialLayout({ id: 'layout-published', status: 'published' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-published' })],
    placements: [
      spatialPlacement({ id: 'placement-visible', layoutId: 'layout-published', clusterId: 'cluster-1', itemId: 'item-visible' }),
      spatialPlacement({ id: 'placement-hidden', layoutId: 'layout-published', clusterId: 'cluster-1', itemId: 'item-hidden' })
    ]
  });

  const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/capsules/event-1', {
    headers: { Authorization: 'Bearer share-token' }
  }), envWithDb(db));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.spatialPlacements.map((placement) => placement.itemId), ['item-visible']);
  assert.equal(JSON.stringify(payload).includes('item-hidden'), false);
});

test('spatial routes reject trailing path segments', async () => {
  const db = new FakeMomentsDb({
    events: [timeCapsuleEvent()],
    submissions: [approvedSubmission({ id: 'photo-1' })],
    items: [capsuleItem({ id: 'item-1', submissionId: 'photo-1' })],
    layouts: [spatialLayout({ id: 'layout-draft', status: 'draft' })],
    clusters: [spatialCluster({ id: 'cluster-1', layoutId: 'layout-draft', label: 'Story path' })]
  });

  const generateResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/events/event-1/spatial-layouts/generate/extra',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const publishResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/publish/extra',
    {},
    { Authorization: 'Bearer host-token' }
  ), envWithDb(db));
  const clusterResponse = await worker.fetch(jsonRequest(
    '/moments-api/host/spatial-layouts/layout-draft/clusters/cluster-1/extra',
    { label: 'Should not save' },
    { Authorization: 'Bearer host-token' },
    'PATCH'
  ), envWithDb(db));

  assert.equal(generateResponse.status, 404);
  assert.equal(publishResponse.status, 404);
  assert.equal(clusterResponse.status, 404);
  assert.equal(db.layouts.length, 1);
  assert.equal(db.layouts[0].status, 'draft');
  assert.equal(db.clusters[0].label, 'Story path');
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

function timeCapsuleEvent(overrides = {}) {
  return {
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
    timeCapsuleStatus: 'published',
    timeCapsuleTitle: 'The Smith Wedding Time Capsule',
    timeCapsuleShareToken: 'share-token',
    timeCapsulePublishedAt: '2026-05-01T00:00:00.000Z',
    ...overrides
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

function capsuleItem(overrides = {}) {
  const eventId = overrides.eventId || overrides.event_id || 'event-1';
  const submissionId = overrides.submissionId || overrides.submission_id || 'photo-1';
  return {
    id: 'item-1',
    event_id: eventId,
    eventId,
    submission_id: submissionId,
    submissionId,
    title: 'Flower wall smiles',
    caption: '',
    chapter: 'Guest moments',
    captured_at: '2026-09-19T20:00:00.000Z',
    capturedAt: '2026-09-19T20:00:00.000Z',
    location: '',
    sort_order: 1,
    sortOrder: 1,
    is_visible: 1,
    isVisible: 1,
    created_at: '2026-09-19T20:00:00.000Z',
    createdAt: '2026-09-19T20:00:00.000Z',
    updated_at: '2026-09-19T20:00:00.000Z',
    updatedAt: '2026-09-19T20:00:00.000Z',
    ...overrides
  };
}

function mediaInsight(overrides = {}) {
  const eventId = overrides.eventId || overrides.event_id || 'event-1';
  const submissionId = overrides.submissionId || overrides.submission_id || 'photo-1';
  const dominantColors = overrides.dominantColors || ['gold'];
  const sceneTags = overrides.sceneTags || [];
  const lightingTags = overrides.lightingTags || [];
  const compositionTags = overrides.compositionTags || [];
  const backgroundCues = overrides.backgroundCues || [];
  return {
    submission_id: submissionId,
    submissionId,
    event_id: eventId,
    eventId,
    status: 'analyzed',
    source_kind: 'photo',
    sourceKind: 'photo',
    vision_status: 'ready',
    visionStatus: 'ready',
    quality_score: 0.9,
    qualityScore: 0.9,
    people_count: 2,
    peopleCount: 2,
    face_count: 2,
    faceCount: 2,
    dominant_colors: JSON.stringify(dominantColors),
    dominantColors: JSON.stringify(dominantColors),
    scene_tags: JSON.stringify(sceneTags),
    sceneTags: JSON.stringify(sceneTags),
    lighting_tags: JSON.stringify(lightingTags),
    lightingTags: JSON.stringify(lightingTags),
    composition_tags: JSON.stringify(compositionTags),
    compositionTags: JSON.stringify(compositionTags),
    background_cues: JSON.stringify(backgroundCues),
    backgroundCues: JSON.stringify(backgroundCues),
    summary: '',
    updated_at: '2026-09-19T20:20:00.000Z',
    updatedAt: '2026-09-19T20:20:00.000Z',
    ...overrides
  };
}

function spatialLayout(overrides = {}) {
  const eventId = overrides.eventId || overrides.event_id || 'event-1';
  return {
    id: 'layout-1',
    event_id: eventId,
    eventId,
    status: 'draft',
    version: 1,
    generation_status: 'ready',
    generationStatus: 'ready',
    layout_mode: 'timeline_path',
    layoutMode: 'timeline_path',
    confidence_score: 0.5,
    confidenceScore: 0.5,
    input_fingerprint: 'test',
    inputFingerprint: 'test',
    generator_version: 1,
    generatorVersion: 1,
    error_message: '',
    errorMessage: '',
    published_at: null,
    publishedAt: null,
    created_at: '2026-09-19T20:30:00.000Z',
    createdAt: '2026-09-19T20:30:00.000Z',
    updated_at: '2026-09-19T20:30:00.000Z',
    updatedAt: '2026-09-19T20:30:00.000Z',
    ...overrides
  };
}

function spatialCluster(overrides = {}) {
  const layoutId = overrides.layoutId || overrides.layout_id || 'layout-1';
  return {
    id: 'cluster-1',
    layout_id: layoutId,
    layoutId,
    label: 'Story path',
    summary: '',
    route_order: 1,
    routeOrder: 1,
    anchor_x: 0,
    anchorX: 0,
    anchor_y: 0,
    anchorY: 0,
    anchor_z: 0,
    anchorZ: 0,
    confidence_score: 0.5,
    confidenceScore: 0.5,
    evidence_json: '{}',
    evidenceJson: '{}',
    created_at: '2026-09-19T20:30:00.000Z',
    createdAt: '2026-09-19T20:30:00.000Z',
    updated_at: '2026-09-19T20:30:00.000Z',
    updatedAt: '2026-09-19T20:30:00.000Z',
    ...overrides
  };
}

function spatialPlacement(overrides = {}) {
  const eventId = overrides.eventId || overrides.event_id || 'event-1';
  const layoutId = overrides.layoutId || overrides.layout_id || 'layout-1';
  const clusterId = overrides.clusterId || overrides.cluster_id || 'cluster-1';
  const itemId = overrides.itemId || overrides.time_capsule_item_id || overrides.timeCapsuleItemId || 'item-1';
  return {
    id: 'placement-1',
    event_id: eventId,
    eventId,
    layout_id: layoutId,
    layoutId,
    cluster_id: clusterId,
    clusterId,
    time_capsule_item_id: itemId,
    timeCapsuleItemId: itemId,
    itemId,
    route_order: 1,
    routeOrder: 1,
    position_x: 0,
    positionX: 0,
    position_y: 0,
    positionY: 0,
    position_z: 0,
    positionZ: 0,
    rotation_x: 0,
    rotationX: 0,
    rotation_y: 0,
    rotationY: 0,
    rotation_z: 0,
    rotationZ: 0,
    scale: 1,
    confidence_score: 0.5,
    confidenceScore: 0.5,
    evidence_json: '{}',
    evidenceJson: '{}',
    created_at: '2026-09-19T20:30:00.000Z',
    createdAt: '2026-09-19T20:30:00.000Z',
    updated_at: '2026-09-19T20:30:00.000Z',
    updatedAt: '2026-09-19T20:30:00.000Z',
    ...overrides
  };
}

async function readText(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function tableSchema(migration, tableName) {
  const match = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\(([^;]+)\\);`, 's'));
  assert.ok(match, `Expected migration to create ${tableName}`);
  return match[1].replace(/\s+/g, ' ');
}

class FakeMomentsDb {
  constructor(seed = {}) {
    this.events = seed.events ? seed.events.map((event) => ({ ...event })) : [];
    this.submissions = seed.submissions ? seed.submissions.map((submission) => ({ ...submission })) : [];
    this.items = seed.items ? seed.items.map((item) => ({ ...item })) : [];
    this.insights = seed.insights ? seed.insights.map((insight) => ({ ...insight })) : [];
    this.layouts = seed.layouts ? seed.layouts.map((layout) => ({ ...layout })) : [];
    this.clusters = seed.clusters ? seed.clusters.map((cluster) => ({ ...cluster })) : [];
    this.placements = seed.placements ? seed.placements.map((placement) => ({ ...placement })) : [];
    this.failOnSqlIncludes = seed.failOnSqlIncludes || '';
    this.beforeRun = seed.beforeRun || null;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const snapshot = this.snapshot();
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  snapshot() {
    return {
      events: this.events.map((item) => ({ ...item })),
      submissions: this.submissions.map((item) => ({ ...item })),
      items: this.items.map((item) => ({ ...item })),
      insights: this.insights.map((item) => ({ ...item })),
      layouts: this.layouts.map((item) => ({ ...item })),
      clusters: this.clusters.map((item) => ({ ...item })),
      placements: this.placements.map((item) => ({ ...item }))
    };
  }

  restore(snapshot) {
    this.events = snapshot.events.map((item) => ({ ...item }));
    this.submissions = snapshot.submissions.map((item) => ({ ...item }));
    this.items = snapshot.items.map((item) => ({ ...item }));
    this.insights = snapshot.insights.map((item) => ({ ...item }));
    this.layouts = snapshot.layouts.map((item) => ({ ...item }));
    this.clusters = snapshot.clusters.map((item) => ({ ...item }));
    this.placements = snapshot.placements.map((item) => ({ ...item }));
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

    if (this.sql.includes('FROM time_capsule_spatial_layouts') && this.sql.includes('WHERE l.id = ?')) {
      const layout = this.db.layouts.find((item) => item.id === this.params[0]);
      const event = layout && this.db.events.find((item) => item.id === (layout.eventId || layout.event_id));
      return layout && event
        ? { ...this.buildSpatialLayout(layout), hostToken: event.hostToken, eventAdminToken: event.adminToken, timeCapsuleEnabled: event.timeCapsuleEnabled }
        : null;
    }

    if (this.sql.includes('FROM time_capsule_spatial_layouts') && this.sql.includes('WHERE id = ?')) {
      return this.buildSpatialLayout(this.db.layouts.find((item) => item.id === this.params[0])) || null;
    }

    if (this.sql.includes('FROM time_capsule_spatial_layouts') && this.sql.includes('WHERE event_id = ?')) {
      const eventId = this.params[0];
      const status = this.params[1] || (this.sql.includes("status = 'published'") ? 'published' : 'draft');
      return this.db.layouts
        .filter((layout) => (layout.eventId || layout.event_id) === eventId && layout.status === status)
        .map((layout) => this.buildSpatialLayout(layout))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
    }

    if (this.sql.includes('FROM time_capsule_spatial_clusters') && this.sql.includes('WHERE layout_id = ? AND id = ?')) {
      return this.buildSpatialCluster(this.db.clusters.find((item) => (
        (item.layoutId || item.layout_id) === this.params[0] && item.id === this.params[1]
      ))) || null;
    }

    if (this.sql.includes('FROM time_capsule_spatial_placements') && this.sql.includes('WHERE layout_id = ? AND id = ?')) {
      return this.buildSpatialPlacement(this.db.placements.find((item) => (
        (item.layoutId || item.layout_id) === this.params[0] && item.id === this.params[1]
      ))) || null;
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

    if (this.sql.includes('FROM submission_media_insights')) {
      const eventId = this.params[0];
      return {
        results: this.db.insights
          .filter((item) => (item.event_id || item.eventId) === eventId)
          .map((item) => ({ ...item }))
      };
    }

    if (this.sql.includes('FROM time_capsule_spatial_clusters')) {
      const layoutId = this.params[0];
      return {
        results: this.db.clusters
          .filter((item) => (item.layoutId || item.layout_id) === layoutId)
          .map((item) => this.buildSpatialCluster(item))
          .sort((a, b) => Number(a.routeOrder || 0) - Number(b.routeOrder || 0))
      };
    }

    if (this.sql.includes('FROM time_capsule_spatial_placements')) {
      const layoutId = this.params[0];
      return {
        results: this.db.placements
          .filter((item) => (item.layoutId || item.layout_id) === layoutId)
          .map((item) => this.buildSpatialPlacement(item))
          .sort((a, b) => Number(a.routeOrder || 0) - Number(b.routeOrder || 0))
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.db.failOnSqlIncludes && this.sql.includes(this.db.failOnSqlIncludes)) {
      throw new Error(`Injected D1 failure for ${this.db.failOnSqlIncludes}`);
    }
    if (typeof this.db.beforeRun === 'function') {
      await this.db.beforeRun(this);
    }

    let changes = 0;

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

    if (this.sql.includes('INSERT INTO time_capsule_spatial_layouts')) {
      const [
        id,
        eventId,
        status,
        version,
        generationStatus,
        layoutMode,
        confidenceScore,
        inputFingerprint,
        generatorVersion,
        errorMessage,
        publishedAt,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.layouts.push(spatialLayout({
        id,
        eventId,
        event_id: eventId,
        status,
        version,
        generationStatus,
        generation_status: generationStatus,
        layoutMode,
        layout_mode: layoutMode,
        confidenceScore,
        confidence_score: confidenceScore,
        inputFingerprint,
        input_fingerprint: inputFingerprint,
        generatorVersion,
        generator_version: generatorVersion,
        errorMessage,
        error_message: errorMessage,
        publishedAt,
        published_at: publishedAt,
        createdAt,
        created_at: createdAt,
        updatedAt,
        updated_at: updatedAt
      }));
    }

    if (this.sql.includes('INSERT INTO time_capsule_spatial_clusters')) {
      const [
        id,
        layoutId,
        label,
        summary,
        routeOrder,
        anchorX,
        anchorY,
        anchorZ,
        confidenceScore,
        evidenceJson,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.clusters.push(spatialCluster({
        id,
        layoutId,
        layout_id: layoutId,
        label,
        summary,
        routeOrder,
        route_order: routeOrder,
        anchorX,
        anchor_x: anchorX,
        anchorY,
        anchor_y: anchorY,
        anchorZ,
        anchor_z: anchorZ,
        confidenceScore,
        confidence_score: confidenceScore,
        evidenceJson,
        evidence_json: evidenceJson,
        createdAt,
        created_at: createdAt,
        updatedAt,
        updated_at: updatedAt
      }));
    }

    if (this.sql.includes('INSERT INTO time_capsule_spatial_placements')) {
      const [
        id,
        eventId,
        layoutId,
        clusterId,
        itemId,
        routeOrder,
        positionX,
        positionY,
        positionZ,
        rotationX,
        rotationY,
        rotationZ,
        scale,
        confidenceScore,
        evidenceJson,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.placements.push(spatialPlacement({
        id,
        eventId,
        event_id: eventId,
        layoutId,
        layout_id: layoutId,
        clusterId,
        cluster_id: clusterId,
        itemId,
        timeCapsuleItemId: itemId,
        time_capsule_item_id: itemId,
        routeOrder,
        route_order: routeOrder,
        positionX,
        position_x: positionX,
        positionY,
        position_y: positionY,
        positionZ,
        position_z: positionZ,
        rotationX,
        rotation_x: rotationX,
        rotationY,
        rotation_y: rotationY,
        rotationZ,
        rotation_z: rotationZ,
        scale,
        confidenceScore,
        confidence_score: confidenceScore,
        evidenceJson,
        evidence_json: evidenceJson,
        createdAt,
        created_at: createdAt,
        updatedAt,
        updated_at: updatedAt
      }));
    }

    if (this.sql.includes('UPDATE time_capsule_spatial_layouts') && this.sql.includes("status = 'archived'")) {
      const updatedAt = this.params[0];
      const eventId = this.params[1];
      const status = this.sql.includes("status = 'published'") ? 'published' : 'draft';
      const keepId = this.params[2];
      const requiresPublishableDraft = this.sql.includes("generation_status = 'ready'");
      const canArchive = !requiresPublishableDraft || this.db.layouts.some((layout) => (
        layout.id === this.params[3]
        && (layout.eventId || layout.event_id) === this.params[4]
        && layout.status === 'draft'
        && (layout.generationStatus || layout.generation_status) === 'ready'
      ));
      for (const layout of this.db.layouts) {
        if (canArchive && (layout.eventId || layout.event_id) === eventId && layout.status === status && (!keepId || layout.id !== keepId)) {
          layout.status = 'archived';
          layout.updatedAt = updatedAt;
          layout.updated_at = updatedAt;
          changes += 1;
        }
      }
    }

    if (this.sql.includes('UPDATE time_capsule_spatial_layouts') && this.sql.includes("SET status = 'published'")) {
      const [publishedAt, updatedAt, layoutId, eventId] = this.params;
      const layout = this.db.layouts.find((item) => item.id === layoutId);
      const canPublish = layout && (
        !this.sql.includes('generation_status =')
        || (
          (layout.eventId || layout.event_id) === eventId
          && layout.status === 'draft'
          && (layout.generationStatus || layout.generation_status) === 'ready'
        )
      );
      if (canPublish) {
        const eventId = layout.eventId || layout.event_id;
        const existingPublished = this.db.layouts.find((item) => (
          item.id !== layout.id
          && (item.eventId || item.event_id) === eventId
          && item.status === 'published'
        ));
        if (existingPublished) {
          throw new Error('UNIQUE constraint failed: time_capsule_spatial_layouts.event_id, published status');
        }
        layout.status = 'published';
        layout.publishedAt = publishedAt;
        layout.published_at = publishedAt;
        layout.updatedAt = updatedAt;
        layout.updated_at = updatedAt;
        changes += 1;
      }
    }

    if (this.sql.includes('UPDATE time_capsule_spatial_layouts') && this.sql.includes('layout_mode = ?')) {
      const [layoutMode, confidenceScore, errorMessage, updatedAt, layoutId] = this.params;
      const layout = this.db.layouts.find((item) => item.id === layoutId);
      const canUpdate = layout && (!this.sql.includes("status = 'draft'") || layout.status === 'draft');
      if (canUpdate) {
        layout.layoutMode = layoutMode;
        layout.layout_mode = layoutMode;
        layout.confidenceScore = confidenceScore;
        layout.confidence_score = confidenceScore;
        layout.errorMessage = errorMessage;
        layout.error_message = errorMessage;
        layout.updatedAt = updatedAt;
        layout.updated_at = updatedAt;
        changes += 1;
      }
    }

    if (this.sql.includes('UPDATE time_capsule_spatial_clusters')) {
      const [
        label,
        summary,
        routeOrder,
        anchorX,
        anchorY,
        anchorZ,
        confidenceScore,
        updatedAt,
        layoutId,
        clusterId,
        parentLayoutId
      ] = this.params;
      const cluster = this.db.clusters.find((item) => (item.layoutId || item.layout_id) === layoutId && item.id === clusterId);
      const parentLayout = this.db.layouts.find((item) => item.id === parentLayoutId);
      const canUpdate = cluster && (!this.sql.includes('EXISTS') || parentLayout?.status === 'draft');
      if (canUpdate) {
        cluster.label = label;
        cluster.summary = summary;
        cluster.routeOrder = routeOrder;
        cluster.route_order = routeOrder;
        cluster.anchorX = anchorX;
        cluster.anchor_x = anchorX;
        cluster.anchorY = anchorY;
        cluster.anchor_y = anchorY;
        cluster.anchorZ = anchorZ;
        cluster.anchor_z = anchorZ;
        cluster.confidenceScore = confidenceScore;
        cluster.confidence_score = confidenceScore;
        cluster.updatedAt = updatedAt;
        cluster.updated_at = updatedAt;
        changes += 1;
      }
    }

    if (this.sql.includes('UPDATE time_capsule_spatial_placements')) {
      const [
        clusterId,
        routeOrder,
        positionX,
        positionY,
        positionZ,
        rotationX,
        rotationY,
        rotationZ,
        scale,
        confidenceScore,
        updatedAt,
        layoutId,
        placementId,
        parentLayoutId
      ] = this.params;
      const placement = this.db.placements.find((item) => (item.layoutId || item.layout_id) === layoutId && item.id === placementId);
      const parentLayout = this.db.layouts.find((item) => item.id === parentLayoutId);
      const canUpdate = placement && (!this.sql.includes('EXISTS') || parentLayout?.status === 'draft');
      if (canUpdate) {
        placement.clusterId = clusterId;
        placement.cluster_id = clusterId;
        placement.routeOrder = routeOrder;
        placement.route_order = routeOrder;
        placement.positionX = positionX;
        placement.position_x = positionX;
        placement.positionY = positionY;
        placement.position_y = positionY;
        placement.positionZ = positionZ;
        placement.position_z = positionZ;
        placement.rotationX = rotationX;
        placement.rotation_x = rotationX;
        placement.rotationY = rotationY;
        placement.rotation_y = rotationY;
        placement.rotationZ = rotationZ;
        placement.rotation_z = rotationZ;
        placement.scale = scale;
        placement.confidenceScore = confidenceScore;
        placement.confidence_score = confidenceScore;
        placement.updatedAt = updatedAt;
        placement.updated_at = updatedAt;
        changes += 1;
      }
    }

    return { success: true, meta: { changes } };
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

  buildSpatialLayout(layout) {
    if (!layout) return null;
    return {
      ...layout,
      eventId: layout.eventId || layout.event_id,
      generationStatus: layout.generationStatus || layout.generation_status,
      layoutMode: layout.layoutMode || layout.layout_mode,
      confidenceScore: layout.confidenceScore ?? layout.confidence_score,
      inputFingerprint: layout.inputFingerprint || layout.input_fingerprint,
      generatorVersion: layout.generatorVersion ?? layout.generator_version,
      errorMessage: layout.errorMessage || layout.error_message || '',
      publishedAt: layout.publishedAt || layout.published_at,
      createdAt: layout.createdAt || layout.created_at,
      updatedAt: layout.updatedAt || layout.updated_at
    };
  }

  buildSpatialCluster(cluster) {
    if (!cluster) return null;
    return {
      ...cluster,
      layoutId: cluster.layoutId || cluster.layout_id,
      routeOrder: cluster.routeOrder ?? cluster.route_order,
      anchorX: cluster.anchorX ?? cluster.anchor_x,
      anchorY: cluster.anchorY ?? cluster.anchor_y,
      anchorZ: cluster.anchorZ ?? cluster.anchor_z,
      confidenceScore: cluster.confidenceScore ?? cluster.confidence_score,
      evidenceJson: cluster.evidenceJson || cluster.evidence_json || '{}',
      createdAt: cluster.createdAt || cluster.created_at,
      updatedAt: cluster.updatedAt || cluster.updated_at
    };
  }

  buildSpatialPlacement(placement) {
    if (!placement) return null;
    return {
      ...placement,
      eventId: placement.eventId || placement.event_id,
      layoutId: placement.layoutId || placement.layout_id,
      clusterId: placement.clusterId || placement.cluster_id,
      itemId: placement.itemId || placement.timeCapsuleItemId || placement.time_capsule_item_id,
      timeCapsuleItemId: placement.timeCapsuleItemId || placement.time_capsule_item_id || placement.itemId,
      routeOrder: placement.routeOrder ?? placement.route_order,
      positionX: placement.positionX ?? placement.position_x,
      positionY: placement.positionY ?? placement.position_y,
      positionZ: placement.positionZ ?? placement.position_z,
      rotationX: placement.rotationX ?? placement.rotation_x,
      rotationY: placement.rotationY ?? placement.rotation_y,
      rotationZ: placement.rotationZ ?? placement.rotation_z,
      confidenceScore: placement.confidenceScore ?? placement.confidence_score,
      evidenceJson: placement.evidenceJson || placement.evidence_json || '{}',
      createdAt: placement.createdAt || placement.created_at,
      updatedAt: placement.updatedAt || placement.updated_at
    };
  }
}
