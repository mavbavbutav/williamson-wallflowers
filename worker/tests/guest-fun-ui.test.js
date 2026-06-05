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
  assert.match(guestHtml, /class="mode-glyph"/);
  assert.match(guestHtml, /class="mode-nudge"/);
  assert.match(guestHtml, /Capture the moment/);
  assert.match(guestHtml, /30 sec of fun/);
  assert.match(guestHtml, /60 sec toast/);
  assert.match(guestHtml, /Tap to add/);
  assert.match(guestHtml, /Tap to film/);
  assert.match(guestHtml, /Tap to record/);
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
  assert.match(styles, /\.mode-glyph/);
  assert.match(styles, /\.mode-nudge/);
  assert.match(styles, /\.guest-page:not\(\.is-countdown-locked\) \.memory-mode-card:hover/);
  assert.match(styles, /\.mode-detail/);
  assert.match(styles, /\.guest-celebration/);
  assert.match(styles, /\.countdown-unit\s*\{[\s\S]*?grid-template-rows: minmax\(3\.8rem, auto\) auto/);
  assert.match(styles, /\.countdown-value\s*\{[\s\S]*?line-height: 1/);
  assert.match(styles, /\.countdown-label\s*\{[\s\S]*?white-space: nowrap/);
  assert.match(styles, /@media[\s\S]*?\.countdown-unit\s*\{[\s\S]*?min-height: 6\.15rem/);
  assert.match(styles, /@media[\s\S]*?\.countdown-value\s*\{[\s\S]*?font-size: 2\.55rem/);
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

test('guest Party View audio cards keep controls clear of metadata overlays', async () => {
  const [guestJs, styles] = await Promise.all([
    readText('../../moments/app.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(guestJs, /party-card is-\$\{item\.mediaType\}/);
  assert.match(guestJs, /media\.className = `party-card-media is-\$\{item\.mediaType\}`/);
  assert.match(styles, /\.party-card\.is-audio \.party-card-media\s*\{[\s\S]*?grid-area: auto/);
  assert.match(styles, /\.party-card\.is-audio \.party-card-body\s*\{[\s\S]*?grid-area: auto/);
  assert.match(styles, /\.party-card\.is-audio \.party-card-body\s*\{[\s\S]*?pointer-events: auto/);
});

test('guest Party View updates are incremental when media updates arrive', async () => {
  const guestJs = await readText('../../moments/app.js');

  assert.match(guestJs, /const HOST_POSTS_POLL_INTERVAL_MS = 10000/);
  assert.match(guestJs, /function hostPostsMatch/);
  assert.match(guestJs, /function isPartyViewMediaPlaying/);
  assert.match(guestJs, /function syncGuestPartyPostVisibility/);
  assert.match(guestJs, /function applyHostPostsDiff/);
  assert.match(guestJs, /function patchHostPostsInContainer/);
  assert.match(guestJs, /if \(item\?\.id\) card\.dataset\.hostPostId = item\.id;/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
