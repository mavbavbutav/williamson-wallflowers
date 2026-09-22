import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeChoreography,
  shouldEnableFlowerScene,
  getQualityProfile
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

test('computeChoreography finishes most of the bloom before the card grid (0.168)', () => {
  const result = computeChoreography(0.035);
  closeTo(result.bloom, 0.45, 'bloom');
  closeTo(result.cameraDistance, 9.75, 'cameraDistance');
  closeTo(result.cameraOffsetX, 0.5, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 0.25, 'cameraOffsetY');
  closeTo(result.blur, 0.05, 'blur');
  closeTo(result.saturation, 0.975, 'saturation');
  closeTo(result.opacity, 1.0, 'opacity');
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
