import assert from 'node:assert/strict';
import { test } from 'node:test';

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

async function loadSharedModule(location) {
  const previousWindow = globalThis.window;
  const storage = createStorage();
  globalThis.window = {
    location,
    localStorage: storage,
    sessionStorage: storage,
    setTimeout,
    clearTimeout,
    history: { replaceState() {} }
  };

  const moduleUrl = new URL('../../moments/shared.js', import.meta.url);
  moduleUrl.search = `?case=${Date.now()}-${Math.random()}`;

  try {
    return await import(moduleUrl.href);
  } finally {
    globalThis.window = previousWindow;
  }
}

test('share links generated from local admin still point to the public site', async () => {
  const shared = await loadSharedModule({
    hostname: '127.0.0.1',
    search: '',
    origin: 'http://127.0.0.1:8000',
    href: 'http://127.0.0.1:8000/moments/admin/'
  });

  globalThis.window = {
    location: {
      hostname: '127.0.0.1',
      search: '',
      origin: 'http://127.0.0.1:8000',
      href: 'http://127.0.0.1:8000/moments/admin/'
    },
    localStorage: createStorage(),
    sessionStorage: createStorage()
  };

  try {
    assert.equal(
      shared.buildGuestUrl('ww-test'),
      'https://williamsonwallflowers.com/moments/?t=ww-test'
    );
    assert.equal(
      shared.buildHostUrl('event-1', 'host-token'),
      'https://williamsonwallflowers.com/moments/host/?event=event-1#token=host-token'
    );
    assert.equal(
      shared.buildCapsuleUrl('event-1', 'share-token'),
      'https://williamsonwallflowers.com/moments/capsule/?event=event-1#token=share-token'
    );
    assert.equal(
      typeof shared.getPublishedCapsuleShareUrl,
      'function'
    );
    assert.equal(
      shared.getPublishedCapsuleShareUrl({
        id: 'event-1',
        capsuleShareUrl: 'https://williamsonwallflowers.com/moments/capsule/?event=event-1#token=share-token',
        timeCapsuleEnabled: true,
        timeCapsuleStatus: 'draft',
        timeCapsuleShareToken: 'share-token'
      }),
      ''
    );
    assert.equal(
      shared.getPublishedCapsuleShareUrl({
        id: 'event-1',
        capsuleShareUrl: 'https://williamsonwallflowers.com/moments/capsule/?event=event-1#token=share-token',
        timeCapsuleEnabled: true,
        timeCapsuleStatus: 'published',
        timeCapsuleShareToken: 'share-token'
      }),
      'https://williamsonwallflowers.com/moments/capsule/?event=event-1#token=share-token'
    );
  } finally {
    delete globalThis.window;
  }
});
