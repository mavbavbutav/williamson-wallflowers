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
});

test('computeChoreography at progress 1 returns the fully-bloomed keyframe', () => {
  const result = computeChoreography(1);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 22.0, 'cameraDistance');
  closeTo(result.cameraOffsetX, 10.2, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 4.0, 'cameraOffsetY');
  closeTo(result.blur, 0.72, 'blur');
  closeTo(result.saturation, 0.65, 'saturation');
});

test('computeChoreography finishes most of the bloom before the card grid (0.15)', () => {
  const result = computeChoreography(0.035);
  closeTo(result.bloom, 0.45, 'bloom');
  closeTo(result.cameraDistance, 9.75, 'cameraDistance');
  closeTo(result.cameraOffsetX, 0.5, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 0.25, 'cameraOffsetY');
  closeTo(result.blur, 0.05, 'blur');
  closeTo(result.saturation, 0.975, 'saturation');
});

test('computeChoreography interpolates linearly between keyframes', () => {
  const result = computeChoreography(0.39);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 19.5, 'cameraDistance');
  closeTo(result.cameraOffsetX, 9.65, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 3.7, 'cameraOffsetY');
  closeTo(result.blur, 0.575, 'blur');
  closeTo(result.saturation, 0.775, 'saturation');
});

test('computeChoreography clamps progress below 0 and above 1', () => {
  const below = computeChoreography(-0.4);
  const zero = computeChoreography(0);
  closeTo(below.bloom, zero.bloom, 'clamped-low bloom');
  closeTo(below.cameraDistance, zero.cameraDistance, 'clamped-low cameraDistance');

  const above = computeChoreography(1.9);
  const one = computeChoreography(1);
  closeTo(above.bloom, one.bloom, 'clamped-high bloom');
  closeTo(above.cameraDistance, one.cameraDistance, 'clamped-high cameraDistance');
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
