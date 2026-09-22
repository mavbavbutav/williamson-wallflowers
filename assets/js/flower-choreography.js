// Measured against the actual homepage layout: the collection section's
// 4-card grid runs from roughly 15% to 50% of total scroll, so the bud-to-
// bloom crossfade (see CROSSFADE_START/END below) needs to fully resolve
// before 0.15 — otherwise it plays out behind/across the card photos
// instead of as a clean moment. After that, the flower recedes
// monotonically (smaller, blurrier, pushed toward the corner) rather than
// re-timing a camera move to each section's real content, so it stays out
// of the way regardless of exactly how tall any given section is.
const KEYFRAMES = [
  { at: 0.0, bloom: 0.0, cameraDistance: 9.0, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0 },
  { at: 0.07, bloom: 0.9, cameraDistance: 10.5, cameraOffsetX: 1.0, cameraOffsetY: 0.5, blur: 0.1, saturation: 0.95 },
  { at: 0.13, bloom: 1.0, cameraDistance: 19.0, cameraOffsetX: 9.5, cameraOffsetY: 3.6, blur: 0.55, saturation: 0.8 },
  { at: 0.65, bloom: 1.0, cameraDistance: 20.0, cameraOffsetX: 9.8, cameraOffsetY: 3.8, blur: 0.6, saturation: 0.75 },
  { at: 0.94, bloom: 1.0, cameraDistance: 22.0, cameraOffsetX: 10.2, cameraOffsetY: 4.0, blur: 0.72, saturation: 0.65 },
  { at: 1.0, bloom: 1.0, cameraDistance: 22.0, cameraOffsetX: 10.2, cameraOffsetY: 4.0, blur: 0.72, saturation: 0.65 }
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
