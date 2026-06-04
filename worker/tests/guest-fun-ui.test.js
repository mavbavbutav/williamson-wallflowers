import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('guest link keeps the memory booth flow minimal', async () => {
  const [guestHtml, guestJs, styles] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(guestHtml, /<link rel="stylesheet" href="styles\.css\?v=[^"]+" \/>/);
  assert.match(guestHtml, /<script type="module" src="app\.js\?v=[^"]+"><\/script>/);
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
  assert.match(guestJs, /function allowsGuestUploadsBeforeCountdown/);
  assert.match(guestJs, /state\.event\?\.guestUploadsBeforeCountdownEnabled/);
  assert.match(guestJs, /Voice memo ready/);
  assert.doesNotMatch(guestJs, /guestEncouragement/);

  assert.match(styles, /\.guest-flow-card/);
  assert.match(styles, /\.memory-mode-card/);
  assert.match(styles, /\.send-summary/);
  assert.match(styles, /\.guest-page \.memory-mode-card/);
  assert.match(styles, /\.mode-detail/);
  assert.match(styles, /\.guest-celebration/);
});

test('guest upload flow stays above Party View media when host posts exist', async () => {
  const [guestHtml, guestJs] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js')
  ]);

  const partyViewIndex = guestHtml.indexOf('id="hostPostsView"');
  const captureIndex = guestHtml.indexOf('id="captureView"');
  const reviewIndex = guestHtml.indexOf('id="reviewView"');
  const successIndex = guestHtml.indexOf('id="successView"');

  assert.ok(captureIndex > -1, 'capture view should exist');
  assert.ok(reviewIndex > -1, 'review view should exist');
  assert.ok(successIndex > -1, 'success view should exist');
  assert.ok(partyViewIndex > -1, 'Party View should exist');
  assert.ok(captureIndex < partyViewIndex, 'capture UI should render before Party View media');
  assert.ok(reviewIndex < partyViewIndex, 'review UI should render before Party View media');
  assert.ok(successIndex < partyViewIndex, 'success UI should render before Party View media');
  assert.match(guestJs, /function scrollActiveGuestViewIntoPlace/);
  assert.match(guestJs, /scrollIntoView/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
