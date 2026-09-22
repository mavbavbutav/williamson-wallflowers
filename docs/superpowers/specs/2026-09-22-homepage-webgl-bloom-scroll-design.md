# Homepage WebGL Bloom Scroll Design

Date: 2026-09-22
Status: Approved design direction, awaiting implementation plan

## Summary

Add a single, continuous 3D flower to the public homepage (`index.html`) that lives in a fixed, full-bleed WebGL canvas behind the entire page. One `scrollProgress` value (0 to 1 across the full page height) drives everything about it: how open the petals are, where the camera sits, how blurred/dim it is, and its color tone. It starts as a closed bud behind the hero and is fully bloomed, softly lit, and idly rotating by the time a visitor reaches Contact. The effect should read as "the site feels alive and three-dimensional," not as a toy layered behind the page — existing content (cards, calendar, form) stays fully opaque and readable at all times.

This is scoped to the public homepage only. It does not touch the hidden Wallflower Moments 3D Walk in `moments/capsule/`, which already has its own cinematic WebGL experience (see `docs/superpowers/specs/2026-06-14-wallflower-cinematic-3d-walk-showcase-design.md`).

## Approved Direction

Full-bleed pinned background (not a side rail, not a small corner companion, not confined to the hero) — chosen deliberately for immersion, with distraction risk managed through camera choreography and layout, not by shrinking the canvas.

## Experience

**Concept:** One procedurally-built flower (stem, center, petals — built from Three.js geometry, no external 3D model/texture asset) rendered in a `position: fixed`, full-viewport `<canvas>` behind all page content (`z-index` below `main`). As the visitor scrolls the whole page, a single normalized scroll-progress value continuously drives:

- **Bloom %** — petal hinge rotation, closed bud to full bloom.
- **Camera** — position/distance, panning from centered-and-close (hero) to pulled-back-and-off-center (later sections).
- **Focus/opacity** — sharp and vivid early, softly blurred and lower-contrast later so it recedes into atmosphere rather than fighting text.
- **Color** — petal palette shifts subtly section to section, echoing the brand palette (blush/champagne near the top, deepening slightly by Contact) instead of staying static.

**Choreography by section** (existing section IDs: `#collection`, `#details`, `#booking`, `#contact`):

| Section | Bloom % | Camera | Look |
|---|---|---|---|
| `#collection` (hero + cards) | Closed → ~70% open | Centered, close | Large, vivid, main focal point |
| `#details` | ~70% → 90% | Drifts to a back corner, dollies out | Softer, smaller, negative-space only |
| `#booking` | ~90% → 100% | Further back, slight blur | Ambient — calendar/form stay fully opaque on top |
| `#contact` | Fully bloomed, gentle idle rotation | Settled, blurred, low contrast | Background texture only |

Camera and bloom values are keyframed at each section's scroll-start position and linearly interpolated (eased) between keyframes as `scrollProgress` moves, not tied to fixed pixel offsets, so it holds up regardless of content height changes.

**Distraction mitigation:**

- All existing content containers (`.card`, `.section-soft`, the booking calendar, the inquiry form) keep their current opaque/solid backgrounds — nothing becomes transparent to "show" the flower. The flower is only ever visible in the negative space around content, never through it.
- The flower actively recedes (scale down, blur up, desaturate, dolly back) once a section stops being primarily narrative (i.e., starting at `#details`), so it's most vivid exactly where there's the least competing text/UI.
- Petal colors stay within the site's existing palette family so it reads as intentional brand texture, not a generic 3D demo.

## Mobile

Mobile keeps the same full-bleed WebGL background (per approved direction) but simplified, detected via `matchMedia` viewport width (not user-agent sniffing):

- Fewer petals (6 instead of 10).
- No camera dolly — fixed camera position/framing; only bloom progression and a gentle idle rotation apply.
- Lower device pixel ratio cap and lower render resolution than desktop.

## Architecture

