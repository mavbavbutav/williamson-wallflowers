# Homepage WebGL Bloom Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one continuous, scroll-driven 3D flower rendered full-bleed behind the entire homepage, per `docs/superpowers/specs/2026-09-22-homepage-webgl-bloom-scroll-design.md`.

**Architecture:** A pure, DOM-free choreography module maps scroll progress (0-1) to bloom/camera/blur/color values. A separate scene module consumes it, builds a procedural Three.js flower, and drives a `requestAnimationFrame` render loop. `index.html` gets a tiny feature-detection bootstrap that idle-loads the scene module only when safe (no reduced motion, WebGL present, no save-data), reusing the Three.js build already vendored at `moments/vendor/three.module.js`.

**Tech Stack:** Vanilla JS (ES modules), Three.js (vendored, no new dependency), Node's built-in test runner (`node --test`, matching `worker/tests/*.test.js` convention).

---

## File Structure

- Create: `assets/js/flower-choreography.js` — pure functions only (no DOM, no THREE import). Scroll-progress interpolation, feature-detection gate, quality profile. Fully unit-testable in Node.
- Create: `assets/js/flower-scene.js` — imports `flower-choreography.js` and the vendored THREE module; builds the procedural flower, wires scroll/resize/visibility listeners, runs the render loop. Not unit-tested (WebGL); verified by browser QA.
- Modify: `index.html:1939` — add a small inline bootstrap `<script>` right before `</body>` that feature-detects and idle-loads `flower-scene.js`.
- Create: `worker/tests/flower-choreography.test.js` — unit tests for the pure module, run via the existing `cd worker && npm test`.

---

### Task 1: Choreography module (pure functions, TDD)

**Files:**
- Create: `assets/js/flower-choreography.js`
- Test: `worker/tests/flower-choreography.test.js`

- [ ] **Step 1: Write the failing tests**

Create `worker/tests/flower-choreography.test.js`:

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeChoreography,
  shouldEnableFlowerScene,
  getQualityProfile
} from '../../assets/js/flower-choreography.js';

function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, got ${actual}`
  );
}

test('computeChoreography at progress 0 returns the closed-bud keyframe', () => {
  const result = computeChoreography(0);
  closeTo(result.bloom, 0.0, 'bloom');
  closeTo(result.cameraDistance, 6.0, 'cameraDistance');
  closeTo(result.cameraOffsetX, 0, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 0, 'cameraOffsetY');
  closeTo(result.blur, 0, 'blur');
  closeTo(result.saturation, 1.0, 'saturation');
});

test('computeChoreography at progress 1 returns the fully-bloomed keyframe', () => {
  const result = computeChoreography(1);
  closeTo(result.bloom, 1.0, 'bloom');
  closeTo(result.cameraDistance, 11.5, 'cameraDistance');
  closeTo(result.cameraOffsetX, 3.4, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 1.7, 'cameraOffsetY');
  closeTo(result.blur, 0.65, 'blur');
  closeTo(result.saturation, 0.65, 'saturation');
});

test('computeChoreography interpolates linearly between keyframes', () => {
  const result = computeChoreography(0.5);
  closeTo(result.bloom, 0.8, 'bloom');
  closeTo(result.cameraDistance, 8.0, 'cameraDistance');
  closeTo(result.cameraOffsetX, 1.25, 'cameraOffsetX');
  closeTo(result.cameraOffsetY, 0.6, 'cameraOffsetY');
  closeTo(result.blur, 0.175, 'blur');
  closeTo(result.saturation, 0.925, 'saturation');
});

test('computeChoreography clamps progress below 0 and above 1', () => {
  const below = computeChoreography(-0.4);
  const zero = computeChoreography(0);
  closeTo(below.bloom, zero.bloom, 'clamped-low bloom');
  closeTo(below.cameraDistance, zero.cameraDistance, 'clamped-low cameraDistance');

  const above = computeChoreography(1.9);
  const one = computeChoreography(1);
  closeTo(above.bloom, one.bloom, 'clamped-high bloom');
  closeTo(above.cameraDistance, one.cameraDistance, 'clamped-high cameraDistance');
});

test('shouldEnableFlowerScene is true only when every gate clears', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: false, hasWebGL: true, saveData: false }),
    true
  );
});

test('shouldEnableFlowerScene is false when reduced motion is preferred', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: true, hasWebGL: true, saveData: false }),
    false
  );
});

test('shouldEnableFlowerScene is false when WebGL is unavailable', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: false, hasWebGL: false, saveData: false }),
    false
  );
});

test('shouldEnableFlowerScene is false when save-data is on', () => {
  assert.equal(
    shouldEnableFlowerScene({ prefersReducedMotion: false, hasWebGL: true, saveData: true }),
    false
  );
});

test('getQualityProfile returns the mobile profile', () => {
  assert.deepEqual(getQualityProfile(true), {
    petalCount: 6,
    allowDolly: false,
    pixelRatioCap: 1.5
  });
});

test('getQualityProfile returns the desktop profile', () => {
  assert.deepEqual(getQualityProfile(false), {
    petalCount: 10,
    allowDolly: true,
    pixelRatioCap: 2
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../../assets/js/flower-choreography.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `assets/js/flower-choreography.js`:

```javascript
const KEYFRAMES = [
  { at: 0.0, bloom: 0.0, cameraDistance: 6.0, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0 },
  { at: 0.35, bloom: 0.7, cameraDistance: 6.5, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0 },
  { at: 0.65, bloom: 0.9, cameraDistance: 9.5, cameraOffsetX: 2.5, cameraOffsetY: 1.2, blur: 0.35, saturation: 0.85 },
  { at: 0.85, bloom: 1.0, cameraDistance: 11.0, cameraOffsetX: 3.2, cameraOffsetY: 1.6, blur: 0.6, saturation: 0.7 },
  { at: 1.0, bloom: 1.0, cameraDistance: 11.5, cameraOffsetX: 3.4, cameraOffsetY: 1.7, blur: 0.65, saturation: 0.65 }
];

