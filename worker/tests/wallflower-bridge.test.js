import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWledPayload } from '../scripts/wallflower-bridge.mjs';

test('buildWledPayload plays the preset as a burst playlist that returns to idle', () => {
  assert.deepEqual(buildWledPayload({ presetId: 12, brightness: 180, triggerType: 'submission_received' }), {
    on: true,
    bri: 180,
    playlist: {
      ps: [12],
      dur: [80],
      transition: 7,
      repeat: 1,
      end: 1
    }
  });
});

test('buildWledPayload uses a longer burst for manual tests and a custom idle preset', () => {
  assert.deepEqual(buildWledPayload({ presetId: 13, brightness: 255, triggerType: 'manual_test' }, { idlePresetId: 5 }), {
    on: true,
    bri: 255,
    playlist: {
      ps: [13],
      dur: [150],
      transition: 7,
      repeat: 1,
      end: 5
    }
  });
});

test('buildWledPayload falls back to a plain preset apply when idle preset is disabled', () => {
  assert.deepEqual(buildWledPayload({ presetId: 3, brightness: 180 }, { idlePresetId: 0 }), {
    on: true,
    bri: 180,
    ps: 3
  });
});
