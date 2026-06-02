import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWledPayload } from '../scripts/wallflower-bridge.mjs';

test('buildWledPayload sends WLED on, brightness, and preset state', () => {
  assert.deepEqual(buildWledPayload({ presetId: 3, brightness: 180 }), {
    on: true,
    bri: 180,
    ps: 3
  });
});
