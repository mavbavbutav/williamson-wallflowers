import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

function createElement() {
  return {
    hidden: false,
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute() {},
    addEventListener() {},
    append() {},
    focus() {},
    scrollTo() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function installCapsuleDom() {
  const elements = new Map();
  const selectors = [
    '#playSlideshowButton',
    '#castTvButton',
    '#castTvPanel',
    '#startAirplayFullscreenButton',
    '#startChromecastButton',
    '#copyTvDisplayLinkButton',
    '#openTvDisplayLinkButton',
    '#castTvStatus',
    '#exitSwipeFeedButton',
    '#slideClose',
    '#slidePrev',
    '#slideNext',
    '#slidePlayPause',
    '#slideshowModal',
    '#capsuleTitle',
    '#capsuleMeta',
    '#capsuleEmpty',
    '#capsuleTimeline',
    '#capsuleFeed',
    '#capsuleNotice',
    '#slideStage',
    '#slideTitle',
    '#slideMeta',
    '#slideCaption'
  ];

  selectors.forEach((selector) => elements.set(selector, createElement()));

  globalThis.document = {
    activeElement: createElement(),
    body: createElement(),
    addEventListener() {},
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return createElement();
    }
  };

  return elements;
}

function createStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test('capsule viewer keeps the share token in the address bar for copy/share', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousResponse = globalThis.Response;
  let replaceCalls = 0;
  let authHeader = '';

  installCapsuleDom();
  const storage = createStorage();
  globalThis.window = {
    location: {
      search: '?event=event-1',
      hash: '#token=share-token',
      href: 'https://williamsonwallflowers.com/moments/capsule/?event=event-1#token=share-token'
    },
    localStorage: storage,
    sessionStorage: storage,
    setTimeout,
    clearTimeout,
    history: {
      replaceState() {
        replaceCalls += 1;
      }
    }
  };
  globalThis.fetch = async (_url, options = {}) => {
    authHeader = options.headers.Authorization;
    return new Response(JSON.stringify({
      ok: true,
      event: {
        title: 'Shared Capsule',
        eventDate: '2026-05-06',
        publishedAt: '2026-05-31T12:00:00.000Z'
      },
      items: []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const moduleUrl = new URL('../../moments/capsule/capsule.js', import.meta.url);
  moduleUrl.search = `?case=${Date.now()}-${Math.random()}`;

  try {
    await import(moduleUrl.href);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(authHeader, 'Bearer share-token');
    assert.equal(replaceCalls, 0);
    assert.equal(globalThis.window.location.hash, '#token=share-token');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    globalThis.Response = previousResponse;
  }
});

test('capsule viewer exposes a vertical swipe feed alongside the timeline', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleHtml, /data-capsule-view="timeline"/);
  assert.match(capsuleHtml, /data-capsule-view="feed"/);
  assert.match(capsuleHtml, /id="capsuleFeed"/);
  assert.match(capsuleHtml, /Swipe Feed/);
  assert.match(capsuleJs, /function renderSwipeFeed/);
  assert.match(capsuleJs, /function setCapsuleView/);
  assert.match(capsuleJs, /data-feed-index/);
  assert.match(capsuleJs, /toggleFeedPlayback/);
  assert.match(styles, /\.capsule-swipe-feed/);
  assert.match(styles, /scroll-snap-type: y mandatory/);
  assert.match(styles, /\.capsule-feed-card/);
});

test('capsule swipe feed becomes fullscreen on mobile and videos use poster art', async () => {
  const [capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleJs, /document\.body\.classList\.toggle\("is-swipe-feed-active"/);
  assert.match(capsuleJs, /function videoPosterUrl/);
  assert.match(capsuleJs, /poster="\$\{escapeAttribute\(videoPosterUrl\(item\)\)\}"/);
  assert.match(styles, /\.capsule-viewer\.is-swipe-feed-active \.site-topbar[\s\S]*?display: none/);
  assert.match(styles, /\.capsule-viewer\.is-swipe-feed-active \.capsule-swipe-feed[\s\S]*?position: fixed/);
  assert.match(styles, /\.capsule-viewer\.is-swipe-feed-active \.capsule-swipe-feed[\s\S]*?height: 100dvh/);
  assert.match(styles, /\.capsule-viewer\.is-swipe-feed-active \.capsule-feed-card[\s\S]*?min-height: 100dvh/);
});

test('capsule swipe feed tries native fullscreen and provides an exit control', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleHtml, /id="capsuleDashboard"/);
  assert.match(capsuleHtml, /id="exitSwipeFeedButton"/);
  assert.match(capsuleJs, /setCapsuleView\(button\.dataset\.capsuleView \|\| "timeline", \{ userInitiated: true \}\)/);
  assert.match(capsuleJs, /function requestSwipeFullscreen/);
  assert.match(capsuleJs, /requestFullscreen/);
  assert.match(capsuleJs, /navigationUI: "hide"/);
  assert.match(capsuleJs, /function exitSwipeFullscreen/);
  assert.match(capsuleJs, /fullscreenchange/);
  assert.match(styles, /\.capsule-viewer\.is-swipe-feed-active \.dashboard[\s\S]*?position: fixed/);
  assert.match(styles, /\.capsule-viewer\.is-swipe-feed-active \.capsule-feed-exit/);
});

test('capsule videos replace generic poster art with captured video frames', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /data-video-poster-url/);
  assert.match(capsuleJs, /crossorigin="anonymous"/);
  assert.match(capsuleJs, /function hydrateVideoPosters/);
  assert.match(capsuleJs, /function captureVideoPoster/);
  assert.match(capsuleJs, /function captureVideoFrame/);
  assert.match(capsuleJs, /getImageData/);
  assert.match(capsuleJs, /toDataURL\("image\/jpeg"/);
  assert.match(capsuleJs, /posterSampleTimes/);
  assert.match(capsuleJs, /function waitForVideoFrame/);
  assert.match(capsuleJs, /requestVideoFrameCallback/);
  assert.match(capsuleJs, /function playVideoUntil/);
  assert.match(capsuleJs, /function waitForVideoTime/);
  assert.match(capsuleJs, /thumbnailUrl/);
  assert.match(capsuleJs, /data-thumbnail-upload-url/);
  assert.match(capsuleJs, /function persistGeneratedVideoPoster/);
  assert.match(capsuleJs, /videoPosterCache/);
});

