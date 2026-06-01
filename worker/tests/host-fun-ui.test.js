import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('host page has the fun pass dashboard, cleaner actions, and share card', async () => {
  const [hostHtml, hostJs, styles] = await Promise.all([
    readText('../../moments/host/index.html'),
    readText('../../moments/host/host.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(hostHtml, /id="hostPulse"/);
  assert.match(hostHtml, /id="shareCard"/);
  assert.match(hostHtml, /host\.js\?v=20260601-party-view-1/);
  assert.match(hostHtml, /styles\.css\?v=20260601-party-opacity-1/);
  assert.match(hostHtml, /data-workspace-count="submissions"/);
  assert.match(hostHtml, /data-workspace-count="capsule"/);

  assert.match(hostJs, /function renderHostPulse/);
  assert.match(hostJs, /const workspaceCounts/);
  assert.match(hostJs, /function showHostCelebration/);
  assert.match(hostJs, /function renderCardMoreActions/);
  assert.match(hostJs, /function copyCapsuleLink/);
  assert.match(hostJs, /saved so far/);
  assert.match(hostJs, /Private Time Capsule link copied/);

  assert.match(styles, /\.host-pulse/);
  assert.match(styles, /\.host-pulse-stat/);
  assert.match(styles, /\.share-card/);
  assert.match(styles, /\.card-more-actions/);
  assert.match(styles, /\.host-decision-actions/);
  assert.match(styles, /\.host-page #mediaGrid \.media-card\.is-media-video[\s\S]*?grid-template-columns/);
  assert.match(styles, /\.host-page \.media-thumb\.is-video[\s\S]*?aspect-ratio: 9 \/ 16/);
  assert.match(styles, /\.host-page \.media-thumb\.is-video video[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.host-celebration/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
