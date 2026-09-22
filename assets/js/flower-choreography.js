// Measured directly against the live homepage layout (getBoundingClientRect
// on every major content block, converted to scroll-fraction coordinates).
// The reality: outside the hero, this page is almost entirely dense content
// — the collection cards run 0.168-0.477, details text/cards run
// 0.520-0.667, booking text/calendar/form run 0.711-0.919, contact
// info/form run 0.962-1.159 — with only narrow ~4% gaps between them.
// There is no scroll position past the hero where a recognizably-shaped,
// clearly-visible flower can sit without crossing *something*. Two earlier
// passes tried to dodge content with camera panning + blur while staying
// semi-visible everywhere, and kept losing that fight.
//
// The fix is a design decision, not another camera nudge: the flower tells
// its bloom story in the hero (where there's real room for it), then fades
// to a genuinely faint ambient presence — opacity ~0.12-0.16, not a
// half-measure ~0.7 — for the rest of the page. At that opacity, crossing a
// card edge or a heading reads as a soft wash of color, not a shape
// competing with content. It keeps drifting/swaying (still "alive"), it
// just isn't trying to be seen anymore once the page gets busy.
const KEYFRAMES = [
  { at: 0.0, bloom: 0.0, cameraDistance: 9.0, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0, opacity: 1.0 },
  { at: 0.07, bloom: 0.9, cameraDistance: 10.5, cameraOffsetX: 1.0, cameraOffsetY: 0.5, blur: 0.1, saturation: 0.95, opacity: 1.0 },
  { at: 0.15, bloom: 1.0, cameraDistance: 12.5, cameraOffsetX: 2.5, cameraOffsetY: 1.2, blur: 0.2, saturation: 0.9, opacity: 0.85 },
  { at: 0.22, bloom: 1.0, cameraDistance: 14.5, cameraOffsetX: 3.5, cameraOffsetY: 1.6, blur: 0.2, saturation: 0.85, opacity: 0.16 },
  { at: 0.65, bloom: 1.0, cameraDistance: 15.5, cameraOffsetX: 4.0, cameraOffsetY: 1.8, blur: 0.22, saturation: 0.8, opacity: 0.14 },
  { at: 1.0, bloom: 1.0, cameraDistance: 16.5, cameraOffsetX: 4.5, cameraOffsetY: 2.0, blur: 0.25, saturation: 0.7, opacity: 0.12 }
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