test('capsule swipe feed auto-plays centered videos and voice memos', async () => {
  const [capsuleHtml, capsuleJs] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js')
  ]);

  assert.match(capsuleHtml, /capsule\.js\?v=20260601-tv-cast-fix-1/);
  assert.match(capsuleJs, /scheduleFeedAutoplay/);
  assert.match(capsuleJs, /function syncFeedAutoplay/);
  assert.match(capsuleJs, /function getCenteredFeedMedia/);
  assert.match(capsuleJs, /function autoplayFeedMedia/);
  assert.match(capsuleJs, /toLowerCase\(\) === "video"/);
  assert.match(capsuleJs, /toLowerCase\(\) === "audio"/);
  assert.match(capsuleJs, /Tap for sound/);
  assert.match(capsuleJs, /Tap to listen/);
  assert.match(capsuleJs, /pauseAllFeedMedia\(media\)/);
});

test('capsule swipe feed starts incoming videos during the swipe without showing a video play prompt', async () => {
  const [capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleJs, /requestAnimationFrame/);
  assert.match(capsuleJs, /function getGestureFeedCard/);
  assert.match(capsuleJs, /const FEED_EARLY_PLAY_VISIBILITY_RATIO = 0\.28/);
  assert.match(capsuleJs, /feedScrollDirection/);
  assert.match(capsuleJs, /getGestureFeedCard\(feed\) \|\| getCenteredFeedCard\(feed\)/);
  assert.match(capsuleJs, /data-feed-prompt="video"/);
  assert.match(capsuleJs, /media\.play\(\)\.catch\(async/);
  assert.match(capsuleJs, /if \(isFeedVideo\(media\) && !media\.muted\)/);
  assert.match(styles, /\.capsule-feed-card\.is-video:not\(\.is-autoplay-blocked\) \.capsule-feed-play/);
  assert.match(styles, /pointer-events: none/);
  assert.match(styles, /\.capsule-feed-card\.is-video\.is-autoplay-blocked \.capsule-feed-play/);
}
);

test('capsule swipe feed keeps videos unmuted after one sound unlock', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /let feedSoundUnlocked = false/);
  assert.match(capsuleJs, /function unlockFeedSound/);
  assert.match(capsuleJs, /if \(options\.userInitiated\)[\s\S]*?unlockFeedSound\(\)/);
  assert.match(capsuleJs, /feedSoundUnlocked = true/);
  assert.match(capsuleJs, /qsaFeedVideos\(\)\.forEach/);
  assert.match(capsuleJs, /video\.muted = false/);
  assert.match(capsuleJs, /volumechange/);
  assert.match(capsuleJs, /media\.muted = !feedSoundUnlocked/);
});

