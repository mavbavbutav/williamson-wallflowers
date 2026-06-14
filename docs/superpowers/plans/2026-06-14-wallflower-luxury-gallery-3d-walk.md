# Wallflower Luxury Gallery 3D Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the Time Capsule `3D Walk` from a flat, scroll-scrubbed station viewer into an immersive, high-end **luxury private-gallery** experience: spotlit framed art on a polished reflecting floor, atmospheric dust and bloom, a living camera (idle float + parallax + cinematic arrival), an optional guided auto-tour, and a curatorial overlay that names the moment you are standing in front of.

**Direction decided with the user (2026-06-14):**
- Aesthetic: **Luxury gallery** (dark room, pools of light, reflective floor, museum frames).
- Post-processing: **Vendor Three.js r165 addons** for true UnrealBloom (+ optional subtle DOF). Resolve via an HTML import map so addons stay unmodified.
- Motion: **Both** a guided auto-tour (play/pause) and scroll/keyboard scrubbing, plus pointer parallax and idle float.

**Architecture principle:** Keep the backend spatial generator and the existing `openSlide` modal untouched. All change is in the guest renderer (`capsule.js`), its markup (`index.html`), styles (`styles.css`), vendored addons (`moments/vendor/jsm/`), and the static-contract tests (`worker/tests/capsule-viewer.test.js`). Everything degrades cleanly to the existing static fallback under reduced-motion, no-WebGL, or addon-load failure.

**Tech stack:** Static ES module JS, Three.js r165 (vendored core + vendored addons), CSS, Node test runner, Cloudflare Worker package scripts. New: a `<script type="importmap">` in `index.html`; new render loop replaces the on-demand frame model while the walk is active.

---

## Current-State Findings (baseline to fix)

- **Lights are inert.** `AmbientLight`/`DirectionalLight` are added (`capsule.js` ~L708) but every mesh uses unlit `MeshBasicMaterial` — no depth shading, no rim light, no spotlight drama.
- **No environment.** No floor, reflection, contact shadow, or 3D backdrop. Transparent canvas (`setClearColor(…,0)`) floats planes over a CSS gradient → reads flat.
- **No tone mapping / bloom / DOF.** Raw color, no glow on highlights.
- **Dead camera.** Pure `scrollTop` scrub (`renderSpatialWalkFrame` / `getSpatialScrollProgress`). Still when idle; no parallax, no arrival, no breathing.
- **Story hidden.** Overlay copy is hardcoded in `index.html` and never updates; only the button label changes. Active title/caption/chapter/date never shown; no progress rail.
- **Fake frames.** A single tinted plane at 24% opacity behind each photo; textures load without anisotropy.

---

## File Structure

- Modify `moments/capsule/capsule.js`: renderer tone-mapping + color; PBR/lit materials; museum frame build; floor + faked reflection + contact shadow; dust motes; spotlight that tracks the active station; vendored post-processing composer (bloom + optional DOF) with safe fallback; continuous render loop; damped camera with idle float + pointer parallax; cinematic arrival; auto-tour state machine (play/pause, idle-resume); active-station overlay sync; quality tiering for mobile; `visibilitychange` pause.
- Modify `moments/capsule/index.html`: add the import map; richer overlay markup (chapter pill, serif title, caption, date); tour play/pause control; progress rail container; asset version bump to `20260614-luxury-gallery-1`.
- Modify `moments/styles.css`: overlay typography + animated station transitions; progress rail + dots; tour/CTA controls; CSS vignette over the viewport; mobile refinements; reduced-motion guards.
- Add `moments/vendor/jsm/...`: the minimal r165 postprocessing addon set (see Task 2).
- Modify `worker/tests/capsule-viewer.test.js`: update version string; add assertions for the new symbols and the import map; retune any asserted constants that change.
- Do **not** touch `moments/admin/*`, the worker backend spatial generator, `AGENTS.md`, `CLAUDE.md`, or unrelated plans.

---

## Task 1: Lock the New Contract Tests (Red First)

**Files:** Modify `worker/tests/capsule-viewer.test.js`

- [ ] **Step 1: Bump the version assertions** from `20260614-cinematic-stations-1` to `20260614-luxury-gallery-1` in every place the test checks the html (`styles.css?v=` and `capsule.js?v=`).

