import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseEnvFile, replaceEnvValue } from '../scripts/start-bridge.mjs';

const SAMPLE = [
  '# Wallflower lighting bridge config',
  'WALLFLOWER_API_BASE=https://example.test/moments-api',
  'WALL_DEVICE_ID=device-1',
  'BRIDGE_TOKEN=secret',
  '# Set this to the WLED controller address on the local network.',
  'WLED_BASE_URL=http://10.0.0.76',
  'WLED_IDLE_PRESET_ID=1'
].join('\n');

test('parseEnvFile reads values and skips comments and blanks', () => {
  assert.deepEqual(parseEnvFile(SAMPLE), {
    WALLFLOWER_API_BASE: 'https://example.test/moments-api',
    WALL_DEVICE_ID: 'device-1',
    BRIDGE_TOKEN: 'secret',
    WLED_BASE_URL: 'http://10.0.0.76',
    WLED_IDLE_PRESET_ID: '1'
  });
});

test('replaceEnvValue rewrites an existing key in place', () => {
  const next = replaceEnvValue(SAMPLE, 'WLED_BASE_URL', 'http://192.168.12.50');
  assert.match(next, /WLED_BASE_URL=http:\/\/192\.168\.12\.50/);
  assert.doesNotMatch(next, /WLED_BASE_URL=http:\/\/10\.0\.0\.76/);
  assert.equal(parseEnvFile(next).BRIDGE_TOKEN, 'secret');
});

test('replaceEnvValue appends the key when missing', () => {
  const next = replaceEnvValue('A=1', 'WLED_BASE_URL', 'http://192.168.12.50');
  assert.equal(parseEnvFile(next).WLED_BASE_URL, 'http://192.168.12.50');
});