test('capsule swipe feed preloads adjacent media before the next swipe', async () => {
  const [capsuleHtml, capsuleJs] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js')
  ]);

  assert.match(capsuleHtml, /capsule\.js\?v=20260601-tv-cast-fix-1/);
  assert.match(capsuleJs, /const FEED_MEDIA_WARM_RADIUS = 2/);
  assert.match(capsuleJs, /const FEED_IMAGE_WARM_RADIUS = 2/);
  assert.match(capsuleJs, /function warmFeedAroundCard/);
  assert.match(capsuleJs, /function warmFeedMedia/);
  assert.match(capsuleJs, /media\.preload = "auto"/);
  assert.match(capsuleJs, /media\.load\?\.\(\)/);
  assert.match(capsuleJs, /media\.preload = "metadata"/);
  assert.match(capsuleJs, /function primeFeedImage/);
  assert.match(capsuleJs, /image\.loading = "eager"/);
  assert.match(capsuleJs, /image\.decode\(\)/);
  assert.match(capsuleJs, /function setFeedCardReady/);
  assert.match(capsuleJs, /"canplay"/);
  assert.match(capsuleJs, /"loadeddata"/);
});

test('capsule slideshow has TV mode with fullscreen, uncropped portrait media, and auto advance', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleHtml, /TV Slideshow/);
  assert.match(capsuleHtml, /id="slidePlayPause"/);
  assert.match(capsuleHtml, /class="media-modal tv-slideshow-modal"/);
  assert.match(capsuleHtml, /capsule\.js\?v=20260601-tv-cast-fix-1/);
  assert.match(capsuleJs, /const PHOTO_SLIDE_DURATION_MS = 20000/);
  assert.match(capsuleJs, /function requestSlideshowFullscreen/);
  assert.match(capsuleJs, /requestFullscreen/);
  assert.match(capsuleJs, /navigationUI: "hide"/);
  assert.match(capsuleJs, /function scheduleSlideAdvance/);
  assert.match(capsuleJs, /function advanceSlideAfterPlayback/);
  assert.match(capsuleJs, /video\.addEventListener\("ended", advanceSlideAfterPlayback/);
  assert.match(capsuleJs, /audio\.addEventListener\("ended", advanceSlideAfterPlayback/);
  assert.match(capsuleJs, /videoSourceAttributes\(item\)/);
  assert.match(capsuleJs, /function bindTvMediaOrientation/);
  assert.match(capsuleJs, /function applyTvMediaOrientation/);
  assert.match(capsuleJs, /function sizeTvForeground/);
  assert.match(capsuleJs, /media\.style\.width = `\$\{Math\.round\(width\)\}px`/);
  assert.match(capsuleJs, /media\.style\.height = `\$\{Math\.round\(height\)\}px`/);
  assert.match(capsuleJs, /--media-aspect/);
  assert.match(capsuleJs, /is-portrait/);
  assert.match(capsuleJs, /className = "tv-slide-frame/);
  assert.match(capsuleJs, /className = "tv-slide-backdrop/);
  assert.match(capsuleJs, /className = "tv-audio-stage/);
  assert.match(styles, /\.tv-slideshow-modal/);
  assert.match(styles, /\.tv-slideshow-modal[\s\S]*?height: 100dvh/);
  assert.match(styles, /\.tv-slideshow-modal \.media-modal-bar[\s\S]*?position: absolute/);
  assert.match(styles, /\.tv-slideshow-modal \.capsule-slide-copy[\s\S]*?position: absolute/);
  assert.match(styles, /\.tv-slide-frame[\s\S]*?aspect-ratio: 16 \/ 9/);
  assert.match(styles, /\.tv-slide-backdrop[\s\S]*?filter: blur/);
  assert.match(styles, /\.media-modal-stage \.tv-slide-frame \.tv-slide-backdrop-media[\s\S]*?object-fit: cover/);
  assert.doesNotMatch(styles, /\.tv-slide-foreground\s*\{[^}]*object-fit:\s*cover/);
  assert.match(styles, /\.tv-slide-foreground[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.media-modal-stage \.tv-slide-frame \.tv-slide-foreground\.is-portrait[\s\S]*?height: 100%/);
  assert.match(styles, /\.tv-slide-foreground\.is-portrait[\s\S]*?height: 100%/);
  assert.match(styles, /\.tv-slide-foreground\.is-landscape[\s\S]*?width: 100%/);
  assert.match(styles, /\.tv-audio-stage/);
});

test('capsule viewer exposes Cast and TV display fallbacks', async () => {
  const [capsuleHtml, capsuleJs, styles, castHtml, castJs] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css'),
    readText('../../moments/capsule/cast/index.html'),
    readText('../../moments/capsule/cast/cast.js')
  ]);

  assert.match(capsuleHtml, /id="castTvButton"/);
  assert.match(capsuleHtml, /id="castTvPanel"/);
  assert.match(capsuleHtml, /id="startAirplayFullscreenButton"/);
  assert.match(capsuleHtml, /id="startChromecastButton"/);
  assert.match(capsuleHtml, /id="copyTvDisplayLinkButton"/);
  assert.match(capsuleJs, /const CAST_RECEIVER_APP_ID =/);
  assert.match(capsuleJs, /function initCastTvControls/);
  assert.match(capsuleJs, /function updateCastTvControls/);
  assert.match(capsuleJs, /function loadGoogleCastSender/);
  assert.match(capsuleJs, /cast_sender\.js\?loadCastFramework=1/);
  assert.match(capsuleJs, /function configureCastContext/);
  assert.match(capsuleJs, /function startChromecastSession/);
  assert.match(capsuleJs, /!CAST_RECEIVER_APP_ID \|\| !window\.chrome/);
  assert.match(capsuleJs, /function buildTvDisplayUrl/);
  assert.match(styles, /\.cast-tv-panel/);
  assert.match(styles, /\.cast-tv-panel\[hidden\]/);

  assert.match(castHtml, /Wallflower Time Capsule TV/);
  assert.match(castHtml, /id="castStage"/);
  assert.match(castHtml, /cast\.js\?v=20260601-tv-cast-fix-1/);
  assert.match(castJs, /const PHOTO_SLIDE_DURATION_MS = 20000/);
  assert.match(castJs, /\/capsules\/\$\{encodeURIComponent\(eventId\)\}/);
  assert.match(castJs, /function renderCastSlide/);
  assert.match(castJs, /function bindTvMediaOrientation/);
  assert.match(castJs, /item\.streamUrl \|\| item\.mediaUrl/);
  assert.match(castJs, /addEventListener\("ended", showNextCastSlide/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