const FIELDS = ['bloom', 'cameraDistance', 'cameraOffsetX', 'cameraOffsetY', 'blur', 'saturation'];

export function computeChoreography(progress) {
  const clamped = Math.min(1, Math.max(0, progress));

  let lower = KEYFRAMES[0];
  let upper = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (clamped >= KEYFRAMES[i].at && clamped <= KEYFRAMES[i + 1].at) {
      lower = KEYFRAMES[i];
      upper = KEYFRAMES[i + 1];
      break;
    }
  }

  const span = upper.at - lower.at;
  const t = span === 0 ? 0 : (clamped - lower.at) / span;

  const result = {};
  for (const field of FIELDS) {
    result[field] = lower[field] + (upper[field] - lower[field]) * t;
  }
  return result;
}

export function shouldEnableFlowerScene({ prefersReducedMotion, hasWebGL, saveData }) {
  if (prefersReducedMotion) return false;
  if (!hasWebGL) return false;
  if (saveData) return false;
  return true;
}

export function getQualityProfile(isMobile) {
  return isMobile
    ? { petalCount: 6, allowDolly: false, pixelRatioCap: 1.5 }
    : { petalCount: 10, allowDolly: true, pixelRatioCap: 2 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS — all `flower-choreography` tests green, existing worker tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add assets/js/flower-choreography.js worker/tests/flower-choreography.test.js
git commit -m "feat: add scroll-progress choreography for homepage flower"
```

---

### Task 2: Procedural Three.js flower scene

**Files:**
- Create: `assets/js/flower-scene.js`

- [ ] **Step 1: Write the scene module**

Create `assets/js/flower-scene.js`:

```javascript
import * as THREE from '../../moments/vendor/three.module.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js';

const CLOSED_TILT = -1.4;
const OPEN_TILT = -0.2;
const BASE_PETAL_COLOR = 0xeab4c6;
const LATE_PETAL_COLOR = 0xd79aa8;
const MOBILE_QUERY = '(max-width: 760px)';

function buildPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.38, 0.55, 0.38, 1.4, 0, 1.9);
  shape.bezierCurveTo(-0.38, 1.4, -0.38, 0.55, 0, 0);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
}

function buildFlower(quality) {
  const flower = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x7c9a68, roughness: 0.7 })
  );
  stem.position.y = -1.6;
  flower.add(stem);

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xf6c453, roughness: 0.5 })
  );
  flower.add(center);

  const petalGeometry = buildPetalGeometry();
  const pivots = [];
  for (let i = 0; i < quality.petalCount; i++) {
    const angle = ((Math.PI * 2) / quality.petalCount) * i;
    const pivot = new THREE.Object3D();
    pivot.rotation.y = angle;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(BASE_PETAL_COLOR),
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    const petal = new THREE.Mesh(petalGeometry, material);
    petal.position.set(0, 0, 0.34);
    petal.rotation.x = -Math.PI / 2;

    pivot.add(petal);
    flower.add(pivot);
    pivots.push(pivot);
  }

  return { flower, pivots };
}

