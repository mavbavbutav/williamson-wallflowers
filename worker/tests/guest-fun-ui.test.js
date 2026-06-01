import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('guest link keeps the memory booth flow minimal', async () => {
  const [guestHtml, guestJs, styles] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(guestHtml, /styles\.css\?v=20260601-guest-minimal-1/);
  assert.match(guestHtml, /app\.js\?v=20260601-guest-minimal-1/);
  assert.doesNotMatch(guestHtml, /class="guest-flow-card"/);
  assert.match(guestHtml, /class="memory-mode-card/);
  assert.match(guestHtml, />Photo</);
  assert.match(guestHtml, />Video</);
  assert.match(guestHtml, />Voice Memo</);
  assert.match(guestHtml, /Take or upload/);
  assert.match(guestHtml, /30 sec max/);
  assert.match(guestHtml, /60 sec max/);
  assert.match(guestHtml, /<h1 class="section-title" tabindex="-1">Send it\?<\/h1>/);
  assert.doesNotMatch(guestHtml, /class="mode-badge"/);
  assert.doesNotMatch(guestHtml, /class="mode-action"/);
  assert.doesNotMatch(guestHtml, /class="mode-copy"/);
  assert.doesNotMatch(guestHtml, /data-guest-step="choose"/);
  assert.doesNotMatch(guestHtml, /id="guestEncouragement"/);
  assert.doesNotMatch(guestHtml, /id="sendSummary"/);
  assert.match(guestHtml, /id="guestCelebration"/);

  assert.match(guestJs, /function updateGuestFlow/);
  assert.match(guestJs, /function renderSendSummary/);
  assert.match(guestJs, /function showGuestCelebration/);
  assert.match(guestJs, /function openPhoneLibrary/);
  assert.match(guestJs, /fileInput\.removeAttribute\("capture"\)/);
  assert.doesNotMatch(guestJs, /fileInput\.capture\s*=/);
  assert.match(guestJs, /chooseMode\(button\.dataset\.mode\)/);
  assert.match(guestJs, /Voice memo ready/);
  assert.doesNotMatch(guestJs, /guestEncouragement/);

  assert.match(styles, /\.guest-flow-card/);
  assert.match(styles, /\.memory-mode-card/);
  assert.match(styles, /\.send-summary/);
  assert.match(styles, /\.guest-page \.memory-mode-card/);
  assert.match(styles, /\.mode-detail/);
  assert.match(styles, /\.guest-celebration/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
