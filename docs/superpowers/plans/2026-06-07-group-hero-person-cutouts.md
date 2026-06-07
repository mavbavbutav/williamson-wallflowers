# Group Hero Person Cutouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include every distinct guest in the AI group hero (even group-only people) without rendering anyone twice, by isolating each face with an AI cutout and then de-duplicating on those clean cutouts.

**Architecture:** Two phases in the existing Cloudflare Worker. Phase 1 generates a clean single-person "cutout" per selected face via an extra OpenAI `images/edits` pass (cached in R2), reverts the one-participant-per-photo limit, and adds a safe fallback ladder. Phase 2 runs a conservative AWS Rekognition `CompareFaces` merge over the cutouts to collapse the same person appearing under two face clusters.

**Tech Stack:** Cloudflare Workers (JS, ES modules), D1, R2, Cloudflare Image Resizing (`cf.image`), OpenAI `gpt-image` via `/v1/images/edits`, AWS Rekognition (SigV4 signed `fetch`), `node:test`.

---

## Spec

Design: `docs/superpowers/specs/2026-06-07-group-hero-person-cutouts-design.md`

## File Structure

All work is in two existing files (the worker is intentionally a single large module — follow that pattern, do not restructure):

- **Modify:** `worker/src/index.js`
  - New constants (cutout version, prompt, sizes, merge threshold, column width).
  - New: `getGroupHeroPersonCutoutObjectKey`, `requestOpenAiPersonCutout`, `createGroupHeroPersonCutout`, `withGroupHeroPersonCutout`, `prepareGroupHeroPersonInputs`, `prepareGroupHeroPersonInput`, `isGroupHeroFaceSoleInColumn` (Phase 1); `awsRekognitionCompareFaces`, `getGroupHeroDupMergeThreshold`, `getGroupHeroDedupeImageBytes`, `mergeDuplicateGroupHeroParticipants` (Phase 2).
  - Modify: `getGroupHeroSourceObject` (cutout priority), `generateEventGroupHero` (call new prepare + merge), `selectDistinctGroupHeroSources` (revert to multi-participant).
- **Modify/Test:** `worker/tests/ai-group-hero.test.js`

## Conventions for every task

- Run tests from the worker directory: `cd "C:\App Projects\JJ Entertainment Solutions\williamson-wallflowers\worker"`.
- Single-file run: `node --test tests/ai-group-hero.test.js`.
- Commit only the two files: `git add worker/src/index.js worker/tests/ai-group-hero.test.js`.
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

# PHASE 1 — Cutouts + un-limit per-photo

## Task 1: Add cutout constants and key helper

**Files:**
- Modify: `worker/src/index.js` (constants block near lines 18-62; helpers near `getGroupHeroPersonReferenceObjectKey` ~line 2205)

- [ ] **Step 1: Add constants**

After `const GROUP_HERO_PERSON_REFERENCE_VERSION = 5;` (line 59) add:

```js
const GROUP_HERO_PERSON_CUTOUT_VERSION = 1;
const GROUP_HERO_DUP_MERGE_THRESHOLD = 93; // similarity %, between soft (90) and strict cluster (97)
const GROUP_HERO_ISOLATED_COLUMN_HALF_WIDTH = 0.13; // normalized half-width of the isolated crop column
const GROUP_HERO_PERSON_CUTOUT_PROMPT = 'Output only the single person at the center of this image as a clean, realistic portrait on a plain neutral light-gray background. Remove every other person and all background clutter. Preserve their exact likeness, age, skin tone, hairstyle, facial hair, glasses, and clothing colors. Do not add any text, captions, or labels.';
```

- [ ] **Step 2: Add the cutout object-key helper**

Immediately after `getGroupHeroPersonReferenceObjectKey` (ends ~line 2209) add:

