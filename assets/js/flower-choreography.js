const KEYFRAMES = [
  { at: 0.0, bloom: 0.0, cameraDistance: 9.0, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0 },
  { at: 0.35, bloom: 0.7, cameraDistance: 9.5, cameraOffsetX: 0.0, cameraOffsetY: 0.0, blur: 0.0, saturation: 1.0 },
  { at: 0.65, bloom: 0.9, cameraDistance: 13.0, cameraOffsetX: 3.5, cameraOffsetY: 1.8, blur: 0.35, saturation: 0.85 },
  { at: 0.85, bloom: 1.0, cameraDistance: 15.0, cameraOffsetX: 4.4, cameraOffsetY: 2.2, blur: 0.6, saturation: 0.7 },
  { at: 1.0, bloom: 1.0, cameraDistance: 15.5, cameraOffsetX: 4.6, cameraOffsetY: 2.3, blur: 0.65, saturation: 0.65 }
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
