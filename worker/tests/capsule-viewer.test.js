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
    '#exitSwipeFeedButton',
    '#slideClose',
    '#slidePrev',
    '#slideNext',
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

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
