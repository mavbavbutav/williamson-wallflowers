import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeChoreography,
  shouldEnableFlowerScene,
  getQualityProfile,
  buildScrollMap,
  mapScrollToStory,
  STORY_ANCHORS
} from '../../assets/js/flower-choreography.js';

function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`
  );
}

test('computeChoreography at progress 0 returns the closed-bud keyframe', () => {
  const result = computeChoreography(0);
  closeTo(result.bloom, 0.0, 'bloom');
  closeTo(result.cameraDistance, 9.0, 'cameraDistance');
  closeTo(result.cameraOffsetX, 0, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 0, 'cameraOffsetY');
  closeTo(result.blur, 0, 'blur');
  closeTo(result.saturation, 1.0, 'saturation');
  closeTo(result.opacity, 1.0, 'opacity');
});

test('computeChoreography at progress 1 returns the settled ambient keyframe', () => {
  const result = computeChoreography(1);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 15.5, 'cameraDistance');
  closeTo(result.cameraOffsetX, 4.5, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 5.6, 'cameraOffsetY');
  closeTo(result.blur, 0.25, 'blur');
  closeTo(result.saturation, 0.7, 'saturation');
  closeTo(result.opacity, 0.12, 'opacity');
});

test('computeChoreography opens the bloom steadily across the hero', () => {
  // The bloom is spread evenly over story 0-0.15 (which the scroll map
  // anchors to the whole hero) rather than being 90% done by story 0.07.
  const early = computeChoreography(0.035);
  closeTo(early.bloom, 0.21, 'bloom');
  closeTo(early.cameraDistance, 9.56, 'cameraDistance');
  closeTo(early.cameraOffsetX, 0.42, 'cameraOffsetX');
  closeTo(early.cameraOffsetY, 0.224, 'cameraOffsetY');
  closeTo(early.blur, 0.035, 'blur');
  closeTo(early.opacity, 1.0, 'opacity');

  const mid = computeChoreography(0.075);
  closeTo(mid.bloom, 0.49, 'midpoint bloom');
  assert.ok(mid.bloom > early.bloom, 'bloom keeps opening through the hero');

  closeTo(computeChoreography(0.15).bloom, 1.0, 'fully open at the end of the hero');
});

test('computeChoreography fades to a faint ambient opacity crossing the card grid', () => {
  const result = computeChoreography(0.36);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 13.75, 'cameraDistance');
  closeTo(result.cameraOffsetX, 3.15, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 2.2, 'cameraOffsetY');
  closeTo(result.blur, 0.17, 'blur');
  closeTo(result.saturation, 0.865, 'saturation');
  closeTo(result.opacity, 0.245, 'opacity');
});

test('computeChoreography peeks back up in the gap before details (0.5) then dips again', () => {
  const gap = computeChoreography(0.5);
  closeTo(gap.opacity, 0.34, 'gap opacity');
  const dense = computeChoreography(0.6);
  closeTo(dense.opacity, 0.14, 'dense opacity');
  const midDip = computeChoreography(0.55);
  closeTo(midDip.cameraDistance, 13.9, 'cameraDistance');
  closeTo(midDip.cameraOffsetX, 3.3, 'cameraOffsetX');
  closeTo(midDip.cameraOffsetY, 2.9, 'cameraOffsetY');
  closeTo(midDip.blur, 0.17, 'blur');
  closeTo(midDip.saturation, 0.865, 'saturation');
  closeTo(midDip.opacity, 0.24, 'opacity');
});

test('computeChoreography keeps descending (cameraOffsetY) all the way to the end', () => {
  const early = computeChoreography(0.22);
  const mid = computeChoreography(0.69);
  const late = computeChoreography(1.0);
  assert.ok(mid.cameraOffsetY > early.cameraOffsetY, 'mid should have descended further than early');
  assert.ok(late.cameraOffsetY > mid.cameraOffsetY, 'late should have descended further than mid');
});

test('computeChoreography interpolates linearly between the final two keyframes', () => {
  const result = computeChoreography(0.97);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 14.45, 'cameraDistance');
  closeTo(result.cameraOffsetX, 4.0, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 5.3, 'cameraOffsetY');
  closeTo(result.blur, 0.2, 'blur');
  closeTo(result.saturation, 0.775, 'saturation');
  closeTo(result.opacity, 0.21, 'opacity');
});

test('computeChoreography clamps progress below 0 and above 1', () => {
  const below = computeChoreography(-0.4);
  const zero = computeChoreography(0);
  closeTo(below.bloom, zero.bloom, 'clamped-low bloom');
  closeTo(below.cameraDistance, zero.cameraDistance, 'clamped-low cameraDistance');
  closeTo(below.opacity, zero.opacity, 'clamped-low opacity');

  const above = computeChoreography(1.9);
  const one = computeChoreography(1);
  closeTo(above.bloom, one.bloom, 'clamped-high bloom');
  closeTo(above.cameraDistance, one.cameraDistance, 'clamped-high cameraDistance');
  closeTo(above.opacity, one.opacity, 'clamped-high opacity');
});

test('shouldEnableFlowerScene is true only when every gate clears', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: false, hasWebGL: true, saveData: false }),
    true
  );
});

test('shouldEnableFlowerScene is false when reduced motion is preferred', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: true, hasWebGL: true, saveData: false }),
    false
  );
});

test('shouldEnableFlowerScene is false when WebGL is unavailable', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: false, hasWebGL: false, saveData: false }),
    false
  );
});

test('shouldEnableFlowerScene is false when save-data is on', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: false, hasWebGL: true, saveData: true }),
    false
  );
});

test('getQualityProfile returns the mobile profile', () => {
  assert.deepEqual(getQualityProfile(true), {
    petalCount: 6,
    allowDolly: false,
    pixelRatioCap: 1.5
  });
});

test('getQualityProfile returns the desktop profile', () => {
  assert.deepEqual(getQualityProfile(false), {
    petalCount: 10,
    allowDolly: true,
    pixelRatioCap: 2
  });
});

test('buildScrollMap anchors story milestones to measured page positions', () => {
  const map = buildScrollMap({
    bloomEnd: 0.168,
    cardsDeep: 0.215,
    gapDetails: 0.5,
    detailsDeep: 0.62,
    gapBooking: 0.69,
    bookingDeep: 0.85,
    gapContact: 0.94
  });

  assert.equal(map.length, STORY_ANCHORS.length);
  assert.deepEqual(map[0], { real: 0, story: 0 });
  assert.deepEqual(map[map.length - 1], { real: 1, story: 1 });
  closeTo(map[1].real, 0.168, 'bloomEnd real');
  closeTo(map[1].story, 0.15, 'bloomEnd story');
});

test('buildScrollMap falls back to the default fraction for missing anchors', () => {
  const map = buildScrollMap({ bloomEnd: 0.1 });
  closeTo(map[1].real, 0.1, 'measured anchor is used');
  // cardsDeep was not measured, so it falls back to its own story fraction
  closeTo(map[2].real, 0.22, 'unmeasured anchor falls back');
});

test('buildScrollMap keeps anchors strictly increasing even if measured out of order', () => {
  const map = buildScrollMap({ bloomEnd: 0.6, cardsDeep: 0.2, gapDetails: 0.1 });
  for (let i = 1; i < map.length; i++) {
    assert.ok(
      map[i].real > map[i - 1].real,
      `anchor ${i} (${map[i].real}) should exceed ${map[i - 1].real}`
    );
  }
});

test('mapScrollToStory stretches the bloom across the measured hero', () => {
  // Hero ends at 30% of the page, so story 0.15 (bloom complete) should
  // land at real 0.30 rather than at the hardcoded 0.15.
  const map = buildScrollMap({ bloomEnd: 0.3 });
  closeTo(mapScrollToStory(0.3, map), 0.15, 'hero end maps to bloom end');
  closeTo(mapScrollToStory(0.15, map), 0.075, 'halfway through the hero is halfway through the bloom');
  closeTo(mapScrollToStory(0, map), 0, 'page top');
});

test('mapScrollToStory clamps outside the page range', () => {
  const map = buildScrollMap({ bloomEnd: 0.2 });
  closeTo(mapScrollToStory(-0.5, map), 0, 'below range');
  closeTo(mapScrollToStory(1.5, map), 1, 'above range');
});

test('mapScrollToStory is identity-ish without a usable map', () => {
  closeTo(mapScrollToStory(0.42, null), 0.42, 'null map');
  closeTo(mapScrollToStory(0.42, []), 0.42, 'empty map');
});
