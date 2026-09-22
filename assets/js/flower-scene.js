import * as THREE from '../../moments/vendor/three.module.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-1';

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