function buildLights(scene) {
  scene.add(new THREE.AmbientLight(0xfff1e0, 0.7));
  const key = new THREE.DirectionalLight(0xffe6c8, 1.0);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8c9ff, 0.25);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
}

export function mount(root, win) {
  const doc = win.document;
  const isMobile = win.matchMedia(MOBILE_QUERY).matches;
  const quality = getQualityProfile(isMobile);

  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;transition:opacity 0.4s ease;';
  root.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, quality.pixelRatioCap));
  renderer.setSize(win.innerWidth, win.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, win.innerWidth / win.innerHeight, 0.1, 100);
  buildLights(scene);

  const { flower, pivots } = buildFlower(quality);
  scene.add(flower);

  const baseColor = new THREE.Color(BASE_PETAL_COLOR);
  const lateColor = new THREE.Color(LATE_PETAL_COLOR);

  function totalScrollableHeight() {
    return Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
  }

  function currentProgress() {
    return win.scrollY / totalScrollableHeight();
  }

  let visible = true;
  doc.addEventListener('visibilitychange', () => {
    visible = doc.visibilityState === 'visible';
  });

  function resize() {
    camera.aspect = win.innerWidth / win.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(win.innerWidth, win.innerHeight);
  }
  win.addEventListener('resize', resize);
  resize();

  let idleRotation = 0;

  function frame() {
    win.requestAnimationFrame(frame);
    if (!visible) return;

    const choreo = computeChoreography(currentProgress());

    for (const pivot of pivots) {
      const petal = pivot.children[0];
      petal.rotation.z = CLOSED_TILT + (OPEN_TILT - CLOSED_TILT) * choreo.bloom;
      petal.material.color.copy(baseColor).lerp(lateColor, 1 - choreo.saturation);
    }

    const dollyX = quality.allowDolly ? choreo.cameraOffsetX : 0;
    const dollyY = quality.allowDolly ? choreo.cameraOffsetY : 0.6;
    const distance = quality.allowDolly ? choreo.cameraDistance : 7.5;

    camera.position.set(dollyX, dollyY + 1.4, distance);
    camera.lookAt(0, 0.6, 0);

    idleRotation += 0.0015 + choreo.bloom * 0.001;
    flower.rotation.y = idleRotation;

    canvas.style.filter = choreo.blur > 0 ? `blur(${(choreo.blur * 6).toFixed(2)}px)` : '';
    canvas.style.opacity = String(1 - choreo.blur * 0.15);

    renderer.render(scene, camera);
  }

  win.requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check assets/js/flower-scene.js`
Expected: no output (exit code 0). `node --check` validates syntax only; the THREE/DOM-dependent code is exercised in Task 4's browser QA, not here.

- [ ] **Step 3: Commit**

```bash
git add assets/js/flower-scene.js
git commit -m "feat: add procedural Three.js flower scene renderer"
```

---

### Task 3: Wire the feature-detection bootstrap into index.html

**Files:**
- Modify: `index.html:1939` (immediately before `</body>`)

- [ ] **Step 1: Add the bootstrap script**

In `index.html`, insert this new `<script>` block right after the existing `</script>` that currently precedes `</body>` (i.e., between the closing `</script>` of the big inline script and `</body>`):

```html
  <script>
    (function () {
      function hasWebGL() {
        try {
          var canvas = document.createElement("canvas");
          return !!(
            window.WebGLRenderingContext &&
            (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
          );
        } catch (error) {
          return false;
        }
      }

      var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var saveData = !!(navigator.connection && navigator.connection.saveData);

      if (prefersReducedMotion || !hasWebGL() || saveData) return;

      function loadFlowerScene() {
        import("./assets/js/flower-scene.js?v=20260922-bloom-1").then(function (sceneModule) {
          import("./assets/js/flower-choreography.js?v=20260922-bloom-1").then(function (choreographyModule) {
            if (
              choreographyModule.shouldEnableFlowerScene({
                prefersReducedMotion: prefersReducedMotion,
                hasWebGL: hasWebGL(),
                saveData: saveData
              })
            ) {
              sceneModule.mount(document.body, window);
            }
          });
        });
      }

      window.addEventListener("load", function () {
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(loadFlowerScene, { timeout: 2000 });
        } else {
          setTimeout(loadFlowerScene, 300);
        }
      });
    })();
  </script>
