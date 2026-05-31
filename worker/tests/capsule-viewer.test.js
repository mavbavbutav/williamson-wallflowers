import assert from 'node:assert/strict';
import { test } from 'node:test';

function createElement() {
  return {
    hidden: false,
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: {
      add() {},
      remove() {}
    },
    addEventListener() {},
    append() {},
    focus() {},
    querySelectorAll() {
      return [];
    }
  };
}

function installCapsuleDom() {
  const elements = new Map();
  const selectors = [
    '#playSlideshowButton',
    '#slideClose',
    '#slidePrev',
    '#slideNext',
    '#slideshowModal',
    '#capsuleTitle',
    '#capsuleMeta',
    '#capsuleEmpty',
    '#capsuleTimeline',
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
