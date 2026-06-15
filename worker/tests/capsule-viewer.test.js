import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

function createElement() {
  const listeners = new Map();

  return {
    hidden: false,
    innerHTML: '',
    textContent: '',
    dataset: {},
    parentElement: null,
    style: {
      setProperty() {},
      getPropertyValue() {
        return '';
      }
    },
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute() {},
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    click() {
      (listeners.get('click') || []).forEach((callback) => callback({ currentTarget: this, target: this }));
    },
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
  let walkCards = [];
  let walkCardSignature = '';
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
    '#capsuleWalk',
    '#capsuleWalkCanvas',
    '#capsuleWalkFallback',
    '#capsuleWalkScrollSpacer',
    '#capsuleNotice',
    '#slideStage',
    '#slideTitle',
    '#slideMeta',
    '#slideCaption'
  ];

  selectors.forEach((selector) => elements.set(selector, createElement()));
  const viewButtons = ['timeline', 'feed', 'walk'].map((view) => {
    const element = createElement();
    element.dataset.capsuleView = view;
    element.hidden = view === 'walk';
    element.parentElement = createElement();
    elements.set(`[data-capsule-view="${view}"]`, element);
    return element;
  });

  globalThis.document = {
    activeElement: createElement(),
    body: createElement(),
    head: createElement(),
    addEventListener() {},
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-capsule-view]') return viewButtons;
      if (selector === '[data-walk-slide]') {
        const fallbackHtml = elements.get('#capsuleWalkFallback')?.innerHTML || '';
        const signature = Array.from(fallbackHtml.matchAll(/data-walk-slide="([^"]+)"/g)).map((match) => match[1]).join('|');
        if (signature !== walkCardSignature) {
          walkCardSignature = signature;
          walkCards = signature
            ? signature.split('|').map((walkSlide) => {
                const element = createElement();
                element.dataset.walkSlide = walkSlide;
                return element;
              })
            : [];
        }
        return walkCards;
      }
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

test('capsule viewer offers a 3D Walk fallback when a published capsule has no spatial layout yet', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousResponse = globalThis.Response;
  const elements = installCapsuleDom();
  const storage = createStorage();

  globalThis.window = {
    location: {
      search: '?event=event-no-layout',
      hash: '#token=share-token',
      href: 'https://williamsonwallflowers.com/moments/capsule/?event=event-no-layout#token=share-token',
      hostname: 'williamsonwallflowers.com',
      origin: 'https://williamsonwallflowers.com'
    },
    localStorage: storage,
    sessionStorage: storage,
    setTimeout(callback, delay) {
      if (delay <= 100 && typeof callback === 'function') callback();
      return 0;
    },
    clearTimeout() {},
    addEventListener() {},
    getComputedStyle() {
      return {};
    },
    history: {
      replaceState() {}
    }
  };

  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    event: {
      title: 'Published Capsule',
      eventDate: '2026-06-14',
      publishedAt: '2026-06-14T12:00:00.000Z'
    },
    items: [
      {
        id: 'item-1',
        title: 'Cake table',
        chapter: 'First memory',
        mediaType: 'photo',
        mediaUrl: 'https://example.com/photo-1.jpg',
        capturedAt: '2026-06-14T12:01:00.000Z'
      },
      {
        id: 'item-2',
        title: 'Gift moment',
        chapter: 'Second memory',
        mediaType: 'photo',
        mediaUrl: 'https://example.com/photo-2.jpg',
        capturedAt: '2026-06-14T12:02:00.000Z'
      }
    ]
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  const moduleUrl = new URL('../../moments/capsule/capsule.js', import.meta.url);
  moduleUrl.search = `?case=${Date.now()}-${Math.random()}`;

  try {
    await import(moduleUrl.href);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(elements.get('#capsuleTitle').textContent, 'Published Capsule', elements.get('#capsuleNotice').textContent);
    assert.equal(elements.get('[data-capsule-view="walk"]').hidden, false);
    assert.match(elements.get('#capsuleWalkFallback').innerHTML, /Cinematic memory path/);
    const walkCards = document.querySelectorAll('[data-walk-slide]');
    assert.equal(walkCards.length, 2);
    assert.equal(walkCards[1].dataset.walkSlide, '1');
    walkCards[1].click();
    assert.equal(elements.get('#slideshowModal').hidden, false);
    assert.equal(elements.get('#slideTitle').textContent, 'Gift moment');
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

test('capsule viewer exposes a gated 3D Walk with WebGL and static fallback', async () => {
  const [capsuleHtml, capsuleJs, styles, threeModule] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css'),
    readText('../../moments/vendor/three.module.js')
  ]);

  assert.match(capsuleHtml, /<button[^>]*data-capsule-view="walk"[^>]*hidden[^>]*>3D Walk<\/button>/);
  assert.match(capsuleHtml, /id="capsuleWalk"/);
  assert.match(capsuleHtml, /id="capsuleWalkCanvas"/);
  assert.match(capsuleHtml, /id="capsuleWalkFallback"/);
  assert.match(capsuleHtml, /styles\.css\?v=20260615-walk-audio-2/);
  assert.match(capsuleHtml, /capsule\.js\?v=20260615-walk-audio-2/);

  assert.match(capsuleJs, /let spatialLayout = null/);
  assert.match(capsuleJs, /let spatialClusters = \[\]/);
  assert.match(capsuleJs, /let spatialPlacements = \[\]/);
  assert.match(capsuleJs, /let spatialWalkStarted = false/);
  assert.match(capsuleJs, /spatialLayout = payload\.spatialLayout \|\| null/);
  assert.match(capsuleJs, /spatialClusters = Array\.isArray\(payload\.spatialClusters\) \? payload\.spatialClusters : \[\]/);
  assert.match(capsuleJs, /spatialPlacements = Array\.isArray\(payload\.spatialPlacements\) \? payload\.spatialPlacements : \[\]/);
  assert.match(capsuleJs, /function renderSpatialWalk/);
  assert.match(capsuleJs, /function buildFallbackSpatialPlacements/);
  assert.match(capsuleJs, /function canUseWebGl/);
  assert.match(capsuleJs, /async function startSpatialWalkScene/);
  assert.match(capsuleJs, /function getSpatialScrollProgress/);
  assert.match(capsuleJs, /import\("\.\.\/vendor\/three\.module\.js"\)/);
  assert.doesNotMatch(capsuleJs, /cdn\.jsdelivr\.net/);
  assert.match(threeModule, /REVISION = '165'/);
  assert.match(threeModule, /class WebGLRenderer/);
  assert.match(capsuleJs, /prefers-reduced-motion/);
  assert.match(capsuleJs, /if \(view === "walk" && !hasSpatialWalk\(\)\)[\s\S]*?view = "timeline"/);
  assert.match(capsuleJs, /qs\("#capsuleWalk"\)\.hidden = currentCapsuleView !== "walk"/);
  assert.match(capsuleJs, /if \(currentCapsuleView === "walk"\)[\s\S]*?startSpatialWalkScene\(\)/);
  assert.match(capsuleJs, /if \(spatialWalkScene\) \{[\s\S]*?hideSpatialWalkFallback\(\);[\s\S]*?resizeSpatialWalkScene\(\);[\s\S]*?requestSpatialWalkFrame\(\);[\s\S]*?return;/);
  assert.match(capsuleJs, /fallback\.hidden = Boolean\(spatialWalkScene\)/);
  assert.match(capsuleJs, /function hideSpatialWalkFallback/);
  assert.match(capsuleJs, /material\.map = spatialTextureForItem\(THREE, station, isAudio, material, \(texture\) => updateSpatialStationMediaAspect\(THREE, station, texture\)\)/);
  assert.match(capsuleJs, /image\.onload = \(\) => \{[\s\S]*?image\.decode\(\)[\s\S]*?\};/);
  assert.match(capsuleJs, /image\.onerror = \(\) => \{[\s\S]*?material\.map = fallbackTexture[\s\S]*?material\.needsUpdate = true/);
  assert.match(capsuleJs, /return fallbackTexture;/);

  assert.match(styles, /\.capsule-walk/);
  assert.match(styles, /\.capsule-walk-canvas/);
  assert.match(styles, /\.capsule-walk-copy/);
  assert.match(styles, /\.capsule-walk-fallback/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.capsule-walk/);
  assert.match(styles, /\.capsule-view-tabs[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test('capsule 3D Walk uses cinematic stations with safe spacing and camera poses', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleHtml, /id="capsuleWalkViewButton"/);
  assert.match(capsuleHtml, /capsule\.js\?v=20260615-walk-audio-2/);
  assert.match(capsuleHtml, /styles\.css\?v=20260615-walk-audio-2/);

  assert.match(capsuleJs, /const SPATIAL_STATION_SPACING = 10/);
  assert.match(capsuleJs, /const SPATIAL_CAMERA_PULLBACK = 7/);
  assert.match(capsuleJs, /const SPATIAL_CAMERA_SAFE_PULLBACK = 1\.15/);
  assert.match(capsuleJs, /function getSpatialWalkStations/);
  assert.match(capsuleJs, /function buildSpatialStation/);
  assert.match(capsuleJs, /function getStationDisplaySize/);
  assert.match(capsuleJs, /function getStationMediaAspect/);
  assert.match(capsuleJs, /function updateSpatialStationMediaAspect/);
  assert.match(capsuleJs, /texture\?\.image/);
  assert.match(capsuleJs, /function stationItemIndex/);
  assert.match(capsuleJs, /itemIndex: stationItemIndex\(placement\.item\)/);
  assert.match(capsuleJs, /z: -index \* SPATIAL_STATION_SPACING/);
  assert.match(capsuleJs, /cameraPosition:/);
  assert.match(capsuleJs, /lookAt:/);
  assert.match(capsuleJs, /Math\.atan2\(cameraPosition\.x - focus\.x, cameraPosition\.z - focus\.z\)/);
  assert.match(capsuleJs, /function scrollSpatialWalkStageIntoView/);
  assert.match(capsuleJs, /scrollIntoView\(\{ block: "start", behavior: prefersReducedMotion\(\) \? "auto" : "smooth" \}\)/);
  assert.match(capsuleJs, /currentCapsuleView === "walk" && options\.userInitiated[\s\S]*?scrollSpatialWalkStageIntoView\(\)/);

  assert.match(styles, /\.capsule-walk-view-button/);
  assert.match(styles, /\.capsule-walk-card-media img[\s\S]*?object-fit: contain/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.capsule-walk-copy \{[\s\S]*?max-height: min\(34%, 232px\);[\s\S]*?overflow: hidden/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.capsule-walk-copy p \{[\s\S]*?-webkit-line-clamp: 3/);
});

test('capsule 3D Walk stations open the existing full-screen moment viewer', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /new THREE\.Raycaster\(\)/);
  assert.match(capsuleJs, /stationHitMeshes/);
  assert.match(capsuleJs, /canvas\.addEventListener\("pointermove", handleSpatialWalkPointerMove/);
  assert.match(capsuleJs, /canvas\.addEventListener\("click", handleSpatialWalkClick/);
  assert.match(capsuleJs, /#capsuleWalkViewButton/);
  assert.match(capsuleJs, /openSpatialWalkStation\(spatialActiveStationIndex\)/);
  assert.match(capsuleJs, /openSlide\(station\.itemIndex, \{ autoPlay: false \}\)/);
  assert.match(capsuleJs, /event\.key === "Enter"/);
  assert.match(capsuleJs, /event\.key === " "/);
  assert.match(capsuleJs, /scrollSpatialWalkToStation/);
  assert.match(capsuleJs, /data-walk-slide/);
});

test('capsule 3D Walk renders a lit, post-processed luxury gallery', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  // Import map so vendored addons resolve `three` + `three/addons/`.
  assert.match(capsuleHtml, /<script type="importmap">/);
  assert.match(capsuleHtml, /"three":\s*"\.\.\/vendor\/three\.module\.js"/);
  assert.match(capsuleHtml, /"three\/addons\/":\s*"\.\.\/vendor\/jsm\/"/);

  // Renderer / color science.
  assert.match(capsuleJs, /ACESFilmicToneMapping/);
  assert.match(capsuleJs, /toneMappingExposure/);
  assert.match(capsuleJs, /getMaxAnisotropy/);

  // Real lighting + materials.
  assert.match(capsuleJs, /MeshStandardMaterial/);
  assert.match(capsuleJs, /SpotLight/);
  assert.match(capsuleJs, /emissiveMap/);

  // Environment: floor, reflection, contact shadow, dust.
  assert.match(capsuleJs, /function addGalleryFloor/);
  assert.match(capsuleJs, /function addStationReflection/);
  assert.match(capsuleJs, /function addGalleryDust/);

  // Post-processing.
  assert.match(capsuleJs, /EffectComposer/);
  assert.match(capsuleJs, /UnrealBloomPass/);
  assert.match(capsuleJs, /composer\.render\(/);

  // Living camera + auto-tour.
  assert.match(capsuleJs, /function startSpatialWalkLoop/);
  assert.match(capsuleJs, /function renderSpatialWalkLoop/);
  assert.match(capsuleJs, /spatialTourPlaying/);
  assert.match(capsuleJs, /function toggleSpatialTour/);
  assert.match(capsuleJs, /pointerParallax|parallax/);
  assert.match(capsuleJs, /function playSpatialWalkArrival|arrivalProgress/);

  // Curatorial overlay sync + progress rail.
  assert.match(capsuleJs, /function updateSpatialWalkOverlay/);
  assert.match(capsuleHtml, /id="capsuleWalkChapter"/);
  assert.match(capsuleHtml, /id="capsuleWalkTitle"/);
  assert.match(capsuleHtml, /id="capsuleWalkCaption"/);
  assert.match(capsuleHtml, /id="capsuleWalkProgress"/);
  assert.match(capsuleHtml, /id="capsuleWalkTourToggle"/);

  // Styling hooks.
  assert.match(styles, /\.capsule-walk-progress/);
  assert.match(styles, /\.capsule-walk-vignette/);
});

test('capsule 3D Walk uses softer lighting and larger featured station scale', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /const SPATIAL_SPOTLIGHT_INTENSITY = spatialWalkQuality === "lite" \? 1\.45 : 1\.85/);
  assert.match(capsuleJs, /renderer\.toneMappingExposure = 0\.88/);
  assert.match(capsuleJs, /const SPATIAL_STATION_SIZE_MULTIPLIER = 1\.32/);
  assert.match(capsuleJs, /const SPATIAL_FEATURED_STATION_SCALE = 1\.16/);
  assert.match(capsuleJs, /station\.card\.material\.emissiveIntensity = isActive \? 0\.28 : near \? 0\.22 : 0\.16/);
});

test('capsule 3D Walk adds event-title world art, richer atmosphere, and fullscreen controls', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleHtml, /capsule\.js\?v=20260615-walk-audio-2/);
  assert.match(capsuleHtml, /id="capsuleWalkFullscreenButton"/);
  assert.match(capsuleJs, /qs\("#capsuleWalkFullscreenButton"\)\?\.addEventListener\("click", toggleSpatialWalkFullscreen\)/);
  assert.match(capsuleJs, /let nativeSpatialWalkFullscreenActive = false/);
  assert.match(capsuleJs, /function toggleSpatialWalkFullscreen/);
  assert.match(capsuleJs, /document\.body\.classList\.add\("is-native-spatial-walk"\)/);
  assert.match(capsuleJs, /function addSpatialEventTitleBackdrop/);
  assert.match(capsuleJs, /createSpatialTitleTexture/);
  assert.match(capsuleJs, /capsule\?\.eventTitle \|\| capsule\?\.title/);
  assert.match(capsuleJs, /function addGalleryAtmosphereStreams/);
  assert.match(capsuleJs, /const SPATIAL_DUST_PARTICLE_MULTIPLIER = 1\.75/);
  assert.match(styles, /\.capsule-walk-fullscreen-toggle/);
  assert.match(styles, /\.capsule-walk-controls \{[\s\S]*?top: clamp\(0\.85rem, 2vw, 1\.4rem\);[\s\S]*?bottom: auto;/);
  assert.match(styles, /\.capsule-walk:fullscreen/);
  assert.match(styles, /\.is-native-spatial-walk/);

  // Mobile / iOS fallback: a CSS pseudo-fullscreen when the element
  // Fullscreen API is unavailable.
  assert.match(capsuleJs, /function enterSpatialWalkCssFullscreen/);
  assert.match(capsuleJs, /function exitSpatialWalkCssFullscreen/);
  assert.match(capsuleJs, /function isSpatialWalkFullscreen/);
  assert.match(capsuleJs, /if \(!requestFullscreen\) \{[\s\S]*?enterSpatialWalkCssFullscreen\(\)/);
  assert.match(capsuleJs, /classList\.add\("is-spatial-walk-fullscreen"\)/);
  assert.match(styles, /\.capsule-viewer\.is-spatial-walk-fullscreen \.dashboard \{[\s\S]*?position: fixed/);
  assert.match(styles, /\.capsule-viewer\.is-spatial-walk-fullscreen \.capsule-walk \{[\s\S]*?height: 100dvh/);
});

test('capsule 3D Walk captions use only the guest\'s own words (no machine descriptions)', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /function getSpatialMomentCaption/);
  assert.match(capsuleJs, /return cleanCaptionText\(item\.caption \|\| item\.guestNote\)/);
  // The machine-written gallery descriptions are gone from the guest experience.
  assert.doesNotMatch(capsuleJs, /buildGalleryVisionCaption/);
  assert.doesNotMatch(capsuleJs, /item\.aiVision/);
  // The moment text still flows through one helper, used by the placard + a11y copy.
  assert.match(capsuleJs, /const caption = getSpatialMomentCaption\(placement\)/);
  assert.match(capsuleJs, /caption\.textContent = getSpatialMomentCaption\(station\)/);
});

test('capsule 3D Walk shows moment text on a 3D placard with an empty foreground', async () => {
  const [capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  // Name + message + date live on a 3D placard under each frame.
  assert.match(capsuleJs, /function addStationPlacard/);
  assert.match(capsuleJs, /function createStationPlacardTexture/);
  assert.match(capsuleJs, /repositionStationPlacard/);

  // Media vertical center derives from height so frames clear the floor (no cutoff).
  assert.match(capsuleJs, /function stationCenterY/);
  assert.match(capsuleJs, /displayHeight \/ 2 \+ SPATIAL_GROUND_CLEARANCE/);
  assert.match(capsuleJs, /station\.group\.position\.y = centerY/);

  // Atmosphere fills the space; the event title recurs beyond the end.
  assert.match(capsuleJs, /function addGalleryBackdrop/);
  assert.match(capsuleJs, /function addSpatialTitlePanel/);

  // The DOM copy is visually hidden so the foreground stays empty (a11y still served).
  assert.match(styles, /\.capsule-walk-copy \{[\s\S]*?clip-path: inset\(50%\)/);
});

test('capsule 3D Walk plays videos as WebGL video textures near the active station', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /new THREE\.VideoTexture\(video\)/);
  assert.match(capsuleJs, /function createSpatialVideoTexture/);
  assert.match(capsuleJs, /function configureSpatialVideoSource/);
  assert.match(capsuleJs, /window\.Hls/);
  assert.match(capsuleJs, /station\.video/);
  assert.match(capsuleJs, /function syncSpatialVideoPlayback/);
  assert.match(capsuleJs, /video\.play\(\)/);
  assert.match(capsuleJs, /video\.pause\(\)/);
  assert.match(capsuleJs, /pauseSpatialWalkVideos\(\)/);
  assert.match(capsuleJs, /texture\.needsUpdate = true/);
  assert.match(capsuleJs, /spatialTextureForItem\(THREE, station, isAudio, material/);
});

test('capsule 3D Walk auto tour holds videos for their playback duration', async () => {
  const [capsuleHtml, capsuleJs] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js')
  ]);

  assert.match(capsuleHtml, /capsule\.js\?v=20260615-walk-audio-2/);
  assert.match(capsuleJs, /const SPATIAL_TOUR_VIDEO_MIN_DWELL_MS = 8000/);
  assert.match(capsuleJs, /const SPATIAL_TOUR_VIDEO_FALLBACK_DWELL_MS = 31000/);
  assert.match(capsuleJs, /const SPATIAL_TOUR_VIDEO_MAX_DWELL_MS = 34000/);
  assert.match(capsuleJs, /function spatialTourDwellMsForStation/);
  assert.match(capsuleJs, /function getSpatialVideoDurationSeconds/);
  assert.match(capsuleJs, /station\.item\?\.durationSeconds/);
  assert.match(capsuleJs, /station\.video\?\.element\?\.duration/);
  assert.match(capsuleJs, /spatialTourHoldMs >= spatialTourDwellMsForStation\(spatialWalkStations\[spatialTourTarget\]\)/);
  // Advance the moment a clip finishes — no looping, no extra buffer.
  assert.match(capsuleJs, /function isSpatialMediaFinished/);
  assert.match(capsuleJs, /isSpatialMediaFinished\(targetStation\)/);
  assert.match(capsuleJs, /video\.loop = !spatialTourActive/);
  assert.match(capsuleJs, /const SPATIAL_TOUR_VIDEO_END_BUFFER_MS = 0/);
  assert.match(capsuleJs, /function resetSpatialStationPlayback/);
  // A finished clip must not replay during the tour (no loop-then-advance).
  assert.match(capsuleJs, /if \(spatialTourActive\) return;/);
});

test('capsule 3D Walk lets guests enable audio for WebGL video moments', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleHtml, /capsule\.js\?v=20260615-walk-audio-2/);
  assert.match(capsuleHtml, /styles\.css\?v=20260615-walk-audio-2/);
  assert.match(capsuleHtml, /id="capsuleWalkSoundButton"/);
  assert.match(capsuleJs, /let spatialWalkSoundUnlocked = false/);
  assert.match(capsuleJs, /qs\("#capsuleWalkSoundButton"\)\?\.addEventListener\("click", toggleSpatialWalkSound\)/);
  assert.match(capsuleJs, /function toggleSpatialWalkSound/);
  assert.match(capsuleJs, /spatialWalkSoundUnlocked = !spatialWalkSoundUnlocked/);
  // Icon toggle + voice-memo playback.
  assert.match(capsuleJs, /function spatialSoundIconMarkup/);
  assert.match(capsuleJs, /function syncSpatialAudioPlayback/);
  assert.match(capsuleJs, /function attachSpatialStationAudio/);
  assert.match(capsuleJs, /function updateSpatialVideoSoundState/);
  assert.match(capsuleJs, /video\.muted = !spatialWalkSoundUnlocked/);
  assert.match(capsuleJs, /video\.volume = spatialWalkSoundUnlocked \? 1 : 0/);
  assert.match(capsuleJs, /video\.removeAttribute\("muted"\)/);
  assert.match(capsuleJs, /video\.setAttribute\("muted", ""\)/);
  assert.match(capsuleJs, /updateSpatialWalkSoundButton\(\)/);
  assert.match(capsuleJs, /syncSpatialVideoPlayback\(activeStation, 0, true\)/);
  assert.match(styles, /\.capsule-walk-sound-toggle/);
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

  assert.match(capsuleHtml, /capsule\.js\?v=[^"]+/);
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

  assert.match(capsuleHtml, /capsule\.js\?v=[^"]+/);
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
  assert.match(capsuleHtml, /capsule\.js\?v=[^"]+/);
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
  assert.match(capsuleHtml, /styles\.css\?v=[^"]+/);
  assert.match(capsuleHtml, /<img src="\.\.\/\.\.\/assets\/williamson-wallflowers-logo\.png" alt="" \/>/);
  assert.match(capsuleHtml, /<strong>Wallflower Moments<\/strong>/);
  assert.match(capsuleHtml, /<span>Time Capsule<\/span>/);
  assert.doesNotMatch(capsuleHtml, /<strong>Wallflower Time Capsule<\/strong>/);
  assert.doesNotMatch(capsuleHtml, /private keepsake timeline/i);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.brand-lockup img[\s\S]*?width: 68px/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.site-topbar[\s\S]*?position: sticky/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.app-shell[\s\S]*?height: auto/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.dashboard[\s\S]*?overflow: visible/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.capsule-timeline[\s\S]*?overflow: visible/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.capsule-timeline[\s\S]*?grid-auto-rows: max-content/);
  assert.match(capsuleJs, /bindTimelineMediaAspects/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.capsule-memory-card \.media-thumb\.has-media-aspect[\s\S]*?aspect-ratio: var\(--media-aspect, 3 \/ 4\)/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.capsule-memory-card \.media-thumb img[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.capsule-viewer:not\(\.is-swipe-feed-active\) \.capsule-memory-card \.media-thumb video[\s\S]*?max-height: none/);
  assert.match(styles, /font-family: "Fiona", "Fiona Pro", "BF Fiona Serif"/);
  assert.match(capsuleHtml, /id="castTvPanel"/);
  assert.match(capsuleHtml, /id="startAirplayFullscreenButton"/);
  assert.match(capsuleHtml, /id="startChromecastButton"/);
  assert.match(capsuleHtml, /id="copyTvDisplayLinkButton"/);
  assert.match(capsuleJs, /const CAST_RECEIVER_APP_ID = "D4D06631"/);
  assert.doesNotMatch(capsuleJs, /Chromecast needs a registered receiver before the native Cast button appears/);
  assert.match(capsuleJs, /Chromecast receiver is configured/);
  assert.match(capsuleJs, /Open this Time Capsule in desktop Chrome or Android Chrome/);
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
  assert.match(castHtml, /id="castMusicToggle"/);
  assert.match(castHtml, /cast\.js\?v=20260601-tv-music-2/);
  assert.match(castJs, /const PHOTO_SLIDE_DURATION_MS = 20000/);
  assert.match(castJs, /\/capsules\/\$\{encodeURIComponent\(eventId\)\}/);
  assert.match(castJs, /function renderCastSlide/);
  assert.match(castJs, /function bindTvMediaOrientation/);
  assert.match(castJs, /item\.streamUrl \|\| item\.mediaUrl/);
  assert.match(castJs, /addEventListener\("ended", showNextCastSlide/);
});

test('TV display link starts with generated instrumental music enabled', async () => {
  const [capsuleJs, castHtml, castJs, styles] = await Promise.all([
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/capsule/cast/index.html'),
    readText('../../moments/capsule/cast/cast.js'),
    readText('../../moments/styles.css')
  ]);

  assert.match(capsuleJs, /url\.searchParams\.set\("music", "1"\)/);
  assert.match(castHtml, /id="castMusicToggle"/);
  assert.match(castHtml, /Instrumental music/);
  assert.match(castJs, /const musicRequested = getParam\("music"\) === "1"/);
  assert.match(castJs, /function startInstrumentalMusic/);
  assert.match(castJs, /function createInstrumentalMusicNodes/);
  assert.match(castJs, /function updateInstrumentalMusicForItem/);
  assert.match(castJs, /function setInstrumentalMusicLevel/);
  assert.match(castJs, /new AudioContext/);
  assert.match(castJs, /item\.mediaType === "photo"/);
  assert.match(castJs, /item\.mediaType === "audio"/);
  assert.match(styles, /\.cast-music-toggle/);
});

test('TV display music is audible and exposes playback state', async () => {
  const castJs = await readText('../../moments/capsule/cast/cast.js');

  assert.match(castJs, /const MUSIC_PHOTO_LEVEL = 0\.34/);
  assert.match(castJs, /const MUSIC_VIDEO_LEVEL = 0\.095/);
  assert.match(castJs, /function setMusicState/);
  assert.match(castJs, /document\.body\.dataset\.musicState/);
  assert.match(castJs, /setMusicState\("playing"\)/);
  assert.match(castJs, /function playInstrumentalPulse/);
  assert.match(castJs, /pulseOscillator/);
});

test('TV slideshow videos favor fullscreen mirroring instead of direct video AirPlay', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  assert.match(capsuleJs, /function prepareTvVideoForMirroring/);
  assert.match(capsuleJs, /disableRemotePlayback/);
  assert.match(capsuleJs, /x-webkit-airplay", "deny"/);
  assert.match(capsuleJs, /prepareTvVideoForMirroring\(video\)/);
});

test('capsule 3D Walk warms media by proximity, primes decode, and streams video lazily', async () => {
  const capsuleJs = await readText('../../moments/capsule/capsule.js');

  // Proximity warming instead of loading every station up-front.
  assert.match(capsuleJs, /const SPATIAL_MEDIA_WARM_RADIUS = 2/);
  assert.match(capsuleJs, /function warmSpatialStationMedia/);
  assert.match(capsuleJs, /station\.mediaState !== "idle"/);
  assert.match(capsuleJs, /if \(distance <= SPATIAL_MEDIA_WARM_RADIUS\) warmSpatialStationMedia\(station\)/);

  // Decode-primed, priority-hinted image loading (like the swipe feed).
  assert.match(capsuleJs, /image\.decoding = "async"/);
  assert.match(capsuleJs, /"fetchPriority" in image/);
  assert.match(capsuleJs, /image\.decode\(\)/);

  // Video element is created lazily when its station is reached, not at build.
  assert.match(capsuleJs, /if \(shouldPlay && !station\.video/);

  // HLS stream is preferred over downloading the whole file.
  assert.match(capsuleJs, /Prefer the adaptive HLS stream/);
  assert.match(capsuleJs, /const streamUrl = item\.streamUrl \|\| ""/);
});

async function readText(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