- [ ] **Step 2: Add a luxury-gallery contract test** asserting the high-end building blocks exist in source (regex style, matching this repo's pattern):

```js
test('capsule 3D Walk renders a lit, post-processed luxury gallery', async () => {
  const [capsuleHtml, capsuleJs, styles] = await Promise.all([
    readText('../../moments/capsule/index.html'),
    readText('../../moments/capsule/capsule.js'),
    readText('../../moments/styles.css')
  ]);

  // Import map so vendored addons resolve `three` + `three/addons/`.
  assert.match(capsuleHtml, /<script type="importmap">/);
  assert.match(capsuleHtml, /"three":\s*"\.\/(?:\.\.\/)*vendor\/three\.module\.js"/);
  assert.match(capsuleHtml, /"three\/addons\/":/);

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
```

- [ ] **Step 3: Preserve still-valid assertions.** Keep the existing `cinematic stations` and `open the existing full-screen moment viewer` tests, but update any constant they pin if Task 5 retunes it (e.g. `SPATIAL_CAMERA_PULLBACK`). The contract must stay honest — if a value changes, change it here too in the same commit.

- [ ] **Step 4: Run and confirm red.**

```powershell
npm --prefix worker test -- capsule-viewer.test.js
```

Expected: fails on the new symbols/version (addons, tone mapping, overlay ids, import map).

---

## Task 2: Vendor the Post-Processing Addons + Import Map

**Files:** Add `moments/vendor/jsm/**`; Modify `moments/capsule/index.html`

- [ ] **Step 1: Fetch the exact r165 addon set** into `moments/vendor/jsm/` (must match the vendored core revision `165`). Minimal UnrealBloom dependency closure:

```
vendor/jsm/postprocessing/EffectComposer.js
vendor/jsm/postprocessing/Pass.js
vendor/jsm/postprocessing/RenderPass.js
vendor/jsm/postprocessing/ShaderPass.js
vendor/jsm/postprocessing/MaskPass.js
vendor/jsm/postprocessing/UnrealBloomPass.js
vendor/jsm/postprocessing/OutputPass.js
vendor/jsm/shaders/CopyShader.js
vendor/jsm/shaders/LuminosityHighPassShader.js
vendor/jsm/shaders/OutputShader.js
```

Source: the `three@0.165.0` examples/jsm tree (e.g. `https://unpkg.com/three@0.165.0/examples/jsm/...`). Do **not** hand-edit these files — they `import … from 'three'` and `from 'three/addons/...'`, which the import map resolves. (Optional DOF in Task 4 additionally needs `postprocessing/BokehPass.js` + `shaders/BokehShader.js`; only fetch if DOF is kept.)

- [ ] **Step 2: Add the import map** to `index.html` `<head>`, **before** the module script tag. Paths are relative to `moments/capsule/`:

```html
<script type="importmap">
{
  "imports": {
    "three": "../vendor/three.module.js",
    "three/addons/": "../vendor/jsm/"
  }
}
</script>
```

Singleton note: `capsule.js` keeps its existing `import("../vendor/three.module.js")` (the test still asserts that exact string), and the addons resolve `'three'` to the *same* URL via the map → one `THREE` instance, no duplication.

- [ ] **Step 3: Bump asset versions** in `index.html` to `?v=20260614-luxury-gallery-1` for both `styles.css` and `capsule.js`.

- [ ] **Step 4: Syntax + focused tests.**

```powershell
npm --prefix worker run check
npm --prefix worker test -- capsule-viewer.test.js
```

Expected: import-map + version assertions pass; JS-symbol assertions still fail.

---

## Task 3: Lit Materials, Museum Frames, Floor + Reflection, Atmosphere

**Files:** Modify `moments/capsule/capsule.js`

- [ ] **Step 1: Upgrade the renderer** in `buildSpatialWalkScene` — opaque dark room, ACES tone mapping, exposure, max-quality color:

```js
renderer.setClearColor(0x100e0d, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

Set scene fog to the room color (`THREE.Fog(0x100e0d, 14, …)`) so far frames dissolve into the dark.

- [ ] **Step 2: Replace inert lights** with a gallery rig: a low `HemisphereLight` (cool sky / warm floor) for base fill, a warm fixed key, a cool rim, **plus a moving `SpotLight`** (penumbra ~0.45, angle ~0.5, warm) that the loop re-aims at the active station each frame to create the signature pool of light. Store it on `spatialWalkScene.spot` + `spatialWalkScene.spotTarget`.

- [ ] **Step 3: Lit photo + museum frame in `addSpatialStationMesh`.**
  - Photo plane → `MeshStandardMaterial` with `map`, `emissiveMap = map`, `emissive = 0xffffff`, `emissiveIntensity ≈ 0.5`, `roughness ≈ 0.55`, `metalness 0`. (Emissive floor keeps prints readable in a dark room; the spotlight adds falloff/highlight; bloom threshold stays high so prints don't blow out.)
  - Texture quality on load: `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()`, `texture.generateMipmaps = true`, `texture.minFilter = THREE.LinearMipmapLinearFilter`. (Apply in `spatialTextureForItem`'s `loader.load` success path.)
  - Frame: a warm matte mat (`MeshStandardMaterial`, `color 0xf4ece2`, `roughness 0.9`) slightly larger than the photo, plus a thin brushed-brass inner bevel (`metalness ~0.6`, `roughness ~0.35`, warm tone) for the museum look. Keep the existing per-cluster `tint` as the mat accent.
  - Keep the invisible `hitArea` for raycasting unchanged.

- [ ] **Step 4: Add `addGalleryFloor(THREE, scene, stations)`** — a large floor plane at `y = 0` (`MeshStandardMaterial`, dark, `roughness ~0.5`) with a radial gradient canvas texture that brightens under the route. This grounds the art.

- [ ] **Step 5: Add `addStationReflection(THREE, group, station)`** — a vertically-mirrored, dimmed duplicate of the frame group below the floor line (opacity ~0.18, fades with distance), giving a polished-floor reflection without a heavy `Reflector`/render-target. Plus `addStationContactShadow` — a soft dark radial sprite directly under each frame.

- [ ] **Step 6: Add `addGalleryDust(THREE, scene)`** — ~300 `THREE.Points` with a soft circular sprite, `AdditiveBlending`, low opacity, drifting slowly in the lit volume (animated in the loop). Subtle — this is the "expensive air."

- [ ] **Step 7: Quality tiering.** Add `getWalkQuality()` returning `"high"` on desktop / `"lite"` on coarse-pointer or small-viewport devices. In lite mode: skip reflections, halve dust, lower bloom, cap pixel ratio harder. Reduced-motion already routes to the static fallback.

- [ ] **Step 8: Syntax check.**

```powershell
npm --prefix worker run check
```

---

## Task 4: Post-Processing Composer (Bloom + optional DOF) with Safe Fallback

**Files:** Modify `moments/capsule/capsule.js`

- [ ] **Step 1: Build the composer** after the scene/camera in `buildSpatialWalkScene` (only in `"high"` quality), guarded so any failure falls back to plain `renderer.render`:

```js
async function buildSpatialWalkComposer(THREE, renderer, scene, camera, size) {
  const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
  const { RenderPass } = await import("three/addons/postprocessing/RenderPass.js");
  const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
  const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.45, 0.6, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // applies tone mapping + sRGB once, in the right order
  return { composer, bloom };
}
```

Wrap the call in `try/catch`; on failure leave `spatialWalkScene.composer = null` and the loop renders directly. Tune bloom `threshold` high so only spotlit frame edges, brass bevels, and dust glow — not the whole photo.

- [ ] **Step 2: Resize the composer** in `resizeSpatialWalkScene` — `composer?.setSize(w, h)` and `bloom?.setSize(w, h)` alongside the renderer/camera updates.

- [ ] **Step 3: (Optional) subtle DOF.** If kept, add `BokehPass` before `OutputPass` with a gentle `maxblur` and focus distance lerped to the active station so far frames soften. Gate to `"high"` quality; remove if QA shows cost/artifacts. (Skip the BokehPass addon fetch in Task 2 if dropping this.)

- [ ] **Step 4: Syntax check.**

```powershell
npm --prefix worker run check
```

---

## Task 5: Living Camera, Auto-Tour, and Cinematic Arrival

**Files:** Modify `moments/capsule/capsule.js`

- [ ] **Step 1: Replace the on-demand frame model with a continuous loop** while the walk is active. Add `startSpatialWalkLoop()` / `stopSpatialWalkLoop()` (rAF, driven by `performance.now()` delta). Start it from `setCapsuleView` when entering `"walk"`; stop it when leaving and on `document` `visibilitychange` (hidden). Keep `requestSpatialWalkFrame` as a one-shot nudge that simply ensures the loop is running.

- [ ] **Step 2: Damped camera.** Each frame compute a `targetCamera` / `targetLookAt` from the **active progress source** (auto-tour progress if playing, else scroll progress), then critically-damp the live camera toward it (frame-rate-independent lerp via the delta). This removes the mechanical snap and adds weight.

- [ ] **Step 3: Idle float + breathing + pointer parallax.** Add small time-based sin/cos offsets to camera position and lookAt (amplitude ~0.06) and a slow breathing dolly so the scene is alive when idle. Track normalized pointer (`pointermove` on the canvas) and offset the camera toward it (small, damped) for parallax. Respect reduced-motion (amplitudes → 0).

- [ ] **Step 4: Auto-tour state machine.** Add `spatialTourPlaying`, a normalized `tourProgress` that advances over time with a dwell at each station and eased segment transitions, and `toggleSpatialTour()`. User scrubbing (scroll / arrow keys / dot click / drag) **pauses** the tour and resumes it after an idle timeout (e.g. 6s). When touring, drive `progress` directly and reflect it into the active-station index; keep the scroll spacer for native scrub feel.

- [ ] **Step 5: Cinematic arrival.** On first entry to the walk, run `playSpatialWalkArrival()` — start the camera farther back/lower and ease to station 0 over ~1.6s before normal control engages. One-time per session.

- [ ] **Step 6: Moving spotlight.** In the loop, lerp `spatialWalkScene.spot` + `spotTarget` toward the active station so the pool of light follows the user. (DOF focus, if enabled, lerps the same way.)

- [ ] **Step 7: Swap the render call.** In the loop, `spatialWalkScene.composer ? composer.render() : renderer.render(scene, camera)`. Animate dust drift + reflection fade here too.

- [ ] **Step 8: Syntax + focused tests.**

```powershell
npm --prefix worker run check
npm --prefix worker test -- capsule-viewer.test.js
```

Expected: camera/tour/composer assertions pass; overlay assertions may still fail.

---

## Task 6: Curatorial Overlay, Progress Rail, and Tour Controls

**Files:** Modify `moments/capsule/index.html`, `moments/capsule/capsule.js`, `moments/styles.css`

- [ ] **Step 1: Richer overlay markup** inside `.capsule-walk-viewport` — replace the static copy with identified nodes the JS will fill:

```html
<div class="capsule-walk-copy" aria-live="polite">
  <span class="status-pill" id="capsuleWalkChapter">3D Walk</span>
  <strong id="capsuleWalkTitle">A spatial path through these moments</strong>
  <p id="capsuleWalkCaption">Scroll, or let the gallery tour guide you.</p>
  <small id="capsuleWalkDate"></small>
</div>
<div class="capsule-walk-controls">
  <button class="button button-secondary capsule-walk-tour-toggle" type="button" id="capsuleWalkTourToggle" aria-pressed="true">Pause tour</button>
  <!-- existing #capsuleWalkViewButton stays as the primary CTA -->
</div>
<nav class="capsule-walk-progress" id="capsuleWalkProgress" aria-label="Gallery progress"></nav>
```

- [ ] **Step 2: `updateSpatialWalkOverlay()`** — when the active station changes (call from `updateSpatialStationFocus`), set chapter/title/caption/date from the active item and toggle a transition class for a fade/slide swap. Update the `View NN` CTA label/aria as today.

- [ ] **Step 3: Progress rail.** Render one dot per station into `#capsuleWalkProgress`; mark the active dot; clicking a dot tours/scrubs to that station (`scrollSpatialWalkToStation` + pause tour). Keyboard-focusable.

- [ ] **Step 4: Wire the tour toggle** in `init()` to `toggleSpatialTour()`; update its label/`aria-pressed` from tour state.

- [ ] **Step 5: Styles** in `styles.css` — animated `.capsule-walk-copy` transitions (opacity + small translate on change), `.capsule-walk-progress` rail + dots, `.capsule-walk-controls` row, a `.capsule-walk-vignette` overlay (radial darkening at the viewport edges — cheap, reliable, very "cinema"), and mobile refinements (rail/dots and controls sized for touch, safe-area insets, reduced amplitudes under `prefers-reduced-motion`).

- [ ] **Step 6: Focused tests.**

```powershell
npm --prefix worker test -- capsule-viewer.test.js
```

Expected: all `capsule-viewer.test.js` tests pass.

---

## Task 7: Browser QA and Tuning

**Files:** Modify only on QA findings: `capsule.js`, `styles.css`, `worker/tests/capsule-viewer.test.js`

- [ ] **Step 1: Serve locally.** `python -m http.server 8765` from the site root (fallback `8766`).

- [ ] **Step 2: Open a known capsule** (use the Playwright MCP) at:
  `http://localhost:8765/moments/capsule/?event=<EVENT_ID>#token=<SHARE_TOKEN>` (use a real published event + its share token from the host dashboard; do not commit the token).

- [ ] **Step 3: Desktop QA checklist.**
  - The active frame sits in a pool of spotlight on a reflective floor; bloom glows highlights/dust only (prints not blown out).
  - Camera breathes/parallaxes when idle; arrival plays once on open.
  - Auto-tour advances and dwells; scrubbing pauses it and it resumes after idle.
  - Overlay names the active moment (chapter/title/caption/date) and transitions on change; progress dots track + are clickable.
  - Click a frame / press Enter / the CTA opens the existing slideshow at the right item.
  - No console errors; addons resolved via the import map (no 404s, single THREE instance).

- [ ] **Step 4: Mobile QA (~390x844).** Lite tier active (no reflection / reduced dust / lower bloom); no horizontal overflow; controls + dots reachable above safe-area; CTA opens the slideshow; acceptable frame rate.

- [ ] **Step 5: Degradation QA.** Force `prefers-reduced-motion` → static path with uncropped media + working card clicks. Simulate addon import failure (rename a vendor file) → scene still renders via plain `renderer.render`, no crash. Simulate no-WebGL → static fallback.

- [ ] **Step 6: Full suite + syntax.**

```powershell
npm --prefix worker test
npm --prefix worker run check
```

- [ ] **Step 7: Commit QA tuning** only if QA changed code/CSS/tests (keep any retuned constant in sync with the test).

---

## Task 8: Release Handoff

- [ ] **Step 1: Review the diff** (`git status`, `git diff`) — confirm only the intended files changed, vendored addons are unmodified upstream copies, no secrets, admin untouched.
- [ ] **Step 2: Push + deploy only with explicit user approval.** Confirm the publication path for `moments/capsule` (GitHub Pages build vs. Cloudflare Pages direct upload per memory) before assuming the worker deploy publishes static assets.
- [ ] **Step 3: Verify the live route** references `20260614-luxury-gallery-1` and the gallery renders + opens full-screen after deploy.

---

## Self-Review

- **Spec coverage:** Tasks 3–4 deliver the luxury look (lit PBR frames, spotlights, reflective floor, dust, bloom/DOF). Task 5 delivers the living camera + auto-tour + arrival. Task 6 delivers the curatorial overlay + progress rail + vignette. Tasks 1/7 keep the static contract honest and verify across desktop/mobile/degraded paths.
- **Risk controls:** Backend generator and `openSlide` modal untouched; composer + addons fail safe to plain render; quality tiering + reduced-motion protect mobile/low-end; import map keeps a single `THREE` instance and unmodified vendored addons; continuous loop pauses on hidden tab and on leaving the walk.
- **Open tuning knobs (decide in QA):** bloom threshold/strength, exposure, emissive intensity (print readability), spotlight angle/penumbra, idle-float amplitude, tour dwell time + idle-resume delay, whether to keep BokehPass DOF.
- **Validation:** focused `capsule-viewer.test.js` → full worker suite → `node --check` → browser QA at desktop + mobile + degraded.