```js
function getGroupHeroPersonCutoutObjectKey(eventId, submissionId, clusterId) {
  const safeClusterId = safeGroupHeroObjectSegment(clusterId) || 'face';
  const safeSubmissionId = safeGroupHeroObjectSegment(submissionId) || 'submission';
  return `moments/${eventId}/generated/person-cutout/${safeSubmissionId}-${safeClusterId}-v${GROUP_HERO_PERSON_CUTOUT_VERSION}.png`;
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/index.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.js
git commit -m "Add group hero person-cutout constants and key helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Cutout generation + R2 priority (cache-hit path)

**Files:**
- Modify: `worker/src/index.js` (add functions after `createGroupHeroPersonReference`/`withGroupHeroPersonReference` ~line 2195; modify `getGroupHeroSourceObject` ~line 2005)
- Test: `worker/tests/ai-group-hero.test.js`

- [ ] **Step 1: Write the failing test**

Add this test after the `group hero sends body-aware person references for unique face clusters` test:

```js
test('group hero sends a cached person cutout when one already exists', async () => {
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
  const bucket = new FakeBucket([
    [solo.object_key, 'source-cutout-cached'],
    ['moments/event-hero/generated/person-cutout/guest-cutout-cached-face-cut111-v1.png', 'cached-cutout-bytes']
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

    // Only the final composition call — the cutout was a cache hit, no extra OpenAI call.
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].imageNames, ['guest-cutout-cached-face-cut111-person-cutout.png']);
  } finally {
    restoreFetch();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ai-group-hero.test.js`
Expected: FAIL — the input name is still `...-person-reference.jpg` (cutout path not wired yet).

- [ ] **Step 3: Add the cutout request, create, and annotate functions**

After `withGroupHeroPersonReference` (ends ~line 2195) add:

```js
async function requestOpenAiPersonCutout(env, apiKey, imageBytes) {
  const formData = new FormData();
  formData.append('model', getOpenAiImageModel(env));
  formData.append('prompt', GROUP_HERO_PERSON_CUTOUT_PROMPT);
  formData.append('size', '1024x1536');
  formData.append('quality', 'medium');
  formData.append('output_format', 'png');
  formData.append('n', '1');
  formData.append('image[]', new Blob([imageBytes], { type: 'image/jpeg' }), 'person-crop.jpg');

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), getOpenAiImageTimeoutMs(env));
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: abortController.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('OpenAI cutout request timed out.');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(getOpenAiErrorMessage(payload, response.status));
  return getOpenAiImageBytes(payload);
}

function withGroupHeroPersonCutout(source, objectKey, face) {
  const faceClusterId = face.clusterId || face.cluster_id || '';
  return {
    ...source,
    personCutoutObjectKey: objectKey,
    personCutoutMimeType: 'image/png',
    personCutoutFilename: `${source.id}-${safeGroupHeroObjectSegment(faceClusterId || 'face')}-person-cutout.png`,
    personReferenceFaceClusterId: faceClusterId,
    personReferenceFaceId: buildGroupHeroFacePublicId(faceClusterId),
    personReferenceCropMode: 'ai-cutout'
  };
}

async function createGroupHeroPersonCutout(env, apiKey, request, eventId, source) {
  if (!apiKey) return null;
  const face = source.personReferenceFace || source.person_reference_face || null;
  if (!face) return null;
  const clusterId = face.clusterId || face.cluster_id || '';
  const objectKey = getGroupHeroPersonCutoutObjectKey(eventId, source.id, clusterId);

  const existing = await env.MOMENTS_BUCKET.get(objectKey);
  if (existing) return withGroupHeroPersonCutout(source, objectKey, face);

  const crop = buildGroupHeroPersonReferenceCrop(face, source);
  if (!crop) return null;
  const sourceUrl = await buildGroupHeroSourceAccessUrl(request, env, source);
  const cropResponse = await fetch(sourceUrl, {
    cf: {
      image: {
        fit: 'cover',
        width: GROUP_HERO_ISOLATED_PERSON_REFERENCE_WIDTH,
        height: GROUP_HERO_PERSON_REFERENCE_HEIGHT,
        gravity: crop.gravity,
        format: 'jpeg',
        quality: AI_REFERENCE_QUALITY
      }
    }
  });
  if (!cropResponse.ok) return null;
  const cropBytes = await cropResponse.arrayBuffer();
  if (!cropBytes || cropBytes.byteLength === 0) return null;

  const cutoutBytes = await requestOpenAiPersonCutout(env, apiKey, new Uint8Array(cropBytes));
  if (!cutoutBytes || !cutoutBytes.byteLength) return null;

  await env.MOMENTS_BUCKET.put(objectKey, cutoutBytes, {
    httpMetadata: {
      contentType: 'image/png',
      contentDisposition: `inline; filename="${source.id}-person-cutout.png"`
    },
    customMetadata: {
      eventId,
      sourceSubmissionId: source.id,
      mediaType: 'group-hero-person-cutout',
      faceClusterId: clusterId
    }
  });
  return withGroupHeroPersonCutout(source, objectKey, face);
}
```

- [ ] **Step 4: Give cutouts priority in `getGroupHeroSourceObject`**

In `getGroupHeroSourceObject` (~line 2005), insert this block as the FIRST check, before the `personReferenceObjectKey` block:

```js
  const personCutoutObjectKey = source.personCutoutObjectKey || source.person_cutout_object_key || '';
  if (personCutoutObjectKey) {
    const personCutoutObject = await env.MOMENTS_BUCKET.get(personCutoutObjectKey);
    if (personCutoutObject) {
      return {
        object: personCutoutObject,
        objectKey: personCutoutObjectKey,
        mimeType: source.personCutoutMimeType || source.person_cutout_mime_type || 'image/png',
        filename: source.personCutoutFilename || source.person_cutout_filename || `${source.id}-person-cutout.png`
      };
    }
  }
