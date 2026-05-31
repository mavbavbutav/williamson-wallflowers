import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('guest link has a playful memory booth flow', async () => {
  const [guestHtml, guestJs, styles] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(guestHtml, /styles\.css\?v=20260531-mode-clarity-1/);
  assert.match(guestHtml, /app\.js\?v=20260531-mode-clarity-1/);
  assert.match(guestHtml, /class="guest-flow-card"/);
  assert.match(guestHtml, /class="memory-mode-card/);
  assert.match(guestHtml, /class="mode-badge">PHOTO</);
  assert.match(guestHtml, /class="mode-badge">VIDEO</);
  assert.match(guestHtml, /class="mode-badge">AUDIO</);
  assert.match(guestHtml, /Take Photo/);
  assert.match(guestHtml, /Record Video/);
  assert.match(guestHtml, /Record Voice Memo/);
  assert.match(guestHtml, /class="mode-action">Opens your camera/);
  assert.match(guestHtml, /class="mode-action">Starts recording video/);
  assert.match(guestHtml, /class="mode-action">Starts your microphone/);
  assert.match(guestHtml, /data-guest-step="choose"/);
  assert.match(guestHtml, /id="guestEncouragement"/);
  assert.match(guestHtml, /id="sendSummary"/);
  assert.match(guestHtml, /id="guestCelebration"/);

  assert.match(guestJs, /function updateGuestFlow/);
  assert.match(guestJs, /function renderSendSummary/);
  assert.match(guestJs, /function showGuestCelebration/);
  assert.match(guestJs, /function openPhoneLibrary/);
  assert.match(guestJs, /fileInput\.removeAttribute\("capture"\)/);
  assert.doesNotMatch(guestJs, /fileInput\.capture\s*=/);
  assert.match(guestJs, /chooseMode\(button\.dataset\.mode\)/);
  assert.match(guestJs, /Your voice memo is ready/);

  assert.match(styles, /\.guest-flow-card/);
  assert.match(styles, /\.memory-mode-card/);
  assert.match(styles, /\.send-summary/);
  assert.match(styles, /\.guest-celebration/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
