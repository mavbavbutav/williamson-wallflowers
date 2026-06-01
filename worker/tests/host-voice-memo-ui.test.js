import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('host voice memos render as distinct audio-only cards instead of blank video thumbnails', async () => {
  const [hostJs, styles, hostHtml] = await Promise.all([
    readText('../../moments/host/host.js'),
    readText('../../moments/styles.css'),
    readText('../../moments/host/index.html')
  ]);

  assert.match(hostJs, /renderVoiceMemoThumb/);
  assert.match(hostJs, /voice-memo-panel/);
  assert.match(hostJs, /voice-waveform/);
  assert.match(hostJs, /formatDuration/);
  assert.match(styles, /\.voice-memo-panel/);
  assert.match(styles, /\.voice-waveform/);
  assert.match(styles, /\.voice-memo-kicker/);
  assert.match(hostHtml, /host\.js\?v=20260601-party-view-1/);
  assert.match(hostHtml, /styles\.css\?v=20260601-party-opacity-1/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