```

- [ ] **Step 5: Wire cutout-first into the prepare step (temporary shim)**

In `prepareGroupHeroPersonReferences` (~line 2096), at the top of the `for` loop body, before `const requiresPersonReference = ...`, add a cutout attempt:

```js
    const cutout = await createGroupHeroPersonCutout(env, getOpenAiApiKey(env), request, eventId, source)
      .catch((error) => {
        console.warn('AI group hero cutout failed', eventId, source.id, String(error.message || error));
        return null;
      });
    if (cutout) {
      prepared.push(cutout);
      continue;
    }
```

(Task 4 replaces this whole function with the parallel `prepareGroupHeroPersonInputs`; this shim keeps the suite green in between.)

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/ai-group-hero.test.js`
Expected: the new test PASSES. Some pre-existing person-reference tests may now fail because the cutout path changes their inputs — that is expected and fixed in Tasks 3 and 4. Note which fail; do not fix yet.

- [ ] **Step 7: Commit**

```bash
git add worker/src/index.js worker/tests/ai-group-hero.test.js
git commit -m "Generate and prefer AI person cutouts for group hero inputs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Cache-miss generation + fallback ladder + sole-in-column

**Files:**
- Modify: `worker/src/index.js` (add `isGroupHeroFaceSoleInColumn`; add `prepareGroupHeroPersonInputs`/`prepareGroupHeroPersonInput`)
- Test: `worker/tests/ai-group-hero.test.js`

- [ ] **Step 1: Write the cache-miss test**

```js
test('group hero generates and stores a person cutout on cache miss', async () => {
  const solo = guestSubmission({
    id: 'guest-cutout-miss',
    object_key: 'moments/event-hero/guest-cutout-miss.jpg',
    objectKey: 'moments/event-hero/guest-cutout-miss.jpg',
    guest_name: 'Cutout Miss',
    guestName: 'Cutout Miss',
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
        submission_id: 'guest-cutout-miss',
        submissionId: 'guest-cutout-miss',
        cluster_id: 'face-miss22',
        clusterId: 'face-miss22',
        bounding_box_json: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.16, Height: 0.16 }),
        boundingBoxJson: JSON.stringify({ Left: 0.4, Top: 0.1, Width: 0.16, Height: 0.16 })
      })
    ]
  });
  const bucket = new FakeBucket([[solo.object_key, 'source-cutout-miss']]);
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

    // Two OpenAI calls: [0] cutout, [1] composition.
    assert.equal(calls.length, 2);
    assert.match(calls[0].prompt, /Remove every other person/);
    assert.equal(calls[1].imageNames.length, 1);
    assert.match(calls[1].imageNames[0], /guest-cutout-miss-face-miss22-person-cutout\.png$/);
    const cutoutPut = bucket.puts.find((put) => put.key.includes('/generated/person-cutout/'));
    assert.ok(cutoutPut);
    assert.equal(cutoutPut.metadata.customMetadata.mediaType, 'group-hero-person-cutout');
  } finally {
    restoreFetch();
  }
});
```

- [ ] **Step 2: Write the multi-face drop test**

```js
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
  // Pre-store ONLY the solo cutout; group faces overlap (centers 0.36 vs 0.46) so neither is
  // sole-in-column, and with no media bytes their cutouts/crops cannot be produced -> dropped.
  const bucket = new FakeBucket([
    [groupPhoto.object_key, 'src-group'],
    [soloPhoto.object_key, 'src-solo'],
    ['moments/event-hero/generated/person-cutout/guest-nocutout-solo-face-solo-v1.png', 'solo-cutout']
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
    assert.deepEqual(calls[0].imageNames, ['guest-nocutout-solo-face-solo-person-cutout.png']);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-nocutout-solo']);
  } finally {
    restoreFetch();
  }
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test tests/ai-group-hero.test.js`
Expected: the drop test FAILS (group faces are not yet dropped; current shim falls through to `prepared.push(source)` and would send raw images). The cache-miss test should already PASS from Task 2.

- [ ] **Step 4: Add `isGroupHeroFaceSoleInColumn`**

Add after `isGroupHeroFaceSoleInColumn`'s neighbour `normalizeGroupHeroFaceBoundingBox` (place it right after `buildGroupHeroPersonReferenceCrop`, ~line 2278):

```js
function isGroupHeroFaceSoleInColumn(face, allFaces) {
  if (!face) return false;
  const target = normalizeGroupHeroFaceBoundingBox(face.boundingBox || face.boundingBoxJson || face.bounding_box_json);
  if (!target) return false;
  const targetCenterX = target.left + (target.width / 2);
  const targetClusterId = face.clusterId || face.cluster_id || '';
  for (const other of Array.isArray(allFaces) ? allFaces : []) {
    const otherClusterId = other.clusterId || other.cluster_id || '';
    if (otherClusterId && otherClusterId === targetClusterId) continue;
    const box = normalizeGroupHeroFaceBoundingBox(other.boundingBox || other.boundingBoxJson || other.bounding_box_json);
    if (!box) continue;
    const otherCenterX = box.left + (box.width / 2);
    if (Math.abs(otherCenterX - targetCenterX) < GROUP_HERO_ISOLATED_COLUMN_HALF_WIDTH + (box.width / 2)) {
      return false;
    }
  }
  return true;
}
```

- [ ] **Step 5: Replace the prepare function with the parallel input builder**

Replace the entire `prepareGroupHeroPersonReferences` function (the version including the Task-2 shim, ~line 2096) with:

```js
async function prepareGroupHeroPersonInputs(env, request, eventId, apiKey, sources) {
  const prepared = await Promise.all((Array.isArray(sources) ? sources : []).map((source) =>
    prepareGroupHeroPersonInput(env, request, eventId, apiKey, source)
  ));
  return prepared.filter(Boolean);
}

async function prepareGroupHeroPersonInput(env, request, eventId, apiKey, source) {
  const cutout = await createGroupHeroPersonCutout(env, apiKey, request, eventId, source)
    .catch((error) => {
      console.warn('AI group hero cutout failed', eventId, source.id, String(error.message || error));
      return null;
    });
  if (cutout) return cutout;

  const faceClusterIds = uniqueCleanList(source.faceClusterIds || source.face_cluster_ids || []);
  const duplicateFaceClusterIds = uniqueCleanList(source.duplicateFaceClusterIds || source.duplicate_face_cluster_ids || []);
  const isMultiFace = faceClusterIds.length > 1 || duplicateFaceClusterIds.length > 0;

  // A multi-face source is only safe without a cutout if the chosen face is alone in its column.
  if (isMultiFace && !isGroupHeroFaceSoleInColumn(source.personReferenceFace, source.faceDetails)) {
    console.warn('Dropped group hero participant without a clean cutout', eventId, source.id, source.rosterParticipantId || '');
    return null;
  }

  const reference = await createGroupHeroPersonReference(env, request, eventId, source)
    .catch((error) => {
      console.warn('AI group hero person reference failed', eventId, source.id, String(error.message || error));
      return null;
    });
  if (reference) return reference;

  // No cutout and no crop: drop multi-face (unsafe), send the raw single-person source otherwise.
  if (isMultiFace) return null;
  return source;
}
```

- [ ] **Step 6: Update the call site in `generateEventGroupHero`**

At ~line 1664, replace:

```js
  const preparedSources = await prepareGroupHeroPersonReferences(env, request, eventId, sources)
    .catch((error) => {
      console.warn('AI group hero person-reference preparation failed', eventId, String(error.message || error));
      return sources;
    });
```

with:

```js
  const preparedSources = await prepareGroupHeroPersonInputs(env, request, eventId, apiKey, sources)
    .catch((error) => {
      console.warn('AI group hero person-input preparation failed', eventId, String(error.message || error));
      return sources;
    });
```

- [ ] **Step 7: Run tests to verify the new ones pass**

Run: `node --test tests/ai-group-hero.test.js`
Expected: the cache-miss and drop tests PASS. Pre-existing person-reference tests may still fail (fixed in Task 4).

- [ ] **Step 8: Commit**

```bash
git add worker/src/index.js worker/tests/ai-group-hero.test.js
git commit -m "Add parallel cutout prep with safe fallback ladder and column isolation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Revert one-per-photo selection and migrate existing tests

**Files:**
- Modify: `worker/src/index.js` (`selectDistinctGroupHeroSources` ~line 2533)
- Test: `worker/tests/ai-group-hero.test.js`

- [ ] **Step 1: Update the multi-face selection back to multi-participant**

In `selectDistinctGroupHeroSources`, replace the single-best-face block (the one with the comment `// Limit each source image to a single roster participant.` and `const primaryFace = participantFaces[0];` … through its `decisions.push(...)` and `continue;`) with the multi-participant version:

```js
      if (guestKey) seenGuestKeys.add(guestKey);
      for (const face of participantFaces) {
        const clusterId = face.clusterId || face.cluster_id || '';
        if (!clusterId || seenFaceClusters.has(clusterId)) continue;
        seenFaceClusters.add(clusterId);
        selected.push({
          ...source,
          rosterParticipantId: `${source.id}:${clusterId}`,
          rosterFaceClusterId: clusterId,
          rosterFaceId: buildGroupHeroFacePublicId(clusterId),
          duplicateFaceClusterIds: duplicateClusterIds,
          personReferenceFace: face
        });
      }

      decisions.push(buildGroupHeroSourceDecision(source, 'selected', 'adds-face-cluster', {
        faceClusterIds,
        newClusterIds: participantFaces.map((face) => face.clusterId || face.cluster_id || '').filter(Boolean),
        duplicateClusterIds,
        guestKey,
        score: participantFaces.length
      }));
      continue;
```

- [ ] **Step 2: Update the `056ce5e` tests to the multi-participant + cutout behavior**

Replace the test `group hero limits one multi-face upload to a single roster participant` with the version below (now expects BOTH faces, each via a pre-stored cutout):

```js
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
```

- [ ] **Step 3: Update the `still renders a group-photo guest` test to cutouts**

In the test `group hero still renders a group-photo guest through their own solo photo`, change the two pre-stored person-roster keys and the expected `imageNames` from `-person-reference.jpg` (person-roster path) to cutouts. Replace its bucket seed lines:

```js
    ['moments/event-hero/generated/person-roster/guest-group-pair-face-p1aaaaa-v5.jpg', 'person-p1-reference'],
    ['moments/event-hero/generated/person-roster/guest-p2-solo-face-p2bbbbb-v5.jpg', 'person-p2-reference']
```

with:

```js
    ['moments/event-hero/generated/person-cutout/guest-group-pair-face-p1aaaaa-v1.png', 'cutout-p1'],
    ['moments/event-hero/generated/person-cutout/guest-p2-solo-face-p2bbbbb-v1.png', 'cutout-p2']
```

and replace its `imageNames` assertion with:

```js
    assert.deepEqual(calls[0].imageNames, [
      'guest-group-pair-face-p1aaaaa-person-cutout.png',
      'guest-p2-solo-face-p2bbbbb-person-cutout.png'
    ]);
```

- [ ] **Step 4: Update the body-aware and isolation tests to cutouts**

In `group hero sends body-aware person references for unique face clusters`: add a pre-stored cutout so the cutout path is a cache hit, and assert the cutout filename. Add to its `FakeBucket` seed:

```js
    ['moments/event-hero/generated/person-cutout/guest-full-body-cluster-full-body-v1.png', 'cutout-full-body']
```

and replace its `imageNames` assertion:

```js
    assert.deepEqual(calls[0].imageNames, ['guest-full-body-cluster-full-body-person-cutout.png']);
```

Leave its prompt assertions intact (they test the composition prompt, not the reference).

In `group hero isolates new participants from source images that also contain duplicate faces`: pre-store the cutout for the new face and assert it is used. Add to its bucket seed:

```js
    ['moments/event-hero/generated/person-cutout/guest-group-with-duplicate-face-new6096-v1.png', 'cutout-new6096']
```

Replace its trailing assertions block (`const groupReference = ...` through `outputWidth` check) with:

```js
    assert.equal(calls[0].imageCount, 2);
    assert.match(calls[0].prompt, /Face ID F-new609/);
    assert.ok(calls[0].imageNames.includes('guest-group-with-duplicate-face-new6096-person-cutout.png'));
```

- [ ] **Step 5: Run the full file**

Run: `node --test tests/ai-group-hero.test.js`
Expected: ALL tests PASS. If `group hero skips multi-person roster entries when isolated references are unavailable` fails, confirm its expectation is now "group dropped, solo kept" (imageCount 1, only the solo source); it should still pass because the group faces overlap and no cutout/crop is available, so they are dropped — same outcome, now via the cutout fallback ladder.

- [ ] **Step 6: Run check and commit**

Run: `node --check src/index.js`

```bash
git add worker/src/index.js worker/tests/ai-group-hero.test.js
git commit -m "Allow every distinct face per photo now that cutouts isolate people

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Phase 1 full validation

- [ ] **Step 1: Full suite + check**

Run: `npm run check` then `npm test`
Expected: `node --check` clean; all tests pass (count ≥ previous + new tests).

- [ ] **Step 2: Deploy (requires explicit approval at execution time)**

Deploy uses cached wrangler OAuth (the `.env` `CLOUDFLARE_API` token is stale — do NOT set `CLOUDFLARE_API_TOKEN`):

Run from `worker/`: `npm run deploy`
Expected: "Deployed williamson-wallflowers-inquiry" with a new Version ID.

- [ ] **Step 3: Re-audit (manual)**

Host-regenerate Ferguson + Levi, wait ~2 min, then pull `event_group_heroes.object_key` and the generated PNG from R2 (see the 2026-06-07 audit method). Confirm the previously-dropped people now appear. Duplicates (Levi) are addressed in Phase 2.

---

# PHASE 2 — Dedupe on cutouts

## Task 6: CompareFaces merge pass

**Files:**
- Modify: `worker/src/index.js` (add `getGroupHeroDupMergeThreshold`, `awsRekognitionCompareFaces`, `getGroupHeroDedupeImageBytes`, `mergeDuplicateGroupHeroParticipants`; call it in `generateEventGroupHero`)
- Test: `worker/tests/ai-group-hero.test.js`

- [ ] **Step 1: Write the merge test (and a no-merge control)**

```js
test('group hero merges two clusters that CompareFaces says are the same person', async () => {
  const photoA = guestSubmission({
    id: 'guest-dupe-a', object_key: 'moments/event-hero/guest-dupe-a.jpg', objectKey: 'moments/event-hero/guest-dupe-a.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z', createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z', aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const photoB = guestSubmission({
    id: 'guest-dupe-b', object_key: 'moments/event-hero/guest-dupe-b.jpg', objectKey: 'moments/event-hero/guest-dupe-b.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z', createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z', aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
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
  const bucket = new FakeBucket([
    [photoA.object_key, 'src-a'], [photoB.object_key, 'src-b'],
    ['moments/event-hero/generated/person-cutout/guest-dupe-a-face-dupA-v1.png', 'cutout-a'],
    ['moments/event-hero/generated/person-cutout/guest-dupe-b-face-dupB-v1.png', 'cutout-b']
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

    assert.equal(calls.openAi.length, 1);
    assert.equal(calls.openAi[0].imageCount, 1); // duplicate merged out
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-dupe-a']);
  } finally {
    restoreFetch();
  }
});

test('group hero keeps both participants when CompareFaces is below the merge threshold', async () => {
  const photoA = guestSubmission({
    id: 'guest-keep-a', object_key: 'moments/event-hero/guest-keep-a.jpg', objectKey: 'moments/event-hero/guest-keep-a.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:05:00.000Z', createdAt: '2026-09-19T20:05:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:05:00.000Z', aiArtworkConsentAt: '2026-09-19T20:05:00.000Z'
  });
  const photoB = guestSubmission({
    id: 'guest-keep-b', object_key: 'moments/event-hero/guest-keep-b.jpg', objectKey: 'moments/event-hero/guest-keep-b.jpg',
    guest_name: '', guestName: '', status: 'approved',
    created_at: '2026-09-19T20:06:00.000Z', createdAt: '2026-09-19T20:06:00.000Z',
    ai_artwork_consent_at: '2026-09-19T20:06:00.000Z', aiArtworkConsentAt: '2026-09-19T20:06:00.000Z'
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
  const bucket = new FakeBucket([
    [photoA.object_key, 'src-a'], [photoB.object_key, 'src-b'],
    ['moments/event-hero/generated/person-cutout/guest-keep-a-face-keepA-v1.png', 'cutout-a'],
    ['moments/event-hero/generated/person-cutout/guest-keep-b-face-keepB-v1.png', 'cutout-b']
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

    assert.equal(calls.openAi[0].imageCount, 2);
    assert.deepEqual(JSON.parse(db.groupHeroes[0].source_submission_ids), ['guest-keep-a', 'guest-keep-b']);
  } finally {
    restoreFetch();
  }
});
```

- [ ] **Step 2: Add the `mockOpenAiWithCompareFaces` test helper**

Add near `mockOpenAiAndAwsRekognition` in the test file:

```js
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
```

Note: `callAwsRekognition` builds `headers` as a plain object with lowercase `x-amz-target`, so the helper reads `init.headers['x-amz-target']`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/ai-group-hero.test.js`
Expected: both new tests FAIL (merge not implemented — both photos are still sent).

- [ ] **Step 4: Add the CompareFaces helper, threshold getter, and merge pass**

Add after `searchAwsRekognitionFaces` (~line 3153):

```js
async function awsRekognitionCompareFaces(env, sourceBytes, targetBytes) {
  const payload = await callAwsRekognition(env, 'RekognitionService.CompareFaces', {
    SourceImage: { Bytes: base64EncodeBytes(new Uint8Array(sourceBytes)) },
    TargetImage: { Bytes: base64EncodeBytes(new Uint8Array(targetBytes)) },
    SimilarityThreshold: getGroupHeroDupMergeThreshold(env),
    QualityFilter: 'AUTO'
  });
  const matches = Array.isArray(payload.FaceMatches) ? payload.FaceMatches : [];
  let best = 0;
  for (const match of matches) {
    const similarity = Number(match?.Similarity || 0);
    if (similarity > best) best = similarity;
  }
  return best;
}
```

Add next to `getGroupHeroFaceMatchThreshold` (~line 3078):

```js
function getGroupHeroDupMergeThreshold(env) {
  const value = Number(env.GROUP_HERO_DUP_MERGE_THRESHOLD || GROUP_HERO_DUP_MERGE_THRESHOLD);
  return Number.isFinite(value) ? Math.max(85, Math.min(value, 99.9)) : GROUP_HERO_DUP_MERGE_THRESHOLD;
}
```

Add the merge pass after `prepareGroupHeroPersonInput` (Task 3 location):

```js
async function getGroupHeroDedupeImageBytes(env, source) {
  try {
    const sourceObject = await getGroupHeroSourceObject(env, source);
    return await r2ObjectToArrayBuffer(sourceObject.object);
  } catch (error) {
    console.warn('Group hero dedupe image unavailable', source.id, String(error.message || error));
    return null;
  }
}

async function mergeDuplicateGroupHeroParticipants(env, sources) {
  if (!Array.isArray(sources) || sources.length < 2) return sources;
  if (!hasGroupHeroFaceProviderConfig(env) || getGroupHeroFaceProvider(env) !== 'aws-rekognition') return sources;

  const threshold = getGroupHeroDupMergeThreshold(env);
  const kept = [];
  for (const candidate of sources) {
    const candidateBytes = await getGroupHeroDedupeImageBytes(env, candidate);
    if (!candidateBytes) { kept.push({ source: candidate, bytes: null }); continue; }
    let duplicateOf = null;
    for (const existing of kept) {
      if (!existing.bytes) continue;
      const similarity = await awsRekognitionCompareFaces(env, candidateBytes, existing.bytes).catch(() => 0);
      if (similarity >= threshold) { duplicateOf = existing.source; break; }
    }
    if (duplicateOf) {
      console.warn('Merged duplicate group hero participant', candidate.id, '->', duplicateOf.id);
      continue;
    }
    kept.push({ source: candidate, bytes: candidateBytes });
  }
  return kept.map((entry) => entry.source);
}
```

- [ ] **Step 5: Call the merge pass in `generateEventGroupHero`**

Immediately after the `preparedSources` assignment / `addGroupHeroAttemptTiming(generationContext, 'faceReferenceMs', ...)` line (~line 1669), add:

```js
  const dedupedSources = await mergeDuplicateGroupHeroParticipants(env, preparedSources)
    .catch((error) => {
      console.warn('AI group hero duplicate merge failed', eventId, String(error.message || error));
      return preparedSources;
    });
  let activeSources = dedupedSources;
```

and DELETE the now-duplicate `let activeSources = preparedSources;` line that follows. (The existing `if (!sourceIdsMatch(currentSourceIds, activeSourceIds))` block right below will persist the reduced participant list and count.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/ai-group-hero.test.js`
Expected: both new tests PASS; all others still PASS.

- [ ] **Step 7: Check and commit**

Run: `node --check src/index.js`

```bash
git add worker/src/index.js worker/tests/ai-group-hero.test.js
git commit -m "Merge same-person duplicates via CompareFaces over cutouts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Phase 2 full validation and rollout

- [ ] **Step 1: Full suite + check**

Run: `npm run check` then `npm test`
Expected: clean check, all tests pass.

- [ ] **Step 2: Deploy (explicit approval at execution time)**

From `worker/`: `npm run deploy` (cached wrangler OAuth; do not set `CLOUDFLARE_API_TOKEN`).

- [ ] **Step 3: Re-audit Levi + Ferguson (manual)**

Host-regenerate both, wait ~2 min, pull the generated PNG and the per-participant cutouts from R2. Confirm: (a) previously-dropped people now appear (Phase 1), (b) Levi appears exactly once (Phase 2). Compare `participant_count` and `source_submission_ids` before/after.

---

## Self-Review (completed during planning)

- **Spec coverage:** Phase 1 cutouts (Tasks 2-3), revert one-per-photo (Task 4), fallback ladder + sole-in-column (Task 3), cutout R2 priority (Task 2), Phase 2 dedupe (Task 6), testing (every task), rollout/deploy/audit (Tasks 5, 7). Cost is inherent to the cutout calls (cached). All spec sections map to a task.
- **Placeholder scan:** none — every code step has full code; every run step has the command and expected result.
- **Type/name consistency:** `personCutoutObjectKey` / `personCutoutMimeType` / `personCutoutFilename` set in `withGroupHeroPersonCutout` and read in `getGroupHeroSourceObject`. `prepareGroupHeroPersonInputs(env, request, eventId, apiKey, sources)` signature matches its call site. `getGroupHeroPersonCutoutObjectKey` key format matches every pre-stored test key (`.../person-cutout/<sub>-<cluster>-v1.png`). `mockOpenAiWithCompareFaces` returns `{ openAi, compareFaces }`; Phase 2 tests read `calls.openAi`.
