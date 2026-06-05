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

test('approving an AI-consented photo generates a ready group hero from the latest 16 sources', async () => {
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
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(envWithDb(db, bucket), submission.id);

    assert.equal(response.status, 200);
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
  const calls = mockOpenAi();

  try {
    const response = await worker.fetch(new Request('https://williamsonwallflowers.com/moments-api/host/events/event-hero/group-hero/regenerate', {
      method: 'POST',
      headers: {
        Origin: 'https://williamsonwallflowers.com',
        Authorization: 'Bearer host-token'
      }
    }), envWithDb(db, bucket));

    assert.equal(response.status, 202);
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
  mockOpenAi();

  try {
    const response = await approveSubmission(envWithDb(db, bucket), duplicateNew.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.equal(db.groupHeroes[0].participant_count, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-linda-new', 'guest-mike']);
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

test('OpenAI timeout stores failed group hero state without leaving generation stuck', async () => {
  const submission = guestSubmission({
    id: 'guest-timeout',
    status: 'pending',
    ai_artwork_consent_at: '2026-09-19T20:00:00.000Z',
    aiArtworkConsentAt: '2026-09-19T20:00:00.000Z'
  });
  const db = new GroupHeroFakeDb({ submissions: [submission] });
  const bucket = new FakeBucket([[submission.object_key, 'source-photo']]);
  mockOpenAi({ hang: true });

  try {
    const response = await approveSubmission(envWithDb(db, bucket, { OPENAI_IMAGE_TIMEOUT_MS: '5' }), submission.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
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
  const calls = mockOpenAi();

  try {
    const response = await approveSubmission(envWithDb(db, bucket), submission.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
    assert.equal(calls.length, 1);
    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-stale']);
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
  const waitUntil = [];
  const ctx = { waitUntil: (work) => waitUntil.push(work) };

  try {
    const firstResponse = await approveSubmission(env, first.id, ctx);
    await waitForOpenAiCalls(calls, 1);
    const firstHeroWork = waitUntil.at(-1);

    const secondResponse = await approveSubmission(env, second.id, ctx);

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    await waitForOpenAiCalls(calls, 2);
    const secondHeroWork = waitUntil.at(-1);
    assert.equal(calls.length, 2);
    assert.ok(firstHeroWork);
    assert.ok(secondHeroWork);
    assert.notEqual(firstHeroWork, secondHeroWork);
    assert.match(calls[0].imageNames[0], /guest-first/);
    assert.equal(calls[1].imageCount, 2);

    calls[1].resolveSuccess('newer-generated-png');
    await secondHeroWork;

    assert.equal(db.groupHeroes[0].status, 'ready');
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-second', 'guest-first']);

    calls[0].resolveSuccess('older-generated-png');
    await firstHeroWork;

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
    const response = await approveSubmission(envWithDb(db, bucket), valid.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
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
    const response = await approveSubmission(envWithDb(db, bucket), valid.id);

    assert.equal(response.status, 200);
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
    const response = await approveSubmission(envWithDb(db, bucket), valid.id);

    assert.equal(response.status, 200);
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
    const response = await approveSubmission(envWithDb(db, bucket), valid.id);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'approved');
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

  mockOpenAi();
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
    assert.equal(db.groupHeroes[0].status, 'ready');
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
  assert.match(guestHtml, /styles\.css\?v=20260605-ai-hero-contain-1/);
  assert.match(guestHtml, /app\.js\?v=20260605-ai-reference-1/);
  assert.match(guestJs, /function renderGroupHero/);
  assert.match(guestJs, /formData\.append\("aiArtworkConsent", "true"\)/);
  assert.match(guestJs, /function createAiReferenceFile/);
  assert.match(guestJs, /formData\.append\("aiReference", aiReferenceFile\)/);
  assert.match(hostHtml, /id="groupHeroHostCard"/);
  assert.match(hostHtml, /styles\.css\?v=20260605-ai-hero-contain-1/);
  assert.match(hostHtml, /host\.js\?v=20260605-ai-group-hero-1/);
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
          .filter((item) => item.status === 'approved')
          .filter((item) => !(item.deleted_at || item.deletedAt))
          .filter((item) => item.ai_artwork_consent_at || item.aiArtworkConsentAt)
          .filter((item) => {
            const mediaType = item.media_type || item.mediaType;
            if (mediaType === 'photo') return ['image/jpeg', 'image/png', 'image/webp'].includes(item.mime_type || item.mimeType);
            if (mediaType === 'video') {
              return Boolean(item.thumbnail_object_key || item.thumbnailObjectKey)
                && ['image/jpeg', 'image/png', 'image/webp'].includes(item.thumbnail_mime_type || item.thumbnailMimeType);
            }
            return false;
          })
          .sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0))
          .slice(0, Number(limit || 16))
          .map((item) => ({
            id: item.id,
            eventId: item.event_id || item.eventId,
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