- New file `assets/js/flower-scene.js` (ES module) contains all scene setup, the scroll-progress calculation, the choreography keyframes, and the render loop.
- Reuse the Three.js build already vendored in this repo at `moments/vendor/three.module.js` (dynamic `import()`, same pattern used by `moments/capsule/capsule.js`) rather than adding a second copy of the library or a third-party CDN dependency. One shared, self-hosted copy, no new external network dependency.
- `index.html` gets a small inline bootstrap (a few lines, not the full scene) that:
  1. Checks `prefers-reduced-motion`, WebGL support, and `navigator.connection?.saveData`.
  2. If all clear, waits for `window.load` (or `requestIdleCallback` where available) before dynamically importing `assets/js/flower-scene.js`, so the flower never competes with first paint / LCP for bandwidth or main-thread time.
  3. If WebGL/reduced-motion checks fail, falls back per the Fallbacks section below and never loads Three.js at all.
- `<canvas>` is inserted by the module itself (not hardcoded in HTML), `position: fixed; inset: 0; z-index: -1; pointer-events: none;`, so it never blocks clicks/taps on real content and there's no layout shift if it fails to load.

## Performance

- Scroll position is read via `requestAnimationFrame`, never computed directly inside the `scroll` event handler.
- Render loop pauses via the Page Visibility API when the tab is hidden.
- No texture/model downloads — everything is procedural geometry, so there's no asset fetch blocking first render once the module starts.
- Vendored Three.js module is fetched once, deferred past `window.load`, and benefits from normal HTTP caching/gzip on repeat views and across pages that also use it (Moments).

## Accessibility & Fallbacks

- `prefers-reduced-motion: reduce`: the flower is never loaded at all — matches the existing `.reveal` behavior on this page (skip animation, show final state), applied here as "skip the animated background entirely."
- No WebGL support, WebGL context creation failure, or `saveData` on: flower is skipped; page renders exactly as it does today, no visual gap or placeholder needed since the canvas is purely decorative.
- Canvas is `aria-hidden="true"` and `pointer-events: none` at all times — never an interaction target, never announced to assistive tech.

## Testing

Browser QA (per `AGENTS.md` — `python -m http.server 8765`, checked on both desktop and mobile viewport sizes):

- Desktop: flower is visible and blooms progressively from hero through contact; no visual overlap with card text, calendar cells, or form fields at any scroll position.
- Mobile: flower renders at reduced complexity, no jank while scrolling, no horizontal overflow introduced.
- `prefers-reduced-motion: reduce` emulated: no canvas is inserted, no console errors, page looks and behaves exactly as the current production site.
- Throttled/slow network or `Save-Data` header emulated: flower does not load; core content (especially the inquiry form) is usable immediately and is never blocked waiting on it.
- Console: no errors/warnings from the new module in any of the above states.
- Existing functionality unaffected: booking calendar, inquiry form submission, nav menu toggle, and existing `.reveal` scroll animations all continue to work exactly as before.

## Out of Scope

- Any change to `moments/` (hidden Moments surfaces, host/admin flows, or the existing 3D Walk) — this feature is homepage-only.
- A real/authored 3D flower model or textures — geometry is procedural.
- User-facing controls to pause, hide, or replay the animation.
- Sound.

## Implementation Notes

Likely implementation path:

1. Add `assets/js/flower-scene.js` with scene setup (renderer, camera, lights, procedural flower group with hinged petals), the scroll-progress → choreography mapping, and the render loop with visibility-pause handling.
2. Add the small inline feature-detection/idle-load bootstrap to `index.html`.
3. Wire desktop vs. mobile parameter sets (petal count, dolly on/off, pixel ratio cap) via a `matchMedia` check inside the module.
4. Validate visually against every section on desktop and a narrow mobile viewport, with and without `prefers-reduced-motion`.
5. Confirm no regression to the booking calendar, inquiry form, or existing reveal animations.
