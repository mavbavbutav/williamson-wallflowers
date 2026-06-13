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
  assert.doesNotMatch(guestJs, /MAX_PHOTO_BYTES/);
  assert.doesNotMatch(guestJs, /Photos must be 8 MB or smaller/);
  assert.match(guestJs, /PHOTO_CAPTURE_QUALITY = 0\.98/);
  assert.match(guestJs, /PHOTO_CAPTURE_WIDTH_IDEAL = 4096/);
  assert.match(guestJs, /function getPhotoVideoConstraints/);
  assert.match(guestJs, /function captureStillPhotoFile/);
  assert.match(guestJs, /new ImageCapture\(track\)/);
  assert.match(guestJs, /\.takePhoto\(/);
  assert.match(guestJs, /await captureStillPhotoFile\(track\)/);
  assert.match(guestJs, /canvas\.toBlob\([\s\S]*?, "image\/jpeg", PHOTO_CAPTURE_QUALITY\);/);
  assert.match(guestJs, /chooseMode\(button\.dataset\.mode\)/);
  assert.doesNotMatch(guestJs, /function buildMomentInteractionsMarkup/);
  assert.doesNotMatch(guestJs, /function handleMomentInteractionAction/);
  assert.doesNotMatch(guestJs, /function submitMomentReaction/);
  assert.doesNotMatch(guestJs, /function handleMomentCommentSubmit/);
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
  assert.doesNotMatch(cssBlock(styles, '.guest-page:not(.is-countdown-locked) .memory-mode-card:hover'), /transform\s*:/);
  assert.equal(cssBlock(styles, '.guest-page:not(.is-countdown-locked) .memory-mode-card:hover .mode-glyph'), '');
  assert.doesNotMatch(cssBlock(styles, '.guest-page:not(.is-countdown-locked) .memory-mode-card:hover .mode-nudge::after'), /translate/);
  assert.match(cssBlock(styles, `.guest-page .button:hover,
.guest-page .icon-button:hover,
.guest-page .text-link:hover,
.guest-page .small-button:hover`), /transform:\s*none/);
  assert.match(styles, /\.mode-detail/);
  assert.match(styles, /\.guest-celebration/);
  assert.match(styles, /\.countdown-unit\s*\{[\s\S]*?grid-template-rows: minmax\(3\.8rem, auto\) auto/);
  assert.match(styles, /\.countdown-value\s*\{[\s\S]*?line-height: 1/);
  assert.match(styles, /\.countdown-label\s*\{[\s\S]*?white-space: nowrap/);
  assert.doesNotMatch(styles, /\.moment-interactions/);
  assert.doesNotMatch(styles, /\.moment-action-button/);
  assert.doesNotMatch(styles, /\.moment-reaction-row/);
  assert.doesNotMatch(styles, /\.moment-comment-form/);
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

test('guest upload success prompts guests to save a local copy', async () => {
  const [guestHtml, guestJs, styles] = await Promise.all([
    readText('../../moments/index.html'),
    readText('../../moments/app.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(guestHtml, /id="saveToPhonePanel"/);
  assert.match(guestHtml, /id="saveToPhoneButton"/);
  assert.match(guestHtml, /Save photo to phone/);
  assert.match(guestHtml, /id="saveToPhoneNotice"/);

  assert.match(guestJs, /qs\("#saveToPhoneButton"\)\.addEventListener\("click", saveMomentToPhone\)/);
  assert.match(guestJs, /function updateSaveToPhonePrompt/);
  assert.match(guestJs, /function isSaveableMediaType/);
  assert.match(guestJs, /function getSaveToPhoneButtonLabel/);
  assert.match(guestJs, /return \["photo", "video", "audio"\]\.includes\(mediaType\)/);
  assert.match(guestJs, /return "Save voice memo to phone"/);
  assert.match(guestJs, /function saveMomentToPhone/);
  assert.match(guestJs, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(guestJs, /navigator\.share\(\{[\s\S]*files: \[file\]/);
  assert.match(guestJs, /function downloadMomentToPhone/);
  assert.match(guestJs, /updateSaveToPhonePrompt\(\);[\s\S]*showView\("success"\)/);

  assert.match(styles, /\.save-to-phone-panel/);
  assert.match(styles, /\.save-to-phone-panel\s*\{[\s\S]*?justify-self: center/);
  assert.match(styles, /\.guest-page #saveToPhoneButton/);
  assert.match(styles, /\.guest-page #successView \.hero-main > \.button-row\s*\{[\s\S]*?justify-self: center/);
});

test('guest video recorder auto-stops at the duration limit and moves to review', async () => {
  const guestJs = await readText('../../moments/app.js');

  assert.match(guestJs, /const RECORDER_TIMESLICE_MS = 1000/);
  assert.match(guestJs, /autoStopTimerId: 0/);
  assert.match(guestJs, /state\.recorder\.start\(RECORDER_TIMESLICE_MS\)/);
  assert.match(guestJs, /state\.autoStopTimerId = window\.setTimeout\(autoStopRecording, maxSeconds \* 1000\)/);
  assert.match(guestJs, /function autoStopRecording\(\)/);
  assert.match(guestJs, /stopRecording\(\{ auto: true \}\)/);
  assert.match(guestJs, /state\.recorder\.requestData\?\.\(\)/);
  assert.match(guestJs, /Recording hit \$\{formatTimer\(maxSeconds\)\} and is ready to send\./);
  assert.match(guestJs, /function finishRecordedMedia\(/);
  assert.match(guestJs, /renderPreview\(\);[\s\S]*generateRecordedVideoThumbnail/);
  assert.match(guestJs, /try \{[\s\S]*createVideoThumbnailFile[\s\S]*\} catch \{[\s\S]*Recorded videos can still be sent without a generated thumbnail/);
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

function cssBlock(styles, selector) {
  const escapedSelector = selector
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s*');
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}
