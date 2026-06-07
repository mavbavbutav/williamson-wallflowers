# AI Group Hero — Person Cutouts & Cutout-Based Dedupe

Date: 2026-06-07
Project: `williamson-wallflowers/worker`
Status: Approved design, pending implementation plan

## Problem

The AI group hero composites multiple guest photos/videos into one cartoon scene. Two
defects remain after the 2026-06-07 "one participant per source photo" fix
(commit `056ce5e`):

1. **Real people get left off.** The current rule keeps only the single best face per
   source photo. Anyone who appears *only* in a group shot (never as the primary face of
   another photo) is dropped. Audit of production:
   - Ferguson Family Lake House (`9bb324a4…`): 10 distinct face clusters, 6 rendered +
     2 no-face stills → **4 people dropped**, plus 1 submission stuck in
     `face-analysis-unavailable`.
   - Levi's 3rd Birthday (`f57a929c…`): 12 distinct clusters → **2 people dropped**
     (the two extra kids in one 3-person photo `b7c61e2d`).

2. **A person rendered twice (Levi).** The birthday boy was split into two face clusters
   (`84d0a90e…` and `1f69f4ea…`) because the inputs are video-message thumbnails (low
   light, motion blur, a moving toddler). Dedupe is cluster-based, so it treated him as
   two people. The current fix only prevents sending the *same photo* twice; it does
   nothing about the *same person across different photos*.

### Root causes

