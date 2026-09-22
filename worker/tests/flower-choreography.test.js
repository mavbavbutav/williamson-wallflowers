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
  closeTo(result.cameraDistance, 16.5, 'cameraDistance');
  closeTo(result.cameraOffsetX, 4.5, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 2.0, 'cameraOffsetY');
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

test('computeChoreography fades to a genuinely faint ambient opacity crossing the card grid', () => {
  const result = computeChoreography(0.185);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 13.5, 'cameraDistance');
  closeTo(result.cameraOffsetX, 3.0, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 1.4, 'cameraOffsetY');
  closeTo(result.blur, 0.2, 'blur');
  closeTo(result.saturation, 0.875, 'saturation');
  closeTo(result.opacity, 0.505, 'opacity');
});

test('computeChoreography interpolates linearly between keyframes', () => {
  const result = computeChoreography(0.435);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 15.0, 'cameraDistance');
  closeTo(result.cameraOffsetX, 3.75, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 1.7, 'cameraOffsetY');
  closeTo(result.blur, 0.21, 'blur');
  closeTo(result.saturation, 0.825, 'saturation');
  closeTo(result.opacity, 0.15, 'opacity');
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