```

- [ ] **Step 2: Update the internal import inside `flower-scene.js` to match the cache-busted path**

Modify `assets/js/flower-scene.js` line 2 (the `flower-choreography.js` import):

```javascript
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-1';
```

- [ ] **Step 3: Serve the site locally and load it**

Run: `python -m http.server 8765`
Then open `http://localhost:8765/` in a browser.
Expected: page loads normally; after ~load + idle, a flower fades in behind the content. No layout shift, no console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html assets/js/flower-scene.js
git commit -m "feat: idle-load the homepage flower scene behind a feature-detection gate"
```

---

### Task 4: Browser QA pass

**Files:** none (verification only)

- [ ] **Step 1: Desktop scroll-through**

With the local server running, scroll from top to bottom of `http://localhost:8765/`. Confirm:
- Flower starts as a closed bud behind the hero/collection cards, fully vivid and centered.
- By Details it has visibly drifted off-center and softened.
- By Booking/Contact it is fully bloomed, blurred, and clearly in the background — the calendar grid and form fields are fully legible with no visual overlap.
- No layout shift when the canvas appears.

- [ ] **Step 2: Mobile viewport**

Resize the browser (or use device emulation) to a phone width (~375-414px). Reload and scroll through. Confirm:
- Flower renders with fewer petals, no camera dolly (framing stays fixed while bloom/rotation still animate).
- No horizontal scroll/overflow introduced.
- Scrolling stays smooth (no visible jank).

- [ ] **Step 3: Reduced motion**

Enable "prefers-reduced-motion: reduce" (OS setting or browser devtools rendering emulation) and reload. Confirm:
- No canvas is inserted at all (check via devtools Elements panel — no stray `<canvas>` under `<body>`).
- Page looks and behaves exactly like the current production site.
- No console errors.

- [ ] **Step 4: Save-Data / no-WebGL simulation**

In devtools, force `navigator.connection.saveData` to `true` via the console (`Object.defineProperty(navigator, 'connection', { value: { saveData: true } })`) and reload. Confirm the flower does not load. Separately, verify the code path by temporarily renaming `WebGLRenderingContext` is not required — the `hasWebGL()` try/catch already covers unsupported browsers, so this can be confirmed by code review rather than forcing a WebGL failure.

- [ ] **Step 5: Regression check on existing features**

Confirm, with the flower scene active: nav menu toggle, booking calendar date selection, inquiry form submission (can stop short of actually submitting), and the existing `.reveal` fade-in animations on cards all still work exactly as before.

- [ ] **Step 6: Run the full worker test suite**

Run: `cd worker && npm test`
Expected: all tests pass, including the new `flower-choreography` tests.

- [ ] **Step 7: Final commit (if QA turned up fixes)**

```bash
git add -A
git commit -m "fix: address homepage flower scene QA findings"
```

(Skip this step if QA found nothing to fix.)

---

## Self-Review Notes

- **Spec coverage:** procedural geometry (Task 2), section choreography table (Task 1 keyframes), full-bleed fixed canvas below content (Task 2 `mount`), mobile simplified profile (Task 1 `getQualityProfile` + Task 2 `allowDolly` branch), reduced-motion/WebGL/save-data gating (Task 1 `shouldEnableFlowerScene` + Task 3 bootstrap), idle-load past `window.load` (Task 3), vendored Three.js reuse (Task 2 import path), cache-busted asset paths matching repo convention (Task 3), browser QA across desktop/mobile/reduced-motion/regressions (Task 4). No spec section is unaddressed.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code or exact commands.
- **Type consistency:** `computeChoreography` return fields (`bloom`, `cameraDistance`, `cameraOffsetX`, `cameraOffsetY`, `blur`, `saturation`) are used identically in `flower-scene.js`'s `frame()`. `getQualityProfile` fields (`petalCount`, `allowDolly`, `pixelRatioCap`) match between Task 1's implementation and Task 2's `buildFlower`/`mount` usage. `shouldEnableFlowerScene`'s parameter names match both call sites in Task 3.
