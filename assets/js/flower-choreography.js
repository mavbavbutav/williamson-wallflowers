// Measured directly against the live homepage layout (getBoundingClientRect
// on every major content block, converted to scroll-fraction coordinates).
// Dense content: collection cards 0.168-0.477, details text/cards
// 0.520-0.667, booking text/calendar/form 0.711-0.919, contact info/form
// 0.962-1.159. Gaps between them: ~0.477-0.520, ~0.667-0.711, ~0.919-0.962.
//
// Two earlier passes kept the flower roughly parked in one screen position,
// semi-visible the whole time, fighting content the whole way down — and
// separately just sat there once past the hero, which read as vertically
// inert. This version does two things at once: `cameraOffsetY` climbs
// continuously and substantially across the whole scroll (not just within
// the hero), so the flower visibly descends with the page instead of
// hovering in one spot: and opacity doesn't just fade once and stay faint
// — it dips low through each dense block and *peeks back up* at each real
// gap between sections, so it breathes with the page's actual rhythm
// instead of receding permanently after the hero.
const KEYFRAMES = [
  { at: 0.0, bloom: 0.0, cameraDistance: 9.0, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0, opacity: 1.0 },
  { at: 0.05, bloom: 0.3, cameraDistance: 9.8, cameraOffsetX: 0.6, cameraOffsetY: 0.32, blur: 0.05, saturation: 0.98, opacity: 1.0 },
  { at: 0.1, bloom: 0.68, cameraDistance: 11.0, cameraOffsetX: 1.5, cameraOffsetY: 0.7, blur: 0.12, saturation: 0.94, opacity: 0.97 },
  { at: 0.15, bloom: 1.0, cameraDistance: 12.5, cameraOffsetX: 2.5, cameraOffsetY: 1.2, blur: 0.2, saturation: 0.9, opacity: 0.85 },
  { at: 0.22, bloom: 1.0, cameraDistance: 14.5, cameraOffsetX: 3.5, cameraOffsetY: 1.8, blur: 0.2, saturation: 0.85, opacity: 0.15 },
  { at: 0.5, bloom: 1.0, cameraDistance: 13.0, cameraOffsetX: 2.8, cameraOffsetY: 2.6, blur: 0.14, saturation: 0.88, opacity: 0.34 },
  { at: 0.6, bloom: 1.0, cameraDistance: 14.8, cameraOffsetX: 3.8, cameraOffsetY: 3.2, blur: 0.2, saturation: 0.85, opacity: 0.14 },
  { at: 0.69, bloom: 1.0, cameraDistance: 13.2, cameraOffsetX: 3.1, cameraOffsetY: 3.8, blur: 0.14, saturation: 0.88, opacity: 0.34 },
  { at: 0.8, bloom: 1.0, cameraDistance: 15.2, cameraOffsetX: 4.2, cameraOffsetY: 4.4, blur: 0.22, saturation: 0.8, opacity: 0.13 },
  { at: 0.94, bloom: 1.0, cameraDistance: 13.4, cameraOffsetX: 3.5, cameraOffsetY: 5.0, blur: 0.15, saturation: 0.85, opacity: 0.3 },
  { at: 1.0, bloom: 1.0, cameraDistance: 15.5, cameraOffsetX: 4.5, cameraOffsetY: 5.6, blur: 0.25, saturation: 0.7, opacity: 0.12 }
];

const FIELDS = ['bloom', 'cameraDistance', 'cameraOffsetX', 'cameraOffsetY', 'blur', 'saturation', 'opacity'];

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

// The keyframe table above is a *story* timeline: 0 is the top of the page,
// 0.15 is "the bloom has finished opening", 0.5/0.69/0.94 are the breathing
// gaps between sections, 1 is the end. Those story positions used to be
// hardcoded against one measurement of one layout, so adding a card or
// editing copy would silently desync the whole animation from the content.
//
// Instead, the scene measures where those milestones actually are in the
// live DOM and builds a map from real scroll position to story position.
// Any milestone that can't be measured falls back to its original fraction,
// so a missing element degrades one anchor rather than breaking everything.
export const STORY_ANCHORS = [
  { key: 'pageTop', story: 0 },
  { key: 'bloomEnd', story: 0.15 },
  { key: 'cardsDeep', story: 0.22 },
  { key: 'gapDetails', story: 0.5 },
  { key: 'detailsDeep', story: 0.6 },
  { key: 'gapBooking', story: 0.69 },
  { key: 'bookingDeep', story: 0.8 },
  { key: 'gapContact', story: 0.94 },
  { key: 'pageEnd', story: 1 }
];

export function buildScrollMap(measured = {}) {
  const points = [];
  let lastReal = -1;

  for (const anchor of STORY_ANCHORS) {
    let real;
    if (anchor.key === 'pageTop') real = 0;
    else if (anchor.key === 'pageEnd') real = 1;
    else real = measured[anchor.key];

    if (typeof real !== 'number' || !isFinite(real)) real = anchor.story;
    real = Math.min(1, Math.max(0, real));
    // Interpolation needs strictly increasing inputs; a mis-measured or
    // out-of-order anchor gets nudged rather than inverting the map.
    if (real <= lastReal) real = Math.min(1, lastReal + 0.001);

    points.push({ real, story: anchor.story });
    lastReal = real;
  }

  return points;
}

export function mapScrollToStory(scrollFraction, scrollMap) {
  const clamped = Math.min(1, Math.max(0, scrollFraction));
  if (!Array.isArray(scrollMap) || scrollMap.length < 2) return clamped;

  if (clamped <= scrollMap[0].real) return scrollMap[0].story;
  const last = scrollMap[scrollMap.length - 1];
  if (clamped >= last.real) return last.story;

  for (let i = 0; i < scrollMap.length - 1; i++) {
    const lower = scrollMap[i];
    const upper = scrollMap[i + 1];
    if (clamped >= lower.real && clamped <= upper.real) {
      const span = upper.real - lower.real;
      const t = span === 0 ? 0 : (clamped - lower.real) / span;
      return lower.story + (upper.story - lower.story) * t;
    }
  }

  return clamped;
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