- **Rectangular crops can't isolate one person from a group shot.** Cloudflare
  `fit: cover` + gravity keeps the full image height and only trims width, so neighbors
  stay in frame. This forced the conservative one-per-photo rule (cause of #1).
- **Face clustering under-merges on low-quality video thumbnails** (cause of #2).
- **Guest name ≠ who is in frame.** "Jami" uploaded one clip of herself and one of her
  baby, so a name maps to two different people. Names cannot be used to merge/dedupe.

## Goals

- Include every *distinct* person, including people who only appear in group photos.
- Eliminate the same-person-rendered-twice duplicate as reliably as possible.
- Never regress below today's behavior on failure (degrade gracefully).
- Keep cost bounded and cached.

## Non-goals

- A host-facing face-review/merge UI (declined for now).
- Perfect identity resolution. Phase 2 is high-confidence, not perfect.
- Changing the final composition prompt/style or the candidate-selection SQL.

## Key insight that drives the design

The AI isolation pass produces a **clean, frontal, single-person portrait**. That same
clean image is both (a) the bystander-free reference we need for #1 and (b) a far more
matchable image than the raw thumbnails that caused #2. So cutouts are the foundation for
both fixes, and dedupe runs *on the cutouts*, not the raw frames.

## Approach (two phases)

### Phase 1 — Person cutouts + un-limit per-photo (fixes "people left off")

1. **Revert the one-per-photo limit** in `selectDistinctGroupHeroSources`. A source photo
   may again contribute every *new* face cluster it introduces (subject to the existing
   cross-image `seenFaceClusters` dedupe and the `GROUP_HERO_MAX_INPUTS` cap of 16). This
   restores the pre-`056ce5e` multi-participant selection.

2. **Add an AI isolation (cutout) step.** New constant
   `GROUP_HERO_PERSON_CUTOUT_VERSION = 1` and key
   `moments/<eventId>/generated/person-cutout/<submissionId>-<clusterId>-v<version>.jpg`.

   New function `createGroupHeroPersonCutout(env, apiKey, request, eventId, source)`:
   - If the cutout object already exists in R2 → return source annotated with the cutout
     reference (no API call). **This is the cache; only first-seen faces cost anything.**
   - Else: build the tight face-centered crop (reuse `buildGroupHeroPersonReferenceCrop`
     forced to the isolated 256-wide mode) so the model knows *which* person to keep, then
     call OpenAI `/v1/images/edits` with that crop and an isolation prompt:
     > "Output only the person at the center of this image as a clean, realistic portrait
     > on a plain neutral background. Remove all other people and background clutter.
     > Preserve their exact likeness, age, skin tone, hairstyle, facial hair, glasses, and
     > clothing. Do not add text."
   - Store the returned bytes in R2 at the cutout key with descriptive `customMetadata`.
     Return source annotated with `personCutoutObjectKey`, mime, and a deterministic
     filename.

3. **Wire cutouts into the input pipeline.** Rename/extend `prepareGroupHeroPersonReferences`
   → `prepareGroupHeroPersonInputs`:
   - Run cutout passes **in parallel** (replace the sequential `for…of`), bounded by the
     existing 16-input cap, so latency stays roughly flat regardless of count.
   - **Fallback ladder per face when the cutout fails / returns empty:**
     - Single-face source → fall back to the existing person-reference crop, then ai/raw
       (always safe — only one person present).
     - Multi-face source → use the geometric isolated crop **only if the face is "sole in
       its column"** (no other detected face overlaps the isolated crop band; computed
       from normalized boxes — heuristic #2, the "smarter selection" fallback). Otherwise
       **drop** that face. Worst case therefore equals today's behavior, never worse.

4. **`getGroupHeroSourceObject` priority** becomes: person-cutout → person-reference →
   ai-reference → original.

### Phase 2 — Dedupe on the cutouts (fixes the cross-photo duplicate)

After Phase 1 cutouts exist for the selected participants, run a **conservative
same-person merge** before the final composition:

- New constant `GROUP_HERO_DUP_MERGE_THRESHOLD ≈ 93` (similarity %, deliberately high to
  avoid merging genuine look-alikes such as toddlers).
- Greedy union (like clustering): keep a list of confirmed participants; for each new
  candidate, compare its cutout against each kept participant's cutout via AWS Rekognition
  **`CompareFaces`**. If similarity ≥ threshold → treat as the same person, keep the
  higher-scored participant, drop the other. This is O(N·K), ≤ ~120 comparisons for the
  16-input cap.
- Gated behind the existing face-provider config (only runs when AWS Rekognition is
  configured), consistent with `ensureGroupHeroFaceAnalyses`.
- Honest limitation: high-confidence, not perfect. Matching clean portraits is far more
  reliable than the raw thumbnails, which is why this is done post-cutout.

## Components & interfaces

- `selectDistinctGroupHeroSources(sources)` — revert to multi-participant-per-photo.
- `createGroupHeroPersonCutout(env, apiKey, request, eventId, source)` → annotated source
  or `null`. Owns the cache check, crop, OpenAI call, and R2 write.
- `prepareGroupHeroPersonInputs(env, request, eventId, apiKey, sources)` → prepared sources;
  parallel cutout + fallback ladder + drop logic.
- `isGroupHeroFaceSoleInColumn(face, allFacesInSource)` → bool; the geometric fallback test.
- `mergeDuplicateGroupHeroParticipants(env, sources)` → deduped sources (Phase 2).
- `awsRekognitionCompareFaces(env, sourceBytes, targetBytes)` → similarity number.
- `getGroupHeroSourceObject(env, source)` — add cutout to the priority ladder.

## Error handling

- Every external call (OpenAI cutout, R2, CompareFaces) is wrapped; failure degrades:
  cutout fail → fallback ladder; CompareFaces fail → no merge for that pair. Generation
  never breaks. Existing supersede/stale/retry machinery is untouched.

## Testing (TDD, `tests/ai-group-hero.test.js`)

Mock the OpenAI isolation edit and AWS `CompareFaces` the same way existing tests mock
`/v1/images/edits` and Rekognition.

1. A 2-face photo yields **2 cutout inputs** (revert of one-per-photo) when cutouts succeed.
2. A cutout cached in R2 → **no OpenAI call** for that face (cache hit).
3. Cutout failure on a multi-face face whose face is **not** sole-in-column → that face is
   **dropped**; a single-face cutout failure → falls back to crop/raw.
4. Two near-identical cutouts (CompareFaces ≥ threshold) → **merged to one** participant;
   below threshold → both kept.
5. Regression: existing tests for guest-name dedupe, cluster dedupe, video thumbnails,
   supersede/stale retries still pass. Update the prior `056ce5e` tests
   (`limits one multi-face upload…`, `still renders a group-photo guest…`) to the new
   multi-participant behavior.

Then `npm run check`, full `npm test`, deploy, and re-audit Ferguson + Levi by pulling the
generated image and per-participant crops from R2 (same method used in the 2026-06-07 audit).

## Rollout

- Bump `GROUP_HERO_PERSON_CUTOUT_VERSION` (and reuse/raise other version constants as
  needed) so caches invalidate cleanly.
- Ship **Phase 1**, regenerate + audit both events, confirm dropped people return and no
  new duplicates. Then ship **Phase 2**, regenerate + audit, confirm Levi collapses to one.

## Cost

First-time generation of an event makes up to ~16 extra OpenAI image-edit calls (one per
new face), cached thereafter; ~a few cents per face → roughly $0.30–0.60 for a fresh
12–16-person event, ~free on regeneration. Phase 2 adds ≤ ~120 AWS `CompareFaces` calls on
first generation. Accepted by the product owner.
