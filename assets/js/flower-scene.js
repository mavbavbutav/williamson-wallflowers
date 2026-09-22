import * as THREE from '../../moments/vendor/three.module.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-1';

const CLOSED_TILT = 0;
const OPEN_TILT = -1.95;
const BASE_PETAL_COLOR = 0xeab4c6;
const LATE_PETAL_COLOR = 0xd79aa8;
const MOBILE_QUERY = '(max-width: 760px)';
const PETAL_LENGTH = 1.5;
const PETAL_ATTACH_RADIUS = 0.26;

function buildPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.3, 0.42, 0.3, 1.1, 0, PETAL_LENGTH);
  shape.bezierCurveTo(-0.3, 1.1, -0.3, 0.42, 0, 0);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
}

// Each petal hinges at a fixed radius from the flower's central axis. The
// hinge itself is what animates (hinge.rotation.x), swinging the blade
// between "closed" (pointing straight up, clustered into a bud) and "open"
// (swung out past horizontal, like a bloomed flower). The petal mesh keeps
// a fixed local transform so the hinge rotation is a clean single-axis fold.
function buildFlower(quality) {
  const flower = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x7c9a68, roughness: 0.7 })
  );
  stem.position.y = -1.6;
  flower.add(stem);

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xf6c453, roughness: 0.5 })
  );
  flower.add(center);

  const petalGeometry = buildPetalGeometry();
  const hinges = [];
  for (let i = 0; i < quality.petalCount; i++) {
    const angle = ((Math.PI * 2) / quality.petalCount) * i;
    const radialPivot = new THREE.Object3D();
    radialPivot.rotation.y = angle;

    const hinge = new THREE.Object3D();
    hinge.position.set(0, 0, PETAL_ATTACH_RADIUS);
    hinge.rotation.x = CLOSED_TILT;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(BASE_PETAL_COLOR),
      roughness: 0.55,
      side: THREE.DoubleSide
    });
    const petal = new THREE.Mesh(petalGeometry, material);

    hinge.add(petal);
    radialPivot.add(hinge);
    flower.add(radialPivot);
    hinges.push(hinge);
  }

  return { flower, hinges };
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

  const { flower, hinges } = buildFlower(quality);
  if (isMobile) {
    flower.position.set(0, 0.3, 0);
  } else {
    flower.position.set(-1.6, 0.9, 0);
  }
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

    for (const hinge of hinges) {
      hinge.rotation.x = CLOSED_TILT + (OPEN_TILT - CLOSED_TILT) * choreo.bloom;
      const petal = hinge.children[0];
      petal.material.color.copy(baseColor).lerp(lateColor, 1 - choreo.saturation);
    }

    const dollyX = quality.allowDolly ? choreo.cameraOffsetX : 0;
    const dollyY = quality.allowDolly ? choreo.cameraOffsetY : 0.4;
    const distance = quality.allowDolly ? choreo.cameraDistance : 17;

    camera.position.set(dollyX, dollyY + 0.6, distance);
    camera.lookAt(0, 0.1, 0);

    idleRotation += 0.0015 + choreo.bloom * 0.001;
    flower.rotation.y = idleRotation;

    canvas.style.filter = choreo.blur > 0 ? `blur(${(choreo.blur * 6).toFixed(2)}px)` : '';
    canvas.style.opacity = String(1 - choreo.blur * 0.15);

    renderer.render(scene, camera);
  }

  win.requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
