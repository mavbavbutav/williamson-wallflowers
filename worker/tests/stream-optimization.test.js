import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Stream optimization schema stores playback and processing state', async () => {
  const migration = await readText('../../worker/migrations/0008_wallflower_stream_optimization.sql');

  assert.match(migration, /stream_uid TEXT/);
  assert.match(migration, /stream_status TEXT/);
  assert.match(migration, /stream_error TEXT/);
  assert.match(migration, /stream_ready_at TEXT/);
  assert.match(migration, /idx_submissions_stream_uid/);
  assert.match(migration, /idx_submissions_stream_status/);
});

test('Worker queues approved videos for Cloudflare Stream and returns signed playback fields', async () => {
  const workerSource = await readText('../../worker/src/index.js');

  assert.match(workerSource, /const STREAM_TOKEN_TTL_SECONDS = 6 \* 60 \* 60/);
  assert.match(workerSource, /function isStreamConfigured/);
  assert.match(workerSource, /function queueStreamOptimization/);
  assert.match(workerSource, /function createStreamCopy/);
  assert.match(workerSource, /\/accounts\/\$\{encodeURIComponent\(accountId\)\}\/stream\/copy/);
  assert.match(workerSource, /requireSignedURLs: true/);
  assert.match(workerSource, /function createStreamPlaybackToken/);
  assert.match(workerSource, /\/accounts\/\$\{encodeURIComponent\(accountId\)\}\/stream\/\$\{encodeURIComponent\(streamUid\)\}\/token/);
  assert.match(workerSource, /function buildStreamPlaybackClient/);
  assert.match(workerSource, /streamUrl/);
  assert.match(workerSource, /streamStatus/);
  assert.match(workerSource, /queueStreamOptimization\(env, request, submission/);
  assert.match(workerSource, /deleteStreamVideo/);
});

test('capsule viewer prefers optimized Stream playback when it is available', async () => {
  const [capsuleHtml, capsuleJs] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js')
  ]);

  assert.match(capsuleHtml, /hls\.js/);
  assert.match(capsuleHtml, /capsule\.js\?v=20260601-stream-playback-1/);
  assert.match(capsuleJs, /data-stream-url/);
  assert.match(capsuleJs, /function hydrateStreamVideos/);
  assert.match(capsuleJs, /window\.Hls\.isSupported\(\)/);
  assert.match(capsuleJs, /video\.canPlayType\("application\/vnd\.apple\.mpegurl"\)/);
  assert.match(capsuleJs, /item\.streamUrl \|\| item\.mediaUrl/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
