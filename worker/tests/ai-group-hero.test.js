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

test('group hero face dedupe migration stores analyses, faces, clusters, and decisions', async () => {
  const migration = await readFile(new URL('../migrations/0019_wallflower_group_hero_face_dedupe.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS submission_face_analyses/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS submission_faces/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_face_clusters/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_group_hero_source_decisions/);
  assert.match(migration, /face_signature_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /idx_submission_faces_event_cluster/);
});

test('guest upload stores AI artwork consent only when provided', async () => {
  const db = new GroupHeroFakeDb();
  const bucket = new FakeBucket();
  const env = envWithDb(db, bucket);
  const token = await getUploadToken(env);

  const consentResponse = await submitGuestPhoto(env, token, { aiArtworkConsent: true, aiReference: true });
  const privateResponse = await submitGuestPhoto(env, token, { filename: 'private.jpg' });

  assert.equal(consentResponse.status, 201);
  assert.equal(privateResponse.status, 201);
  assert.equal(db.submissions.length, 2);
  assert.ok(db.submissions[0].ai_artwork_consent_at);
  assert.equal(db.submissions[1].ai_artwork_consent_at, null);
  const aiReferencePut = bucket.puts.find((put) => put.key.includes('/ai-references/'));
  assert.ok(aiReferencePut);
  assert.match(aiReferencePut.key, /^moments\/event-hero\/ai-references\/.+\.jpg$/);
  assert.equal(aiReferencePut.metadata.httpMetadata.contentType, 'image/jpeg');
  assert.equal(aiReferencePut.metadata.customMetadata.mediaType, 'ai-reference');
});

test('scheduled task includes approved host posts and AI-consented guest posts in the group hero', async () => {
  const hostPhoto = guestSubmission({
    id: 'host-photo',
    source: 'host',
    object_key: 'moments/event-hero/host-photo.jpg',
    objectKey: 'moments/event-hero/host-photo.jpg',
    guest_name: 'Host',
    guestName: 'Host',
    status: 'approved',
    ai_artwork_consent_at: null,
    aiArtworkConsentAt: null,
    created_at: '2026-09-19T20:03:00.000Z',
    createdAt: '2026-09-19T20:03:00.000Z'
  });
  const guestPhoto = guestSubmission({
    id: 'guest-photo',
    object_key: 'moments/event-hero/guest-photo.jpg',
    objectKey: 'moments/event-hero/guest-photo.jpg',
    guest_name: 'Guest',
    guestName: 'Guest',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const privateGuest = guestSubmission({
    id: 'guest-private',
    object_key: 'moments/event-hero/guest-private.jpg',
    objectKey: 'moments/event-hero/guest-private.jpg',
    guest_name: 'Private Guest',
    guestName: 'Private Guest',
    status: 'approved',
    ai_artwork_consent_at: null,
    aiArtworkConsentAt: null,
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [hostPhoto, guestPhoto, privateGuest],
    groupHeroes: [readyHero({
      status: 'queued',
      source_submission_ids: JSON.stringify(['host-photo', 'guest-photo']),
      sourceSubmissionIds: JSON.stringify(['host-photo', 'guest-photo'])
    })]
  });
  const bucket = new FakeBucket([
    [hostPhoto.object_key, 'host-photo-bytes'],
    [guestPhoto.object_key, 'guest-photo-bytes'],
    [privateGuest.object_key, 'private-guest-bytes']
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi();

  try {
    await runScheduled(env);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 2);
    assert.match(calls[0].imageNames[0], /host-photo/);
    assert.match(calls[0].imageNames[1], /guest-photo/);
    assert.equal(db.groupHeroes[0].participant_count, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['host-photo', 'guest-photo']);
  } finally {
    restoreFetch();
  }
});

test('host post creation queues group hero generation for eligible host media', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function createHostPost');
  const end = source.indexOf('async function', start + 1);
  const createHostPost = source.slice(start, end);

  assert.match(createHostPost, /const hostSubmission = await getSubmissionWithEvent\(env, submissionId\);/);
  assert.match(createHostPost, /queueStreamOptimization\(env, request, hostSubmission, ctx\);/);
  assert.match(createHostPost, /queueEventGroupHeroGenerationForSubmission\(env, request, hostSubmission, ctx\);/);
});

test('group hero analyzes the actual source image with Rekognition before OpenAI', async () => {
  const hostPhoto = guestSubmission({
    id: 'host-new',
    source: 'host',
    object_key: 'moments/event-hero/host-new.jpg',
    objectKey: 'moments/event-hero/host-new.jpg',
    guest_name: 'Host',
    guestName: 'Host',
    status: 'approved',
    ai_artwork_consent_at: null,
    aiArtworkConsentAt: null,
    created_at: '2026-09-19T20:04:00.000Z',
    createdAt: '2026-09-19T20:04:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [hostPhoto],
    groupHeroes: [readyHero({
      status: 'queued',
      source_submission_ids: JSON.stringify(['host-new']),
      sourceSubmissionIds: JSON.stringify(['host-new'])
    })]
  });
  const bucket = new FakeBucket([
    [hostPhoto.object_key, 'host-photo-source-bytes']
  ]);
  const env = envWithDb(db, bucket, {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'aws-key',
    AWS_SECRET_ACCESS_KEY: 'aws-secret'
  });
  const calls = mockOpenAiAndAwsRekognition();

  try {
    await runScheduled(env);

    assert.ok(calls.awsTargets.includes('RekognitionService.IndexFaces'));
    assert.equal(calls.openAi.length, 1);
    assert.equal(db.faceAnalyses.length, 1);
    assert.equal(db.faceAnalyses[0].source_object_key, 'moments/event-hero/host-new.jpg');
    assert.equal(db.faces.length, 1);
    assert.equal(db.faces[0].submission_id, 'host-new');
    assert.match(calls.openAi[0].prompt, /Face ID F-/);
  } finally {
    restoreFetch();
  }
});

test('scheduled task generates a ready group hero from a queued approval using the latest 16 sources', async () => {
  const submissions = Array.from({ length: 18 }, (_, index) => guestSubmission({
    id: `guest-${String(index + 1).padStart(2, '0')}`,
    object_key: `moments/event-hero/guest-${String(index + 1).padStart(2, '0')}.jpg`,
    objectKey: `moments/event-hero/guest-${String(index + 1).padStart(2, '0')}.jpg`,
    guest_name: `Guest ${String(index + 1).padStart(2, '0')}`,
    guestName: `Guest ${String(index + 1).padStart(2, '0')}`,
    status: index === 17 ? 'pending' : 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: new Date(Date.UTC(2026, 8, 19, 20, index, 0)).toISOString(),
    createdAt: new Date(Date.UTC(2026, 8, 19, 20, index, 0)).toISOString()
  }));
  const db = new GroupHeroFakeDb({ submissions });
  const bucket = new FakeBucket(submissions.map((submission) => [submission.object_key, `source-${submission.id}`]));
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(env, 'guest-18');
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

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

test('approving an AI-consented photo queues group hero generation without calling OpenAI', async () => {
  const submission = guestSubmission({
    id: 'guest-approval-queued',
    object_key: 'moments/event-hero/guest-approval-queued.jpg',
    objectKey: 'moments/event-hero/guest-approval-queued.jpg',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [submission] });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(envWithDb(db, bucket), submission.id);

    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-approval-queued']);
  } finally {
    restoreFetch();
  }
});

test('group hero generation prefers a normalized AI reference over the original photo object', async () => {
  const submission = guestSubmission({
    id: 'guest-reference',
    object_key: 'moments/event-hero/guest-reference-original.jpg',
    objectKey: 'moments/event-hero/guest-reference-original.jpg',
    guest_name: 'Reference Source',
    guestName: 'Reference Source',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:03:00.000Z',
    createdAt: '2026-09-19T20:03:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [submission] });
  const normalizedBytes = 'normalized-reference-bytes';
  const bucket = new FakeBucket([
    [submission.object_key, 'original-photo-bytes-that-should-not-be-sent'],
    ['moments/event-hero/ai-references/guest-reference.jpg', normalizedBytes]
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(env, submission.id);

    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 1);
    assert.match(calls[0].imageNames[0], /guest-reference-ai-reference\.jpg$/);
    assert.equal(calls[0].imageSizes[0], new TextEncoder().encode(normalizedBytes).byteLength);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 1);
  } finally {
    restoreFetch();
  }
});

test('group hero uses approved video thumbnails and an event-specific likeness prompt', async () => {
  const photo = guestSubmission({
    id: 'guest-photo',
    object_key: 'moments/event-hero/guest-photo.jpg',
    objectKey: 'moments/event-hero/guest-photo.jpg',
    guest_name: 'Photo Guest',
    guestName: 'Photo Guest',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const video = guestSubmission({
    id: 'guest-video',
    media_type: 'video',
    mediaType: 'video',
    object_key: 'moments/event-hero/guest-video.mp4',
    objectKey: 'moments/event-hero/guest-video.mp4',
    original_filename: 'guest-video.mp4',
    originalFilename: 'guest-video.mp4',
    guest_name: 'Video Guest',
    guestName: 'Video Guest',
    mime_type: 'video/mp4',
    mimeType: 'video/mp4',
    thumbnail_object_key: 'moments/event-hero/thumbnails/guest-video.jpg',
    thumbnailObjectKey: 'moments/event-hero/thumbnails/guest-video.jpg',
    thumbnail_mime_type: 'image/jpeg',
    thumbnailMimeType: 'image/jpeg',
    thumbnail_size: 640,
    thumbnailSize: 640,
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const videoWithoutThumbnail = guestSubmission({
    id: 'guest-video-no-thumbnail',
    media_type: 'video',
    mediaType: 'video',
    mime_type: 'video/mp4',
    mimeType: 'video/mp4',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:03:00.000Z',
    createdAt: '2026-09-19T20:03:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [photo, video, videoWithoutThumbnail] });
  const bucket = new FakeBucket([
    [photo.object_key, 'source-photo'],
    [video.thumbnail_object_key, 'source-video-thumbnail']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(response.status, 202);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 2);
    assert.match(calls[0].prompt, /AI Hero Test/);
    assert.match(calls[0].prompt, /recognizable/i);
    assert.doesNotMatch(calls[0].prompt, /Williamson Wallflowers/);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-video', 'guest-photo']);
  } finally {
    restoreFetch();
  }
});

test('group hero dedupes repeated guest names before generating artwork', async () => {
  const duplicateOld = guestSubmission({
    id: 'guest-linda-old',
    object_key: 'moments/event-hero/guest-linda-old.jpg',
    objectKey: 'moments/event-hero/guest-linda-old.jpg',
    guest_name: 'Aunt Linda',
    guestName: 'Aunt Linda',
    status: 'approved',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:01:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:01:00.000Z'
  });
  const unique = guestSubmission({
    id: 'guest-mike',
    object_key: 'moments/event-hero/guest-mike.jpg',
    objectKey: 'moments/event-hero/guest-mike.jpg',
    guest_name: 'Uncle Mike',
    guestName: 'Uncle Mike',
    status: 'approved',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:02:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:02:00.000Z'
  });
  const duplicateNew = guestSubmission({
    id: 'guest-linda-new',
    object_key: 'moments/event-hero/guest-linda-new.jpg',
    objectKey: 'moments/event-hero/guest-linda-new.jpg',
    guest_name: 'Aunt Linda',
    guestName: 'Aunt Linda',
    status: 'pending',
    created_at: '2026-09-19T20:03:00.000Z',
    createdAt: '2026-09-19T20:03:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:03:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:03:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [duplicateOld, unique, duplicateNew] });
  const bucket = new FakeBucket([
    [duplicateOld.object_key, 'source-linda-old'],
    [unique.object_key, 'source-mike'],
    [duplicateNew.object_key, 'source-linda-new']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(env, duplicateNew.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-linda-new', 'guest-mike']);
  } finally {
    restoreFetch();
  }
});

test('group hero dedupes repeated face clusters before generating artwork', async () => {
  const duplicateOld = guestSubmission({
    id: 'guest-sam-old',
    object_key: 'moments/event-hero/guest-sam-old.jpg',
    objectKey: 'moments/event-hero/guest-sam-old.jpg',
    guest_name: 'Sam at Cake',
    guestName: 'Sam at Cake',
    status: 'approved',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:01:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:01:00.000Z'
  });
  const unique = guestSubmission({
    id: 'guest-riley',
    object_key: 'moments/event-hero/guest-riley.jpg',
    objectKey: 'moments/event-hero/guest-riley.jpg',
    guest_name: 'Riley',
    guestName: 'Riley',
    status: 'approved',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:02:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:02:00.000Z'
  });
  const duplicateNew = guestSubmission({
    id: 'guest-sam-new',
    object_key: 'moments/event-hero/guest-sam-new.jpg',
    objectKey: 'moments/event-hero/guest-sam-new.jpg',
    guest_name: 'Samuel Dance Floor',
    guestName: 'Samuel Dance Floor',
    status: 'approved',
    created_at: '2026-09-19T20:03:00.000Z',
    createdAt: '2026-09-19T20:03:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:03:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:03:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [duplicateOld, unique, duplicateNew],
    faces: [
      faceRow({ submission_id: 'guest-sam-old', submissionId: 'guest-sam-old', cluster_id: 'cluster-sam', clusterId: 'cluster-sam' }),
      faceRow({ submission_id: 'guest-sam-new', submissionId: 'guest-sam-new', cluster_id: 'cluster-sam', clusterId: 'cluster-sam' }),
      faceRow({ submission_id: 'guest-riley', submissionId: 'guest-riley', cluster_id: 'cluster-riley', clusterId: 'cluster-riley' })
    ]
  });
  const bucket = new FakeBucket([
    [duplicateOld.object_key, 'source-sam-old'],
    [unique.object_key, 'source-riley'],
    [duplicateNew.object_key, 'source-sam-new']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-sam-new', 'guest-riley']);
    const skipped = db.sourceDecisions.find((decision) => decision.submission_id === 'guest-sam-old');
    assert.equal(skipped.decision, 'skipped');
    assert.equal(skipped.reason, 'duplicate-face-cluster');
  } finally {
    restoreFetch();
  }
});

test('group hero sends body-aware person references for unique face clusters', async () => {
  const fullBody = guestSubmission({
    id: 'guest-full-body',
    object_key: 'moments/event-hero/guest-full-body.jpg',
    objectKey: 'moments/event-hero/guest-full-body.jpg',
    guest_name: 'Full Body Guest',
    guestName: 'Full Body Guest',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [fullBody],
    faces: [
      faceRow({
        submission_id: 'guest-full-body',
        submissionId: 'guest-full-body',
        cluster_id: 'cluster-full-body',
        clusterId: 'cluster-full-body',
        confidence: 99.4,
        bounding_box_json: JSON.stringify({ Left: 0.42, Top: 0.08, Width: 0.14, Height: 0.12 }),
        boundingBoxJson: JSON.stringify({ Left: 0.42, Top: 0.08, Width: 0.14, Height: 0.12 }),
        quality_json: JSON.stringify({ Brightness: 82, Sharpness: 91 }),
        qualityJson: JSON.stringify({ Brightness: 82, Sharpness: 91 })
      })
    ]
  });
  const bucket = new FakeBucket([
    [fullBody.object_key, 'source-full-body']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi({ normalizationBody: 'body-aware-person-reference' });

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    // Single-face photo: no AI cutout needed, just the body-aware reference crop.
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].imageNames, ['guest-full-body-cluster-full-body-person-reference.jpg']);
    assert.match(calls[0].prompt, /Roster requirements:/);
    assert.match(calls[0].prompt, /Participant 1/);
    assert.match(calls[0].prompt, /exactly one unique cartoon participant/i);
    assert.match(calls[0].prompt, /pants, shoes/i);
  } finally {
    restoreFetch();
  }
});

test('group hero uses a plain reference, not a cutout, for a single-face photo', async () => {
  const solo = guestSubmission({
    id: 'guest-cutout-cached',
    object_key: 'moments/event-hero/guest-cutout-cached.jpg',
    objectKey: 'moments/event-hero/guest-cutout-cached.jpg',
    guest_name: 'Cutout Guest',
    guestName: 'Cutout Guest',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [solo],
    faces: [
      faceRow({
        submission_id: 'guest-cutout-cached',
        submissionId: 'guest-cutout-cached',
        cluster_id: 'face-cut111',
        clusterId: 'face-cut111',
        bounding_box_json: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.16, Height: 0.16 }),
        boundingBoxJson: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.16, Height: 0.16 })
      })
    ]
  });
  // Both a cutout AND a reference crop are pre-stored. A single-face photo must
  // use the plain reference and ignore the cutout (cutouts are only for stripping
  // bystanders out of multi-face photos, and they cost scarce OpenAI rate budget).
  const bucket = new FakeBucket([
    [solo.object_key, 'source-cutout-cached'],
    ['moments/event-hero/generated/person-cutout/guest-cutout-cached-face-cut111-v1.png', 'cached-cutout-bytes'],
    ['moments/event-hero/generated/person-roster/guest-cutout-cached-face-cut111-v5.jpg', 'cached-reference-bytes']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].imageNames, ['guest-cutout-cached-face-cut111-person-reference.jpg']);
  } finally {
    restoreFetch();
  }
});

test('group hero generates a missing cutout for a multi-face photo and reuses a cached one', async () => {
  const groupPhoto = guestSubmission({
    id: 'guest-cutout-miss',
    object_key: 'moments/event-hero/guest-cutout-miss.jpg',
    objectKey: 'moments/event-hero/guest-cutout-miss.jpg',
    guest_name: '',
    guestName: '',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [groupPhoto],
    faces: [
      faceRow({
        submission_id: 'guest-cutout-miss', submissionId: 'guest-cutout-miss',
        cluster_id: 'face-missAA', clusterId: 'face-missAA', face_index: 0, faceIndex: 0,
        bounding_box_json: JSON.stringify({ Left: 0.2, Top: 0.1, Width: 0.16, Height: 0.16 }),
        boundingBoxJson: JSON.stringify({ Left: 0.2, Top: 0.1, Width: 0.16, Height: 0.16 })
      }),
      faceRow({
        id: 'face-missBB', submission_id: 'guest-cutout-miss', submissionId: 'guest-cutout-miss',
        cluster_id: 'face-missBB', clusterId: 'face-missBB', face_index: 1, faceIndex: 1,
        bounding_box_json: JSON.stringify({ Left: 0.6, Top: 0.1, Width: 0.16, Height: 0.16 }),
        boundingBoxJson: JSON.stringify({ Left: 0.6, Top: 0.1, Width: 0.16, Height: 0.16 })
      })
    ]
  });
  // Face AA's cutout is cached (cache hit, no OpenAI call); face BB's must be generated.
  const bucket = new FakeBucket([
    [groupPhoto.object_key, 'source-cutout-miss'],
    ['moments/event-hero/generated/person-cutout/guest-cutout-miss-face-missAA-v1.png', 'cached-cutout-AA']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi({ normalizationBody: 'crop-bytes-for-cutout' });

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    // One cutout generation (face BB) + one composition. Face AA was a cache hit.
    assert.equal(calls.length, 2);
    const cutoutCalls = calls.filter((call) => /Remove every other person/.test(call.prompt));
    assert.equal(cutoutCalls.length, 1);
    const composition = calls.find((call) => /Roster requirements:/.test(call.prompt));
    assert.equal(composition.imageCount, 2);
    assert.ok(composition.imageNames.includes('guest-cutout-miss-face-missAA-person-cutout.png'));
    assert.ok(composition.imageNames.includes('guest-cutout-miss-face-missBB-person-cutout.png'));
    const cutoutPut = bucket.puts.find((put) => put.key.includes('/generated/person-cutout/guest-cutout-miss-face-missBB'));
    assert.ok(cutoutPut);
    assert.equal(cutoutPut.metadata.customMetadata.mediaType, 'group-hero-person-cutout');
  } finally {
    restoreFetch();
  }
});

test('group hero caps new cutout generations per run to stay under the OpenAI rate limit', async () => {
  const crowd = guestSubmission({
    id: 'guest-crowd',
    object_key: 'moments/event-hero/guest-crowd.jpg',
    objectKey: 'moments/event-hero/guest-crowd.jpg',
    guest_name: '',
    guestName: '',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  // Five faces in one photo, all new, all clustered close together so a face without a
  // cutout is never sole-in-column. With the per-run cap of 4, only 4 cutouts are generated
  // (the 5th is dropped), keeping total OpenAI image-edit calls at 5 (4 cutouts + 1 compose).
  const faces = [0, 1, 2, 3, 4].map((index) => faceRow({
    id: `face-crowd${index}`,
    submission_id: 'guest-crowd', submissionId: 'guest-crowd',
    cluster_id: `face-crowd${index}`, clusterId: `face-crowd${index}`,
    face_index: index, faceIndex: index,
    bounding_box_json: JSON.stringify({ Left: 0.30 + index * 0.02, Top: 0.2, Width: 0.10, Height: 0.10 }),
    boundingBoxJson: JSON.stringify({ Left: 0.30 + index * 0.02, Top: 0.2, Width: 0.10, Height: 0.10 })
  }));
  const db = new GroupHeroFakeDb({ submissions: [crowd], faces });
  const bucket = new FakeBucket([[crowd.object_key, 'source-crowd']]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi({ normalizationBody: 'crop-bytes-for-cutout' });

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    const cutoutCalls = calls.filter((call) => /Remove every other person/.test(call.prompt));
    assert.equal(cutoutCalls.length, 4);
    assert.equal(calls.length, 5); // 4 cutouts + 1 composition
    const composition = calls.find((call) => /Roster requirements:/.test(call.prompt));
    assert.equal(composition.imageCount, 4);
    assert.equal(db.groupHeroes[0].participant_count, 4);
  } finally {
    restoreFetch();
  }
});

test('group hero drops a multi-face participant when its cutout cannot be produced', async () => {
  const groupPhoto = guestSubmission({
    id: 'guest-nocutout-group',
    object_key: 'moments/event-hero/guest-nocutout-group.jpg',
    objectKey: 'moments/event-hero/guest-nocutout-group.jpg',
    guest_name: '',
    guestName: '',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const soloPhoto = guestSubmission({
    id: 'guest-nocutout-solo',
    object_key: 'moments/event-hero/guest-nocutout-solo.jpg',
    objectKey: 'moments/event-hero/guest-nocutout-solo.jpg',
    guest_name: 'Solo Ok',
    guestName: 'Solo Ok',
    status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z',
    createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [groupPhoto, soloPhoto],
    faces: [
      faceRow({
        submission_id: 'guest-nocutout-group', submissionId: 'guest-nocutout-group',
        cluster_id: 'face-gA', clusterId: 'face-gA', face_index: 0, faceIndex: 0,
        bounding_box_json: JSON.stringify({ Left: 0.30, Top: 0.2, Width: 0.12, Height: 0.12 }),
        boundingBoxJson: JSON.stringify({ Left: 0.30, Top: 0.2, Width: 0.12, Height: 0.12 })
      }),
      faceRow({
        id: 'face-gB', submission_id: 'guest-nocutout-group', submissionId: 'guest-nocutout-group',
        cluster_id: 'face-gB', clusterId: 'face-gB', face_index: 1, faceIndex: 1,
        bounding_box_json: JSON.stringify({ Left: 0.40, Top: 0.2, Width: 0.12, Height: 0.12 }),
        boundingBoxJson: JSON.stringify({ Left: 0.40, Top: 0.2, Width: 0.12, Height: 0.12 })
      }),
      faceRow({
        id: 'face-solo', submission_id: 'guest-nocutout-solo', submissionId: 'guest-nocutout-solo',
        cluster_id: 'face-solo', clusterId: 'face-solo',
        bounding_box_json: JSON.stringify({ Left: 0.40, Top: 0.2, Width: 0.18, Height: 0.18 }),
        boundingBoxJson: JSON.stringify({ Left: 0.40, Top: 0.2, Width: 0.18, Height: 0.18 })
      })
    ]
  });
  // Group faces overlap (centers 0.36 vs 0.46) so neither is sole-in-column, and with no
  // media bytes their cutouts/crops cannot be produced -> the group photo is dropped. The
  // single-face solo skips cutouts entirely and uses its pre-stored reference crop.
  const bucket = new FakeBucket([
    [groupPhoto.object_key, 'src-group'],
    [soloPhoto.object_key, 'src-solo'],
    ['moments/event-hero/generated/person-roster/guest-nocutout-solo-face-solo-v5.jpg', 'solo-reference']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi(); // media fetches 502 -> group cutouts and crops fail

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].imageNames, ['guest-nocutout-solo-face-solo-person-reference.jpg']);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-nocutout-solo']);
  } finally {
    restoreFetch();
  }
});

test('group hero renders every face from a multi-face upload via cutouts', async () => {
  const familyPhoto = guestSubmission({
    id: 'guest-family',
    object_key: 'moments/event-hero/guest-family.jpg',
    objectKey: 'moments/event-hero/guest-family.jpg',
    guest_name: 'Family Photo',
    guestName: 'Family Photo',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [familyPhoto],
    faces: [
      faceRow({
        submission_id: 'guest-family', submissionId: 'guest-family',
        cluster_id: 'face-manabc123', clusterId: 'face-manabc123', face_index: 0, faceIndex: 0,
        confidence: 99.9,
        bounding_box_json: JSON.stringify({ Left: 0.24, Top: 0.1, Width: 0.32, Height: 0.32 }),
        boundingBoxJson: JSON.stringify({ Left: 0.24, Top: 0.1, Width: 0.32, Height: 0.32 }),
        quality_json: JSON.stringify({ Brightness: 86, Sharpness: 90 }),
        qualityJson: JSON.stringify({ Brightness: 86, Sharpness: 90 })
      }),
      faceRow({
        id: 'face-baby', submission_id: 'guest-family', submissionId: 'guest-family',
        cluster_id: 'face-baby987', clusterId: 'face-baby987', face_index: 1, faceIndex: 1,
        confidence: 99.7,
        bounding_box_json: JSON.stringify({ Left: 0.58, Top: 0.42, Width: 0.24, Height: 0.24 }),
        boundingBoxJson: JSON.stringify({ Left: 0.58, Top: 0.42, Width: 0.24, Height: 0.24 }),
        quality_json: JSON.stringify({ Brightness: 92, Sharpness: 72 }),
        qualityJson: JSON.stringify({ Brightness: 92, Sharpness: 72 })
      })
    ]
  });
  const bucket = new FakeBucket([
    [familyPhoto.object_key, 'source-family'],
    ['moments/event-hero/generated/person-cutout/guest-family-face-manabc123-v1.png', 'cutout-man'],
    ['moments/event-hero/generated/person-cutout/guest-family-face-baby987-v1.png', 'cutout-baby']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 2);
    assert.deepEqual(calls[0].imageNames, [
      'guest-family-face-manabc123-person-cutout.png',
      'guest-family-face-baby987-person-cutout.png'
    ]);
    assert.equal(db.groupHeroes[0].participant_count, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-family', 'guest-family']);
  } finally {
    restoreFetch();
  }
});

test('group hero renders both faces from a group photo and skips a redundant solo of the same cluster', async () => {
  const groupPair = guestSubmission({
    id: 'guest-group-pair',
    object_key: 'moments/event-hero/guest-group-pair.jpg',
    objectKey: 'moments/event-hero/guest-group-pair.jpg',
    guest_name: 'Group Pair',
    guestName: 'Group Pair',
    status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z',
    createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
  });
  const soloSecond = guestSubmission({
    id: 'guest-p2-solo',
    object_key: 'moments/event-hero/guest-p2-solo.jpg',
    objectKey: 'moments/event-hero/guest-p2-solo.jpg',
    guest_name: 'Solo Second',
    guestName: 'Solo Second',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [groupPair, soloSecond],
    faces: [
      faceRow({
        submission_id: 'guest-group-pair',
        submissionId: 'guest-group-pair',
        cluster_id: 'face-p1aaaaa',
        clusterId: 'face-p1aaaaa',
        face_index: 0,
        faceIndex: 0,
        confidence: 99.9,
        bounding_box_json: JSON.stringify({ Left: 0.2, Top: 0.1, Width: 0.3, Height: 0.3 }),
        boundingBoxJson: JSON.stringify({ Left: 0.2, Top: 0.1, Width: 0.3, Height: 0.3 }),
        quality_json: JSON.stringify({ Brightness: 88, Sharpness: 92 }),
        qualityJson: JSON.stringify({ Brightness: 88, Sharpness: 92 })
      }),
      faceRow({
        id: 'group-pair-second',
        submission_id: 'guest-group-pair',
        submissionId: 'guest-group-pair',
        cluster_id: 'face-p2bbbbb',
        clusterId: 'face-p2bbbbb',
        face_index: 1,
        faceIndex: 1,
        confidence: 99,
        bounding_box_json: JSON.stringify({ Left: 0.6, Top: 0.4, Width: 0.18, Height: 0.18 }),
        boundingBoxJson: JSON.stringify({ Left: 0.6, Top: 0.4, Width: 0.18, Height: 0.18 }),
        quality_json: JSON.stringify({ Brightness: 80, Sharpness: 70 }),
        qualityJson: JSON.stringify({ Brightness: 80, Sharpness: 70 })
      }),
      faceRow({
        id: 'solo-second-face',
        submission_id: 'guest-p2-solo',
        submissionId: 'guest-p2-solo',
        cluster_id: 'face-p2bbbbb',
        clusterId: 'face-p2bbbbb',
        face_index: 0,
        faceIndex: 0,
        confidence: 99.5,
        bounding_box_json: JSON.stringify({ Left: 0.35, Top: 0.2, Width: 0.34, Height: 0.34 }),
        boundingBoxJson: JSON.stringify({ Left: 0.35, Top: 0.2, Width: 0.34, Height: 0.34 }),
        quality_json: JSON.stringify({ Brightness: 84, Sharpness: 88 }),
        qualityJson: JSON.stringify({ Brightness: 84, Sharpness: 88 })
      })
    ]
  });
  const bucket = new FakeBucket([
    [groupPair.object_key, 'source-group-pair'],
    [soloSecond.object_key, 'source-p2-solo'],
    ['moments/event-hero/generated/person-cutout/guest-group-pair-face-p1aaaaa-v1.png', 'cutout-p1'],
    ['moments/event-hero/generated/person-cutout/guest-group-pair-face-p2bbbbb-v1.png', 'cutout-p2']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    // With multi-participant selection, both faces from the group photo are rendered directly
    // via their own cutouts; the solo photo is skipped (face-p2bbbbb already claimed).
    assert.equal(calls[0].imageCount, 2);
    assert.deepEqual(calls[0].imageNames, [
      'guest-group-pair-face-p1aaaaa-person-cutout.png',
      'guest-group-pair-face-p2bbbbb-person-cutout.png'
    ]);
    assert.match(calls[0].prompt, /Face ID F-p1aaaa/);
    assert.match(calls[0].prompt, /Face ID F-p2bbbb/);
    assert.equal(db.groupHeroes[0].participant_count, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-group-pair', 'guest-group-pair']);
  } finally {
    restoreFetch();
  }
});

test('group hero isolates new participants from source images that also contain duplicate faces', async () => {
  const soloDuplicate = guestSubmission({
    id: 'guest-solo-duplicate',
    object_key: 'moments/event-hero/guest-solo-duplicate.jpg',
    objectKey: 'moments/event-hero/guest-solo-duplicate.jpg',
    guest_name: 'Duplicate Solo',
    guestName: 'Duplicate Solo',
    status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z',
    createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
  });
  const groupWithDuplicate = guestSubmission({
    id: 'guest-group-with-duplicate',
    object_key: 'moments/event-hero/guest-group-with-duplicate.jpg',
    objectKey: 'moments/event-hero/guest-group-with-duplicate.jpg',
    guest_name: 'Group With Duplicate',
    guestName: 'Group With Duplicate',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [soloDuplicate, groupWithDuplicate],
    faces: [
      faceRow({
        submission_id: 'guest-solo-duplicate',
        submissionId: 'guest-solo-duplicate',
        cluster_id: 'face-dup60b4b',
        clusterId: 'face-dup60b4b',
        bounding_box_json: JSON.stringify({ Left: 0.32, Top: 0.16, Width: 0.34, Height: 0.34 }),
        boundingBoxJson: JSON.stringify({ Left: 0.32, Top: 0.16, Width: 0.34, Height: 0.34 })
      }),
      faceRow({
        id: 'group-duplicate-face',
        submission_id: 'guest-group-with-duplicate',
        submissionId: 'guest-group-with-duplicate',
        cluster_id: 'face-dup60b4b',
        clusterId: 'face-dup60b4b',
        face_index: 0,
        faceIndex: 0,
        match_confidence: 98,
        matchConfidence: 98,
        bounding_box_json: JSON.stringify({ Left: 0.18, Top: 0.12, Width: 0.12, Height: 0.12 }),
        boundingBoxJson: JSON.stringify({ Left: 0.18, Top: 0.12, Width: 0.12, Height: 0.12 })
      }),
      faceRow({
        id: 'group-new-face',
        submission_id: 'guest-group-with-duplicate',
        submissionId: 'guest-group-with-duplicate',
        cluster_id: 'face-new6096',
        clusterId: 'face-new6096',
        face_index: 1,
        faceIndex: 1,
        match_confidence: 0,
        matchConfidence: 0,
        bounding_box_json: JSON.stringify({ Left: 0.54, Top: 0.22, Width: 0.1, Height: 0.09 }),
        boundingBoxJson: JSON.stringify({ Left: 0.54, Top: 0.22, Width: 0.1, Height: 0.09 })
      })
    ]
  });
  const bucket = new FakeBucket([
    [soloDuplicate.object_key, 'source-solo-duplicate'],
    [groupWithDuplicate.object_key, 'source-group-with-duplicate'],
    ['moments/event-hero/generated/person-cutout/guest-solo-duplicate-face-dup60b4b-v1.png', 'cutout-solo-dup'],
    ['moments/event-hero/generated/person-cutout/guest-group-with-duplicate-face-new6096-v1.png', 'cutout-new6096']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi({ normalizationBody: 'isolated-person-reference' });

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 2);
    assert.match(calls[0].prompt, /Face ID F-new609/);
    assert.ok(calls[0].imageNames.includes('guest-group-with-duplicate-face-new6096-person-cutout.png'));
  } finally {
    restoreFetch();
  }
});

test('group hero skips multi-person roster entries when isolated references are unavailable', async () => {
  const soloDuplicate = guestSubmission({
    id: 'guest-solo-duplicate',
    object_key: 'moments/event-hero/guest-solo-duplicate.jpg',
    objectKey: 'moments/event-hero/guest-solo-duplicate.jpg',
    guest_name: 'Duplicate Solo',
    guestName: 'Duplicate Solo',
    status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z',
    createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
  });
  const groupWithDuplicate = guestSubmission({
    id: 'guest-group-with-duplicate',
    object_key: 'moments/event-hero/guest-group-with-duplicate.jpg',
    objectKey: 'moments/event-hero/guest-group-with-duplicate.jpg',
    guest_name: 'Group With Duplicate',
    guestName: 'Group With Duplicate',
    status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z',
    createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [soloDuplicate, groupWithDuplicate],
    faces: [
      faceRow({
        submission_id: 'guest-solo-duplicate',
        submissionId: 'guest-solo-duplicate',
        cluster_id: 'face-dup60b4b',
        clusterId: 'face-dup60b4b',
        bounding_box_json: JSON.stringify({ Left: 0.32, Top: 0.16, Width: 0.34, Height: 0.34 }),
        boundingBoxJson: JSON.stringify({ Left: 0.32, Top: 0.16, Width: 0.34, Height: 0.34 })
      }),
      faceRow({
        id: 'group-duplicate-face',
        submission_id: 'guest-group-with-duplicate',
        submissionId: 'guest-group-with-duplicate',
        cluster_id: 'face-dup60b4b',
        clusterId: 'face-dup60b4b',
        face_index: 0,
        faceIndex: 0,
        match_confidence: 98,
        matchConfidence: 98,
        bounding_box_json: JSON.stringify({ Left: 0.18, Top: 0.12, Width: 0.12, Height: 0.12 }),
        boundingBoxJson: JSON.stringify({ Left: 0.18, Top: 0.12, Width: 0.12, Height: 0.12 })
      }),
      faceRow({
        id: 'group-new-face',
        submission_id: 'guest-group-with-duplicate',
        submissionId: 'guest-group-with-duplicate',
        cluster_id: 'face-new6096',
        clusterId: 'face-new6096',
        face_index: 1,
        faceIndex: 1,
        match_confidence: 0,
        matchConfidence: 0,
        bounding_box_json: JSON.stringify({ Left: 0.54, Top: 0.22, Width: 0.1, Height: 0.09 }),
        boundingBoxJson: JSON.stringify({ Left: 0.54, Top: 0.22, Width: 0.1, Height: 0.09 })
      })
    ]
  });
  const bucket = new FakeBucket([
    [soloDuplicate.object_key, 'source-solo-duplicate'],
    [groupWithDuplicate.object_key, 'source-group-with-duplicate']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 1);
    assert.match(calls[0].imageNames[0], /guest-solo-duplicate/);
    assert.equal(calls[0].imageNames.some((name) => name.includes('guest-group-with-duplicate')), false);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-solo-duplicate']);
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
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi({ status: 500, body: { error: { message: 'provider failed with detail' } } });

  try {
    const response = await approveSubmission(env, submission.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'failed');
    assert.match(db.groupHeroes[0].error_message, /provider failed/);
  } finally {
    restoreFetch();
  }
});

test('group hero attempt history preserves failed and successful retries', async () => {
  const submission = guestSubmission({
    id: 'guest-attempt-history',
    object_key: 'moments/event-hero/guest-attempt-history.jpg',
    objectKey: 'moments/event-hero/guest-attempt-history.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [submission] });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const env = envWithDb(db, bucket);
  let waitUntil = [];
  let calls = mockOpenAi({ status: 500, body: { error: { message: 'provider failed with diagnostic detail' } } });

  try {
    const firstResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(firstResponse.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);
    assert.equal(calls.length, 1);
  } finally {
    restoreFetch();
  }

  waitUntil = [];
  calls = mockOpenAi();
  try {
    const retryResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

    assert.equal(retryResponse.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);
    assert.equal(calls.length, 1);
  } finally {
    restoreFetch();
  }

  assert.equal(db.groupHeroes[0].status, 'ready');
  assert.equal(db.heroAttempts.length, 2);
  assert.equal(db.heroAttempts[0].status, 'failed');
  assert.equal(db.heroAttempts[0].phase, 'openai_request');
  assert.match(db.heroAttempts[0].error_message, /provider failed/);
  assert.equal(db.heroAttempts[1].status, 'ready');
  assert.equal(db.heroAttempts[1].phase, 'complete');
  assert.match(db.heroAttempts[1].object_key, /generated\/group-hero-/);
  assert.ok(Number(db.heroAttempts[1].openai_ms) >= 0);
  assert.ok(db.heroAttempts[0].completed_at);
  assert.ok(db.heroAttempts[1].completed_at);
});

test('OpenAI timeout stores failed group hero state without leaving generation stuck', async () => {
  const submission = guestSubmission({
    id: 'guest-timeout',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [submission] });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const env = envWithDb(db, bucket, { OPENAI_IMAGE_TIMEOUT_MS: '5' });
  const waitUntil = [];
  const calls = mockOpenAi({ hang: true });

  try {
    const response = await approveSubmission(env, submission.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(db.groupHeroes[0].status, 'failed');
    assert.match(db.groupHeroes[0].error_message, /timed out/i);
  } finally {
    restoreFetch();
  }
});

test('stale generating group hero state can be retried with the same source set', async () => {
  const submission = guestSubmission({
    id: 'guest-stale',
    object_key: 'moments/event-hero/guest-stale.jpg',
    objectKey: 'moments/event-hero/guest-stale.jpg',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [submission],
    groupHeroes: [readyHero({
      status: 'generating',
      object_key: 'moments/event-hero/generated/previous-group-hero.png',
      objectKey: 'moments/event-hero/generated/previous-group-hero.png',
      source_submission_ids: JSON.stringify(['guest-stale']),
      sourceSubmissionIds: JSON.stringify(['guest-stale']),
      updated_at: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })]
  });
  const bucket = new FakeBucket([
    [submission.object_key, 'source-photo'],
    ['moments/event-hero/generated/previous-group-hero.png', 'previous-generated']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(env, submission.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-stale']);
  } finally {
    restoreFetch();
  }
});

test('stale failed group hero state can be retried with the same source set', async () => {
  const submission = guestSubmission({
    id: 'guest-stale-failed',
    object_key: 'moments/event-hero/guest-stale-failed.jpg',
    objectKey: 'moments/event-hero/guest-stale-failed.jpg',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [submission],
    groupHeroes: [readyHero({
      status: 'failed',
      object_key: 'moments/event-hero/generated/previous-group-hero.png',
      objectKey: 'moments/event-hero/generated/previous-group-hero.png',
      source_submission_ids: JSON.stringify(['guest-stale-failed']),
      sourceSubmissionIds: JSON.stringify(['guest-stale-failed']),
      error_message: 'temporary provider outage',
      errorMessage: 'temporary provider outage',
      updated_at: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })]
  });
  const bucket = new FakeBucket([
    [submission.object_key, 'source-photo'],
    ['moments/event-hero/generated/previous-group-hero.png', 'previous-generated']
  ]);
  const env = envWithDb(db, bucket);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(env, submission.id);

    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-stale-failed']);
  } finally {
    restoreFetch();
  }
});

test('scheduled task retries stale failed group heroes automatically', async () => {
  const submission = guestSubmission({
    id: 'guest-scheduled-failed',
    object_key: 'moments/event-hero/guest-scheduled-failed.jpg',
    objectKey: 'moments/event-hero/guest-scheduled-failed.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [submission],
    groupHeroes: [readyHero({
      status: 'failed',
      source_submission_ids: JSON.stringify(['guest-scheduled-failed']),
      sourceSubmissionIds: JSON.stringify(['guest-scheduled-failed']),
      error_message: 'temporary provider outage',
      errorMessage: 'temporary provider outage',
      updated_at: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })]
  });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    await worker.scheduled({}, envWithDb(db, bucket), { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-scheduled-failed']);
  } finally {
    restoreFetch();
  }
});

test('scheduled task retries stale queued group heroes automatically', async () => {
  const submission = guestSubmission({
    id: 'guest-scheduled-queued',
    object_key: 'moments/event-hero/guest-scheduled-queued.jpg',
    objectKey: 'moments/event-hero/guest-scheduled-queued.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [submission],
    groupHeroes: [readyHero({
      status: 'queued',
      source_submission_ids: JSON.stringify(['guest-scheduled-queued']),
      sourceSubmissionIds: JSON.stringify(['guest-scheduled-queued']),
      updated_at: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })]
  });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    await worker.scheduled({}, envWithDb(db, bucket), { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-scheduled-queued']);
  } finally {
    restoreFetch();
  }
});

test('scheduled task retries stale generating group heroes automatically', async () => {
  const submission = guestSubmission({
    id: 'guest-scheduled-generating',
    object_key: 'moments/event-hero/guest-scheduled-generating.jpg',
    objectKey: 'moments/event-hero/guest-scheduled-generating.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [submission],
    groupHeroes: [readyHero({
      status: 'generating',
      source_submission_ids: JSON.stringify(['guest-scheduled-generating']),
      sourceSubmissionIds: JSON.stringify(['guest-scheduled-generating']),
      updated_at: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    })]
  });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    await worker.scheduled({}, envWithDb(db, bucket), { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-scheduled-generating']);
  } finally {
    restoreFetch();
  }
});

test('scheduled task processes fresh queued group heroes automatically', async () => {
  const submission = guestSubmission({
    id: 'guest-scheduled-fresh-queued',
    object_key: 'moments/event-hero/guest-scheduled-fresh-queued.jpg',
    objectKey: 'moments/event-hero/guest-scheduled-fresh-queued.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [submission],
    groupHeroes: [readyHero({
      status: 'queued',
      source_submission_ids: JSON.stringify(['guest-scheduled-fresh-queued']),
      sourceSubmissionIds: JSON.stringify(['guest-scheduled-fresh-queued'])
    })]
  });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  const waitUntil = [];
  const calls = mockOpenAi();

  try {
    await worker.scheduled({}, envWithDb(db, bucket), { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-scheduled-fresh-queued']);
  } finally {
    restoreFetch();
  }
});

test('older overlapping group hero generation cannot overwrite a newer result', async () => {
  const first = guestSubmission({
    id: 'guest-first',
    object_key: 'moments/event-hero/guest-first.jpg',
    objectKey: 'moments/event-hero/guest-first.jpg',
    guest_name: 'First Guest',
    guestName: 'First Guest',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const second = guestSubmission({
    id: 'guest-second',
    object_key: 'moments/event-hero/guest-second.jpg',
    objectKey: 'moments/event-hero/guest-second.jpg',
    guest_name: 'Second Guest',
    guestName: 'Second Guest',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [first, second] });
  const bucket = new FakeBucket([
    [first.object_key, 'source-first'],
    [second.object_key, 'source-second']
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAiDeferred();

  try {
    const firstResponse = await approveSubmission(env, first.id);
    const firstScheduled = worker.scheduled({}, env, { waitUntil() {} });
    await waitForOpenAiCalls(calls, 1);

    const secondResponse = await approveSubmission(env, second.id);
    const secondScheduled = worker.scheduled({}, env, { waitUntil() {} });

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    await waitForOpenAiCalls(calls, 2);
    assert.equal(calls.length, 2);
    assert.match(calls[0].imageNames[0], /guest-first/);
    assert.equal(calls[1].imageCount, 2);

    calls[1].resolveSuccess('newer-generated-png');
    await secondScheduled;

    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-second', 'guest-first']);

    calls[0].resolveSuccess('older-generated-png');
    await firstScheduled;

    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-second', 'guest-first']);
    assert.equal(bucket.puts.at(-1).body.byteLength, new TextEncoder().encode('newer-generated-png').byteLength);
  } finally {
    resolvePendingOpenAiCalls(calls);
    restoreFetch();
  }
});

test('group hero retries without an OpenAI-rejected input image', async () => {
  const invalid = guestSubmission({
    id: 'guest-invalid',
    object_key: 'moments/event-hero/guest-invalid.jpg',
    objectKey: 'moments/event-hero/guest-invalid.jpg',
    guest_name: 'Invalid Source',
    guestName: 'Invalid Source',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const valid = guestSubmission({
    id: 'guest-valid',
    object_key: 'moments/event-hero/guest-valid.jpg',
    objectKey: 'moments/event-hero/guest-valid.jpg',
    guest_name: 'Valid Source',
    guestName: 'Valid Source',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [valid, invalid] });
  const bucket = new FakeBucket([
    [invalid.object_key, 'bad-image-bytes'],
    [valid.object_key, 'good-image-bytes']
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi({
    responses: [
      {
        status: 400,
        body: { error: { message: 'Invalid image file or mode for image 1, please check your image file.' } }
      },
      { status: 200, body: { data: [{ b64_json: btoa('generated-png') }] } }
    ]
  });

  try {
    const response = await approveSubmission(env, valid.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await runScheduled(env);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].imageCount, 2);
    assert.equal(calls[1].imageCount, 1);
    assert.match(calls[1].imageNames[0], /guest-valid/);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 1);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-valid']);
  } finally {
    restoreFetch();
  }
});

test('group hero handles alternate OpenAI rejected-image index wording', async () => {
  const invalid = guestSubmission({
    id: 'guest-alt-invalid',
    object_key: 'moments/event-hero/guest-alt-invalid.jpg',
    objectKey: 'moments/event-hero/guest-alt-invalid.jpg',
    guest_name: 'Alternate Invalid Source',
    guestName: 'Alternate Invalid Source',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const valid = guestSubmission({
    id: 'guest-alt-valid',
    object_key: 'moments/event-hero/guest-alt-valid.jpg',
    objectKey: 'moments/event-hero/guest-alt-valid.jpg',
    guest_name: 'Alternate Valid Source',
    guestName: 'Alternate Valid Source',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [valid, invalid] });
  const bucket = new FakeBucket([
    [invalid.object_key, 'bad-image-bytes'],
    [valid.object_key, 'good-image-bytes']
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi({
    responses: [
      {
        status: 400,
        body: { error: { message: 'Invalid input_image[0]: unsupported image format.' } }
      },
      { status: 200, body: { data: [{ b64_json: btoa('generated-png') }] } }
    ]
  });

  try {
    const response = await approveSubmission(env, valid.id);

    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await runScheduled(env);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].imageCount, 2);
    assert.equal(calls[1].imageCount, 1);
    assert.match(calls[1].imageNames[0], /guest-alt-valid/);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-alt-valid']);
  } finally {
    restoreFetch();
  }
});

test('group hero isolates an unindexed OpenAI source-image rejection', async () => {
  const invalid = guestSubmission({
    id: 'guest-unindexed-invalid',
    object_key: 'moments/event-hero/guest-unindexed-invalid.jpg',
    objectKey: 'moments/event-hero/guest-unindexed-invalid.jpg',
    guest_name: 'Unindexed Invalid Source',
    guestName: 'Unindexed Invalid Source',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const valid = guestSubmission({
    id: 'guest-unindexed-valid',
    object_key: 'moments/event-hero/guest-unindexed-valid.jpg',
    objectKey: 'moments/event-hero/guest-unindexed-valid.jpg',
    guest_name: 'Unindexed Valid Source',
    guestName: 'Unindexed Valid Source',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [valid, invalid] });
  const bucket = new FakeBucket([
    [invalid.object_key, 'bad-image-bytes'],
    [valid.object_key, 'good-image-bytes']
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi({
    responses: [
      {
        status: 400,
        body: { error: { message: 'One of the uploaded input images could not be decoded. Use a supported image file.' } }
      },
      { status: 200, body: { data: [{ b64_json: btoa('generated-png') }] } }
    ]
  });

  try {
    const response = await approveSubmission(env, valid.id);

    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await runScheduled(env);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].imageCount, 2);
    assert.equal(calls[1].imageCount, 1);
    assert.match(calls[1].imageNames[0], /guest-unindexed-valid/);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 1);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-unindexed-valid']);
  } finally {
    restoreFetch();
  }
});

test('group hero tries to normalize an OpenAI-rejected photo before excluding it', async () => {
  const invalid = guestSubmission({
    id: 'guest-invalid',
    object_key: 'moments/event-hero/guest-invalid.jpg',
    objectKey: 'moments/event-hero/guest-invalid.jpg',
    guest_name: 'Invalid Source',
    guestName: 'Invalid Source',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:02:00.000Z',
    createdAt: '2026-09-19T20:02:00.000Z'
  });
  const valid = guestSubmission({
    id: 'guest-valid',
    object_key: 'moments/event-hero/guest-valid.jpg',
    objectKey: 'moments/event-hero/guest-valid.jpg',
    guest_name: 'Valid Source',
    guestName: 'Valid Source',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:01:00.000Z',
    createdAt: '2026-09-19T20:01:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [valid, invalid] });
  const normalizedBytes = 'normalized-bad-image-bytes';
  const bucket = new FakeBucket([
    [invalid.object_key, 'bad-image-bytes'],
    [valid.object_key, 'good-image-bytes']
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi({
    normalizationBody: normalizedBytes,
    responses: [
      {
        status: 400,
        body: { error: { message: 'Invalid image file or mode for image 1, please check your image file.' } }
      },
      { status: 200, body: { data: [{ b64_json: btoa('generated-png') }] } }
    ]
  });

  try {
    const response = await approveSubmission(env, valid.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await runScheduled(env);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].imageCount, 2);
    assert.equal(calls[1].imageCount, 2);
    assert.match(calls[1].imageNames[0], /guest-invalid-ai-reference\.jpg$/);
    assert.equal(calls[1].imageSizes[0], new TextEncoder().encode(normalizedBytes).byteLength);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-invalid', 'guest-valid']);
  } finally {
    restoreFetch();
  }
});

test('group hero includes legacy photo MIME variants when an AI reference is available', async () => {
  const heic = guestSubmission({
    id: 'guest-heic',
    object_key: 'moments/event-hero/guest-heic.heic',
    objectKey: 'moments/event-hero/guest-heic.heic',
    original_filename: 'guest-heic.heic',
    originalFilename: 'guest-heic.heic',
    mime_type: 'image/heic',
    mimeType: 'image/heic',
    guest_name: 'Legacy Heic Source',
    guestName: 'Legacy Heic Source',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:04:00.000Z',
    createdAt: '2026-09-19T20:04:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [heic] });
  const normalizedBytes = 'normalized-heic-reference';
  const bucket = new FakeBucket([
    [heic.object_key, 'original-heic-bytes'],
    ['moments/event-hero/ai-references/guest-heic.jpg', normalizedBytes]
  ]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(env, heic.id);

    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await runScheduled(env);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 1);
    assert.match(calls[0].imageNames[0], /guest-heic-ai-reference\.jpg$/);
    assert.equal(calls[0].imageSizes[0], new TextEncoder().encode(normalizedBytes).byteLength);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-heic']);
  } finally {
    restoreFetch();
  }
});

test('host can backfill a normalized AI reference for an approved legacy photo and refresh the group hero', async () => {
  const legacy = guestSubmission({
    id: 'guest-legacy-invalid',
    object_key: 'moments/event-hero/guest-legacy-invalid.jpg',
    objectKey: 'moments/event-hero/guest-legacy-invalid.jpg',
    guest_name: 'Legacy Source',
    guestName: 'Legacy Source',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z',
    created_at: '2026-09-19T20:04:00.000Z',
    createdAt: '2026-09-19T20:04:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [legacy] });
  const normalizedBytes = 'normalized-legacy-image';
  const bucket = new FakeBucket([[legacy.object_key, 'legacy-original-bytes']]);
  const env = envWithDb(db, bucket);
  const calls = mockOpenAi({ normalizationBody: normalizedBytes });
  const waitUntil = [];

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/submissions/guest-legacy-invalid/ai-reference/backfill', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env, { waitUntil: (work) => waitUntil.push(work) });
    const payload = await response.json();

    assert.equal(response.status, 202);
    assert.equal(payload.aiReferenceReady, true);
    assert.match(payload.objectKey, /^moments\/event-hero\/ai-references\/guest-legacy-invalid\.jpg$/);
    assert.ok(bucket.objects.has('moments/event-hero/ai-references/guest-legacy-invalid.jpg'));

    await Promise.all(waitUntil);
    await runScheduled(env);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageCount, 1);
    assert.match(calls[0].imageNames[0], /guest-legacy-invalid-ai-reference\.jpg$/);
    assert.equal(calls[0].imageSizes[0], new TextEncoder().encode(normalizedBytes).byteLength);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 1);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-legacy-invalid']);
  } finally {
    restoreFetch();
  }
});

test('guest and host group hero endpoints enforce access tokens', async () => {
  const source = guestSubmission({
    id: 'guest-source',
    object_key: 'moments/event-hero/guest-source.jpg',
    objectKey: 'moments/event-hero/guest-source.jpg',
    status: 'approved',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [source],
    groupHeroes: [readyHero()]
  });
  const env = envWithDb(db, new FakeBucket([
    ['moments/event-hero/generated/group-hero.png', 'generated'],
    [source.object_key, 'source-photo']
  ]));
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

  const calls = mockOpenAi();
  try {
    let waitUntilCalled = false;
    const ctx = {
      waitUntil() {
        waitUntilCalled = true;
      }
    };
    const goodHost = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env, ctx);
    assert.equal(goodHost.status, 202);
    assert.equal(waitUntilCalled, false);
    assert.equal(calls.length, 0);
    assert.equal(db.groupHeroes[0].status, 'queued');
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
  const env = envWithDb(db, bucket);
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
    }), env);

    assert.equal(rejectResponse.status, 200);
    assert.equal(db.groupHeroes[0].status, 'queued');

    await runScheduled(env);

    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 1);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-b']);

    const deleteResponse = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/submissions/guest-b', {
      method: 'DELETE',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), env);

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
  assert.match(guestHtml, /styles\.css\?v=20260605-ai-hero-contain-1/);
  assert.match(guestHtml, /app\.js\?v=20260605-ai-reference-1/);
  assert.match(guestJs, /function renderGroupHero/);
  assert.match(guestJs, /formData\.append\("aiArtworkConsent", "true"\)/);
  assert.match(guestJs, /function createAiReferenceFile/);
  assert.match(guestJs, /formData\.append\("aiReference", aiReferenceFile\)/);
  assert.match(hostHtml, /id="groupHeroHostCard"/);
  assert.match(hostHtml, /styles\.css\?v=20260607-host-aspect-1/);
  assert.match(hostHtml, /host\.js\?v=20260605-auto-approve-1/);
  assert.match(hostJs, /function regenerateGroupHero/);
  assert.match(hostJs, /group-hero\/regenerate/);
  assert.match(styles, /\.group-hero-panel/);
  assert.match(styles, /\.group-hero-frame,[\s\S]*?aspect-ratio: 3 \/ 2;/);
  assert.match(styles, /\.group-hero-frame img,[\s\S]*?object-fit: contain;/);
  assert.match(migration, /ai_artwork_consent_at TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_group_heroes/);
});

test('Worker source query supports video thumbnail inputs for group heroes', async () => {
  const source = await readText('../src/index.js');
  assert.match(source, /thumbnail_object_key AS objectKey/);
  assert.match(source, /thumbnail_mime_type AS mimeType/);
  assert.match(source, /media_type = 'video'/);
  assert.doesNotMatch(source, /media_type = 'photo' AND mime_type IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/);
  assert.doesNotMatch(source, /thumbnail_mime_type IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/);
});

test('group hero merges two clusters that CompareFaces says are the same person', async () => {
  // photoA is newer (DESC order puts it first) so it becomes the kept participant.
  const photoA = guestSubmission({
    id: 'guest-dupe-a', object_key: 'moments/event-hero/guest-dupe-a.jpg', objectKey: 'moments/event-hero/guest-dupe-a.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z', createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z', aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
  });
  const photoB = guestSubmission({
    id: 'guest-dupe-b', object_key: 'moments/event-hero/guest-dupe-b.jpg', objectKey: 'moments/event-hero/guest-dupe-b.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z', createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z', aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [photoA, photoB],
    faces: [
      faceRow({ submission_id: 'guest-dupe-a', submissionId: 'guest-dupe-a', cluster_id: 'face-dupA', clusterId: 'face-dupA',
        bounding_box_json: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }),
        boundingBoxJson: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }) }),
      faceRow({ id: 'face-b', submission_id: 'guest-dupe-b', submissionId: 'guest-dupe-b', cluster_id: 'face-dupB', clusterId: 'face-dupB',
        bounding_box_json: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }),
        boundingBoxJson: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }) })
    ]
  });
  // Single-face sources use reference crops (not cutouts). Pre-store them so the
  // cache-hit path fires and getGroupHeroDedupeImageBytes can read the bytes.
  const bucket = new FakeBucket([
    [photoA.object_key, 'src-a'], [photoB.object_key, 'src-b'],
    ['moments/event-hero/generated/person-roster/guest-dupe-a-face-dupA-v5.jpg', 'ref-crop-a'],
    ['moments/event-hero/generated/person-roster/guest-dupe-b-face-dupB-v5.jpg', 'ref-crop-b']
  ]);
  const env = envWithDb(db, bucket, { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' });
  const waitUntil = [];
  const calls = mockOpenAiWithCompareFaces({ similarity: 98 });

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    assert.equal(response.status, 202);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.compareFaces.length, 1); // both sources reached the merge and were compared
    assert.equal(calls.openAi.length, 1);
    assert.equal(calls.openAi[0].imageCount, 1); // duplicate merged out
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-dupe-a']);
  } finally {
    restoreFetch();
  }
});

test('group hero keeps both participants when CompareFaces is below the merge threshold', async () => {
  // photoA is newer (DESC order puts it first) so both appear in A-then-B order.
  const photoA = guestSubmission({
    id: 'guest-keep-a', object_key: 'moments/event-hero/guest-keep-a.jpg', objectKey: 'moments/event-hero/guest-keep-a.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z', createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z', aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
  });
  const photoB = guestSubmission({
    id: 'guest-keep-b', object_key: 'moments/event-hero/guest-keep-b.jpg', objectKey: 'moments/event-hero/guest-keep-b.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z', createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z', aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const db = new GroupHeroFakeDb({
    submissions: [photoA, photoB],
    faces: [
      faceRow({ submission_id: 'guest-keep-a', submissionId: 'guest-keep-a', cluster_id: 'face-keepA', clusterId: 'face-keepA',
        bounding_box_json: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }),
        boundingBoxJson: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }) }),
      faceRow({ id: 'face-kb', submission_id: 'guest-keep-b', submissionId: 'guest-keep-b', cluster_id: 'face-keepB', clusterId: 'face-keepB',
        bounding_box_json: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }),
        boundingBoxJson: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.18, Height: 0.18 }) })
    ]
  });
  // Pre-store reference crops for both single-face sources.
  const bucket = new FakeBucket([
    [photoA.object_key, 'src-a'], [photoB.object_key, 'src-b'],
    ['moments/event-hero/generated/person-roster/guest-keep-a-face-keepA-v5.jpg', 'ref-crop-a'],
    ['moments/event-hero/generated/person-roster/guest-keep-b-face-keepB-v5.jpg', 'ref-crop-b']
  ]);
  const env = envWithDb(db, bucket, { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' });
  const waitUntil = [];
  const calls = mockOpenAiWithCompareFaces({ similarity: 60 });

  try {
    await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: { Origin: 'https://williamsonwallflowers.com', Authorization: 'Bearer host-token' }
    }), env);
    await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
    await drainWaitUntil(waitUntil);

    assert.equal(calls.compareFaces.length, 1); // compared once, similarity below threshold -> kept
    assert.equal(calls.openAi[0].imageCount, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-keep-a', 'guest-keep-b']);
  } finally {
    restoreFetch();
  }
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
  if (options.aiReference) {
    formData.set('aiReference', new File(['normalized-photo'], 'ai-reference.jpg', { type: 'image/jpeg' }));
  }
  formData.set('uploadToken', uploadToken);

  return worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/events/event-hero/submissions', {
    method: 'POST',
    headers: { Origin: 'https://williamsonwallflowers.com' },
    body: formData
  }), env);
}

function approveSubmission(env, submissionId, ctx) {
  return worker.fetch(new Request(`https://williamsonwallflowers.com/moments-api/host/submissions/${submissionId}`, {
    method: 'PATCH',
    headers: {
      Origin: 'https://williamsonwallflowers.com',
      Authorization: 'Bearer host-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'approved' })
  }), env, ctx);
}

let originalFetch = null;

function mockOpenAi({
  status = 200,
  body = { data: [{ b64_json: btoa('generated-png') }] },
  responses = null,
  normalizationBody = null,
  hang = false
} = {}) {
  originalFetch = globalThis.fetch;
  const calls = [];
  let callIndex = 0;
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    if (urlText.includes('/moments-api/media/') || urlText.includes('/moments-api/thumbnails/')) {
      if (normalizationBody !== null) {
        return new Response(normalizationBody, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' }
        });
      }
      return new Response('', { status: 502 });
    }
    if (urlText.includes('api.openai.com/v1/images/edits')) {
      if (hang) {
        return new Promise((resolve, reject) => {
          const signal = init.signal;
          if (!signal) return;
          if (signal.aborted) {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          signal.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      const entries = Array.from(init.body.entries());
      const images = entries.filter(([key]) => key === 'image[]');
      calls.push({
        url,
        model: entries.find(([key]) => key === 'model')?.[1],
        prompt: entries.find(([key]) => key === 'prompt')?.[1],
        imageCount: images.length,
        imageNames: images.map(([, image]) => image?.name || ''),
        imageSizes: images.map(([, image]) => image?.size || 0)
      });
      const response = Array.isArray(responses)
        ? responses[Math.min(callIndex, responses.length - 1)]
        : { status, body };
      callIndex += 1;
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(url, init);
  };
  return calls;
}

function mockOpenAiAndAwsRekognition() {
  originalFetch = globalThis.fetch;
  const calls = {
    awsTargets: [],
    openAi: []
  };
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    if (urlText.includes('rekognition.')) {
      const target = init.headers?.get?.('X-Amz-Target')
        || init.headers?.get?.('x-amz-target')
        || init.headers?.['X-Amz-Target']
        || init.headers?.['x-amz-target']
        || '';
      calls.awsTargets.push(target);
      if (target === 'RekognitionService.CreateCollection') {
        return new Response(JSON.stringify({ StatusCode: 200 }), {
          status: 200,
          headers: { 'Content-Type': 'application/x-amz-json-1.1' }
        });
      }
      if (target === 'RekognitionService.IndexFaces') {
        return new Response(JSON.stringify({
          FaceRecords: [{
            Face: {
              FaceId: 'aws-face-new',
              Confidence: 99.8,
              BoundingBox: { Left: 0.25, Top: 0.2, Width: 0.3, Height: 0.32 }
            },
            FaceDetail: {
              Quality: { Brightness: 82, Sharpness: 91 }
            }
          }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/x-amz-json-1.1' }
        });
      }
      if (target === 'RekognitionService.SearchFaces') {
        return new Response(JSON.stringify({ FaceMatches: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/x-amz-json-1.1' }
        });
      }
    }
    if (urlText.includes('api.openai.com/v1/images/edits')) {
      const entries = Array.from(init.body.entries());
      const images = entries.filter(([key]) => key === 'image[]');
      calls.openAi.push({
        url,
        prompt: entries.find(([key]) => key === 'prompt')?.[1],
        imageCount: images.length,
        imageNames: images.map(([, image]) => image?.name || '')
      });
      return new Response(JSON.stringify({ data: [{ b64_json: btoa('generated-png') }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(url, init);
  };
  return calls;
}

function mockOpenAiWithCompareFaces({ similarity = 0 } = {}) {
  originalFetch = globalThis.fetch;
  const calls = { openAi: [], compareFaces: [] };
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    if (urlText.includes('rekognition.')) {
      const target = init.headers?.['x-amz-target'] || init.headers?.['X-Amz-Target'] || '';
      if (target === 'RekognitionService.CompareFaces') {
        calls.compareFaces.push(target);
        return new Response(JSON.stringify({ FaceMatches: similarity > 0 ? [{ Similarity: similarity }] : [] }), {
          status: 200, headers: { 'Content-Type': 'application/x-amz-json-1.1' }
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/x-amz-json-1.1' } });
    }
    if (urlText.includes('/moments-api/media/') || urlText.includes('/moments-api/thumbnails/')) {
      return new Response('', { status: 502 });
    }
    if (urlText.includes('api.openai.com/v1/images/edits')) {
      const entries = Array.from(init.body.entries());
      const images = entries.filter(([key]) => key === 'image[]');
      calls.openAi.push({
        prompt: entries.find(([key]) => key === 'prompt')?.[1],
        imageCount: images.length,
        imageNames: images.map(([, image]) => image?.name || '')
      });
      return new Response(JSON.stringify({ data: [{ b64_json: btoa('generated-png') }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(url, init);
  };
  return calls;
}

function mockOpenAiDeferred() {
  originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    if (urlText.includes('/v1/images/edits')) {
      const entries = Array.from(init.body.entries());
      const images = entries.filter(([key]) => key === 'image[]');
      let resolveResponse;
      const responsePromise = new Promise((resolve) => {
        resolveResponse = resolve;
      });
      calls.push({
        url,
        model: entries.find(([key]) => key === 'model')?.[1],
        prompt: entries.find(([key]) => key === 'prompt')?.[1],
        imageCount: images.length,
        imageNames: images.map(([, image]) => image?.name || ''),
        imageSizes: images.map(([, image]) => image?.size || 0),
        resolved: false,
        resolveSuccess(value = 'generated-png') {
          this.resolved = true;
          resolveResponse(new Response(JSON.stringify({ data: [{ b64_json: btoa(value) }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      });
      return responsePromise;
    }
    return originalFetch(url, init);
  };
  return calls;
}

async function waitForOpenAiCalls(calls, expectedCount) {
  const startedAt = Date.now();
  while (calls.length < expectedCount && Date.now() - startedAt < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function drainWaitUntil(tasks) {
  for (let index = 0; index < tasks.length; index += 1) {
    await tasks[index];
  }
}

async function runScheduled(env) {
  const waitUntil = [];
  await worker.scheduled({}, env, { waitUntil: (work) => waitUntil.push(work) });
  await drainWaitUntil(waitUntil);
}

function resolvePendingOpenAiCalls(calls) {
  for (const call of calls) {
    if (!call.resolved && typeof call.resolveSuccess === 'function') {
      call.resolveSuccess('cleanup-generated-png');
    }
  }
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

function faceRow(overrides = {}) {
  return {
    id: 'face-1',
    event_id: 'event-hero',
    eventId: 'event-hero',
    submission_id: 'guest-approved',
    submissionId: 'guest-approved',
    face_index: 0,
    faceIndex: 0,
    provider: 'aws-rekognition',
    provider_face_id: 'provider-face-1',
    providerFaceId: 'provider-face-1',
    cluster_id: 'cluster-1',
    clusterId: 'cluster-1',
    confidence: 99,
    bounding_box_json: '{}',
    boundingBoxJson: '{}',
    quality_json: '{}',
    qualityJson: '{}',
    match_confidence: 99,
    matchConfidence: 99,
    status: 'ready',
    face_signature_version: 1,
    faceSignatureVersion: 1,
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

function isFakeGroupHeroPhotoCandidate(mimeType, filename = '') {
  const baseMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(baseMimeType)) return true;
  if (baseMimeType.startsWith('image/')) return true;
  if (!baseMimeType || ['application/octet-stream', 'binary/octet-stream'].includes(baseMimeType)) {
    return Boolean(fakeImageMimeTypeForExtension(filename));
  }
  return false;
}

function isFakeGroupHeroThumbnailCandidate(mimeType, filename = '') {
  const baseMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].includes(baseMimeType)) return true;
  if (baseMimeType.startsWith('image/')) return true;
  if (!baseMimeType || ['application/octet-stream', 'binary/octet-stream'].includes(baseMimeType)) {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(fakeImageMimeTypeForExtension(filename));
  }
  return false;
}

function fakeImageMimeTypeForExtension(filename = '') {
  const extension = String(filename || '').split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  return '';
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
    this.faceAnalyses = seed.faceAnalyses ? seed.faceAnalyses.map((analysis) => ({ ...analysis })) : [];
    this.faces = seed.faces ? seed.faces.map((face) => ({ ...face })) : [];
    this.faceClusters = seed.faceClusters ? seed.faceClusters.map((cluster) => ({ ...cluster })) : [];
    this.sourceDecisions = seed.sourceDecisions ? seed.sourceDecisions.map((decision) => ({ ...decision })) : [];
    this.heroAttempts = seed.heroAttempts ? seed.heroAttempts.map((attempt) => ({ ...attempt })) : [];
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

    if (this.sql.includes('FROM submission_face_analyses')) {
      return this.db.faceAnalyses.find((analysis) => (analysis.submission_id || analysis.submissionId) === this.params[0]) || null;
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
    if (this.sql.includes('FROM event_group_heroes') && this.sql.includes("status = 'queued'")) {
      const [cutoff, limit] = this.params;
      const staleStatuses = new Set(['generating', 'failed']);
      return {
        results: this.db.groupHeroes
          .filter((hero) => hero.status === 'queued' || staleStatuses.has(hero.status))
          .filter((hero) => hero.status === 'queued' || String(hero.updated_at || hero.updatedAt || '') <= String(cutoff))
          .sort((left, right) => new Date(left.updated_at || left.updatedAt || 0) - new Date(right.updated_at || right.updatedAt || 0))
          .slice(0, Number(limit) || 10)
          .map((hero) => ({
            eventId: hero.event_id || hero.eventId,
            event_id: hero.event_id || hero.eventId
          }))
      };
    }

    if (this.sql.includes('FROM submission_face_analyses')) {
      const eventId = this.params[0];
      const version = Number(this.params[1] || 0);
      return {
        results: this.db.faceAnalyses
          .filter((analysis) => (analysis.event_id || analysis.eventId) === eventId)
          .filter((analysis) => Number(analysis.face_signature_version || analysis.faceSignatureVersion || 0) === version)
          .map((analysis) => ({
            ...analysis,
            submissionId: analysis.submission_id || analysis.submissionId,
            sourceObjectKey: analysis.source_object_key || analysis.sourceObjectKey,
            faceSignatureVersion: analysis.face_signature_version || analysis.faceSignatureVersion
          }))
      };
    }

    if (this.sql.includes('FROM submission_faces')) {
      const eventId = this.params[0];
      return {
        results: this.db.faces
          .filter((face) => (face.event_id || face.eventId) === eventId)
          .filter((face) => (face.status || 'ready') === 'ready')
          .filter((face) => Number(face.face_signature_version || face.faceSignatureVersion || 0) >= 1)
          .map((face) => ({
            ...face,
            submissionId: face.submission_id || face.submissionId,
            clusterId: face.cluster_id || face.clusterId,
            providerFaceId: face.provider_face_id || face.providerFaceId
          }))
      };
    }

    if (this.sql.includes('FROM submissions') && this.sql.includes('ai_artwork_consent_at IS NOT NULL')) {
      const [eventId, limit] = this.params;
      const includesHostSources = this.sql.includes("source IN ('guest', 'host')");
      return {
        results: this.db.submissions
          .filter((item) => (item.event_id || item.eventId) === eventId)
          .filter((item) => {
            const source = item.source || 'guest';
            return includesHostSources
              ? source === 'guest' || source === 'host'
              : source === 'guest';
          })
          .filter((item) => item.status === 'approved')
          .filter((item) => !(item.deleted_at || item.deletedAt))
          .filter((item) => {
            const source = item.source || 'guest';
            if (includesHostSources && source === 'host') return true;
            return Boolean(item.ai_artwork_consent_at || item.aiArtworkConsentAt);
          })
          .filter((item) => {
            const mediaType = item.media_type || item.mediaType;
            if (mediaType === 'photo') {
              return isFakeGroupHeroPhotoCandidate(
                item.mime_type || item.mimeType,
                item.original_filename || item.originalFilename || item.object_key || item.objectKey
              );
            }
            if (mediaType === 'video') {
              return Boolean(item.thumbnail_object_key || item.thumbnailObjectKey)
                && isFakeGroupHeroThumbnailCandidate(
                  item.thumbnail_mime_type || item.thumbnailMimeType,
                  item.thumbnail_object_key || item.thumbnailObjectKey
                );
            }
            return false;
          })
          .sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0))
          .slice(0, Number(limit || 16))
          .map((item) => ({
            id: item.id,
            eventId: item.event_id || item.eventId,
            source: item.source || 'guest',
            mediaType: item.media_type || item.mediaType,
            guestName: item.guest_name || item.guestName,
            objectKey: (item.media_type || item.mediaType) === 'video'
              ? item.thumbnail_object_key || item.thumbnailObjectKey
              : item.object_key || item.objectKey,
            originalFilename: item.original_filename || item.originalFilename,
            mimeType: (item.media_type || item.mediaType) === 'video'
              ? item.thumbnail_mime_type || item.thumbnailMimeType
              : item.mime_type || item.mimeType,
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

    if (this.sql.includes('DELETE FROM event_group_hero_source_decisions')) {
      this.db.sourceDecisions = this.db.sourceDecisions.filter((decision) => (decision.event_id || decision.eventId) !== this.params[0]);
    }

    if (this.sql.includes('DELETE FROM submission_faces')) {
      const submissionId = this.params[0];
      this.db.faces = this.db.faces.filter((face) => (face.submission_id || face.submissionId) !== submissionId);
    }

    if (this.sql.includes('DELETE FROM event_face_clusters')) {
      const eventId = this.params[0];
      this.db.faceClusters = this.db.faceClusters.filter((cluster) => (cluster.event_id || cluster.eventId) !== eventId);
    }

    if (this.sql.includes('INSERT INTO submission_face_analyses')) {
      const [
        submissionId,
        eventId,
        sourceObjectKey,
        provider,
        status,
        faceCount,
        errorMessage,
        faceSignatureVersion,
        analyzedAt,
        createdAt,
        updatedAt
      ] = this.params;
      const row = {
        submission_id: submissionId,
        submissionId,
        event_id: eventId,
        eventId,
        source_object_key: sourceObjectKey,
        sourceObjectKey,
        provider,
        status,
        face_count: faceCount,
        faceCount,
        error_message: errorMessage,
        errorMessage,
        face_signature_version: faceSignatureVersion,
        faceSignatureVersion,
        analyzed_at: analyzedAt,
        analyzedAt,
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      };
      const index = this.db.faceAnalyses.findIndex((item) => (item.submission_id || item.submissionId) === submissionId);
      if (index >= 0) this.db.faceAnalyses[index] = row;
      else this.db.faceAnalyses.push(row);
    }

    if (this.sql.includes('INSERT INTO submission_faces')) {
      const [
        id,
        eventId,
        submissionId,
        faceIndex,
        provider,
        providerFaceId,
        clusterId,
        confidence,
        boundingBoxJson,
        qualityJson,
        matchConfidence,
        status,
        faceSignatureVersion,
        createdAt,
        updatedAt
      ] = this.params;
      const row = {
        id,
        event_id: eventId,
        eventId,
        submission_id: submissionId,
        submissionId,
        face_index: faceIndex,
        faceIndex,
        provider,
        provider_face_id: providerFaceId,
        providerFaceId,
        cluster_id: clusterId,
        clusterId,
        confidence,
        bounding_box_json: boundingBoxJson,
        boundingBoxJson,
        quality_json: qualityJson,
        qualityJson,
        match_confidence: matchConfidence,
        matchConfidence,
        status,
        face_signature_version: faceSignatureVersion,
        faceSignatureVersion,
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      };
      const index = this.db.faces.findIndex((item) =>
        (item.submission_id || item.submissionId) === submissionId
        && Number(item.face_index ?? item.faceIndex ?? 0) === Number(faceIndex)
        && Number(item.face_signature_version || item.faceSignatureVersion || 0) === Number(faceSignatureVersion)
      );
      if (index >= 0) this.db.faces[index] = row;
      else this.db.faces.push(row);
    }

    if (this.sql.includes('INSERT INTO event_face_clusters')) {
      const [
        id,
        eventId,
        provider,
        representativeFaceId,
        representativeSubmissionId,
        sourceSubmissionIds,
        faceCount,
        faceSignatureVersion,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.faceClusters.push({
        id,
        event_id: eventId,
        eventId,
        provider,
        representative_face_id: representativeFaceId,
        representativeFaceId,
        representative_submission_id: representativeSubmissionId,
        representativeSubmissionId,
        source_submission_ids: sourceSubmissionIds,
        sourceSubmissionIds,
        face_count: faceCount,
        faceCount,
        status: 'ready',
        face_signature_version: faceSignatureVersion,
        faceSignatureVersion,
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      });
    }

    if (this.sql.includes('INSERT INTO event_group_hero_source_decisions')) {
      const [
        eventId,
        submissionId,
        decision,
        reason,
        clusterIds,
        newClusterIds,
        duplicateClusterIds,
        guestKey,
        score,
        createdAt
      ] = this.params;
      const row = {
        event_id: eventId,
        eventId,
        submission_id: submissionId,
        submissionId,
        decision,
        reason,
        cluster_ids: clusterIds,
        clusterIds,
        new_cluster_ids: newClusterIds,
        newClusterIds,
        duplicate_cluster_ids: duplicateClusterIds,
        duplicateClusterIds,
        guest_key: guestKey,
        guestKey,
        score,
        created_at: createdAt,
        createdAt
      };
      const index = this.db.sourceDecisions.findIndex((item) => (item.event_id || item.eventId) === eventId && (item.submission_id || item.submissionId) === submissionId);
      if (index >= 0) this.db.sourceDecisions[index] = row;
      else this.db.sourceDecisions.push(row);
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

    if (this.sql.includes('UPDATE event_group_heroes')) {
      const [
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
        updatedAt,
        eventId,
        expectedUpdatedAt,
        expectedSourceSubmissionIds
      ] = this.params;
      const existing = this.db.groupHeroes.find((hero) => (hero.event_id || hero.eventId) === eventId);
      if (
        existing &&
        (existing.updated_at || existing.updatedAt) === expectedUpdatedAt &&
        (existing.source_submission_ids || existing.sourceSubmissionIds) === expectedSourceSubmissionIds
      ) {
        Object.assign(existing, {
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
          updated_at: updatedAt,
          updatedAt
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
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

    if (this.sql.includes('CREATE TABLE IF NOT EXISTS event_group_hero_generation_attempts')) {
      return { success: true };
    }

    if (this.sql.includes('INSERT INTO event_group_hero_generation_attempts')) {
      const [
        id,
        eventId,
        status,
        phase,
        triggerType,
        sourceSubmissionIds,
        participantCount,
        model,
        sourceSelectionMs,
        startedAt,
        createdAt,
        updatedAt
      ] = this.params;
      this.db.heroAttempts.push({
        id,
        event_id: eventId,
        eventId,
        status,
        phase,
        trigger_type: triggerType,
        triggerType,
        source_submission_ids: sourceSubmissionIds,
        sourceSubmissionIds,
        participant_count: participantCount,
        participantCount,
        model,
        error_message: '',
        errorMessage: '',
        object_key: null,
        objectKey: null,
        source_selection_ms: sourceSelectionMs,
        sourceSelectionMs,
        face_reference_ms: 0,
        faceReferenceMs: 0,
        openai_ms: 0,
        openaiMs: 0,
        r2_write_ms: 0,
        r2WriteMs: 0,
        total_ms: 0,
        totalMs: 0,
        started_at: startedAt,
        startedAt,
        completed_at: null,
        completedAt: null,
        created_at: createdAt,
        createdAt,
        updated_at: updatedAt,
        updatedAt
      });
    }

    if (this.sql.includes('UPDATE event_group_hero_generation_attempts')) {
      const [
        status,
        phase,
        sourceSubmissionIds,
        participantCount,
        errorMessage,
        objectKey,
        faceReferenceMs,
        openaiMs,
        r2WriteMs,
        totalMs,
        completedAt,
        updatedAt,
        id
      ] = this.params;
      const attempt = this.db.heroAttempts.find((item) => item.id === id);
      if (attempt) {
        Object.assign(attempt, {
          status,
          phase,
          source_submission_ids: sourceSubmissionIds,
          sourceSubmissionIds,
          participant_count: participantCount,
          participantCount,
          error_message: errorMessage,
          errorMessage,
          object_key: objectKey,
          objectKey,
          face_reference_ms: faceReferenceMs,
          faceReferenceMs,
          openai_ms: openaiMs,
          openaiMs,
          r2_write_ms: r2WriteMs,
          r2WriteMs,
          total_ms: totalMs,
          totalMs,
          completed_at: completedAt,
          completedAt,
          updated_at: updatedAt,
          updatedAt
        });
      }
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
