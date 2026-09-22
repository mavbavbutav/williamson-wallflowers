import * as THREE from '../../moments/vendor/three.module.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-2';

const BASE_PETAL_COLOR = 0xeab4c6;
const LATE_PETAL_COLOR = 0xd79aa8;
const INNER_PETAL_COLOR = 0xf6d3de;
const MOBILE_QUERY = '(max-width: 760px)';

const RING_CONFIG = {
  outer: {
    length: 1.55,
    width: 0.34,
    curve: 0.24,
    radius: 0.27,
    closedTilt: 0.05,
    openTilt: -2.0,
    color: BASE_PETAL_COLOR
  },
  inner: {
    length: 0.85,
    width: 0.22,
    curve: 0.34,
    radius: 0.13,
    closedTilt: -0.1,
    openTilt: -1.45,
    color: INNER_PETAL_COLOR
  }
};

// Build a petal blade, then bend it forward (curl) along its length so it
// reads as a soft, dimensional petal instead of a flat plastic blade.
function buildPetalGeometry(length, width, curveAmount) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width, length * 0.3, width, length * 0.75, 0, length);
  shape.bezierCurveTo(-width, length * 0.75, -width, length * 0.3, 0, 0);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 10 });
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const bend = Math.sin(Math.min(1, Math.max(0, y / length)) * Math.PI * 0.5) * curveAmount;
    position.setZ(i, position.getZ(i) + bend);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function buildPetalRing(config, count) {
  const geometry = buildPetalGeometry(config.length, config.width, config.curve);
  const petals = [];

  for (let i = 0; i < count; i++) {
    const angle = ((Math.PI * 2) / count) * i + (config === RING_CONFIG.inner ? Math.PI / count : 0);
    const radialPivot = new THREE.Object3D();
    radialPivot.rotation.y = angle;

    const hinge = new THREE.Object3D();
    hinge.position.set(0, 0, config.radius);
    hinge.rotation.x = config.closedTilt;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.color),
      emissive: new THREE.Color(config.color).multiplyScalar(0.12),
      roughness: 0.42,
      metalness: 0.03,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide
    });
    const petal = new THREE.Mesh(geometry, material);

    hinge.add(petal);
    radialPivot.add(hinge);

    petals.push({
      root: radialPivot,
      hinge,
      material,
      closedTilt: config.closedTilt,
      openTilt: config.openTilt,
      phase: i * 1.31 + (config === RING_CONFIG.inner ? 10 : 0)
    });
  }

  return petals;
}

// Each petal hinges at a fixed radius from the flower's central axis. The
// hinge is what animates (hinge.rotation.x), swinging the blade between
// "closed" (near-vertical, clustered into a bud) and "open" (swung out,
// bloomed). Two rings (inner + outer) give the bloom depth instead of a
// single flat fan of identical blades.
function buildFlower(quality) {
  const flower = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x7c9a68, roughness: 0.7 })
  );
  stem.position.y = -1.6;
  flower.add(stem);

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 20, 20),
    new THREE.MeshStandardMaterial({
      color: 0xf6c453,
      emissive: 0xf6c453,
      emissiveIntensity: 0.35,
      roughness: 0.4
    })
  );
  flower.add(center);

  const outerCount = quality.petalCount;
  const innerCount = Math.max(4, Math.round(quality.petalCount * 0.6));

  const outerPetals = buildPetalRing(RING_CONFIG.outer, outerCount);
  const innerPetals = buildPetalRing(RING_CONFIG.inner, innerCount);
  const petals = outerPetals.concat(innerPetals);

  for (const petal of petals) {
    flower.add(petal.root);
  }

  return { flower, petals, centerMesh: center };
}

function buildLights(scene) {
  scene.add(new THREE.AmbientLight(0xfff1e0, 0.65));
  const key = new THREE.DirectionalLight(0xffe6c8, 1.0);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8c9ff, 0.22);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a8, 0.55);
  rim.position.set(-1, 1.5, -5);
  scene.add(rim);
}

// A small cloud of soft drifting motes (pollen/floating petals) for ambient
// motion. The dot texture is generated on a canvas at runtime so no image
// asset is needed.
function buildParticleField(count) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,235,220,0.9)');
  gradient.addColorStop(1, 'rgba(255,235,220,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const drifts = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 7;
    positions[i * 3 + 1] = Math.random() * 6 - 2.5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4 - 1;
    speeds[i] = 0.15 + Math.random() * 0.2;
    drifts[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    size: 0.14,
    map: texture,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });

  const points = new THREE.Points(geometry, material);

  return { points, positions, speeds, drifts };
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

  const { flower, petals, centerMesh } = buildFlower(quality);
  const basePosition = isMobile ? { x: 0, y: 0.3 } : { x: -1.6, y: 0.9 };
  flower.position.set(basePosition.x, basePosition.y, 0);
  scene.add(flower);

  const particleCount = isMobile ? 8 : 16;
  const particles = buildParticleField(particleCount);
  particles.points.position.set(basePosition.x, basePosition.y, 0);
  scene.add(particles.points);

  const outerBase = new THREE.Color(BASE_PETAL_COLOR);
  const outerLate = new THREE.Color(LATE_PETAL_COLOR);
  const innerBase = new THREE.Color(INNER_PETAL_COLOR);
  const innerLate = new THREE.Color(LATE_PETAL_COLOR).lerp(new THREE.Color(0xffffff), 0.2);

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
  const startTime = (win.performance || Date).now();

  function frame() {
    win.requestAnimationFrame(frame);
    if (!visible) return;

    const now = ((win.performance || Date).now() - startTime) / 1000;
    const choreo = computeChoreography(currentProgress());

    for (let i = 0; i < petals.length; i++) {
      const petal = petals[i];
      const isInner = i >= quality.petalCount;
      const sway = Math.sin(now * 1.15 + petal.phase) * 0.09 + Math.sin(now * 0.41 + petal.phase * 1.6) * 0.035;
      const flutter = Math.sin(now * 0.6 + petal.phase) * 0.05;
      const liveliness = 0.4 + 0.6 * choreo.bloom;

      petal.hinge.rotation.x =
        petal.closedTilt + (petal.openTilt - petal.closedTilt) * choreo.bloom + sway * liveliness;
      petal.hinge.rotation.z = flutter * liveliness;

      const base = isInner ? innerBase : outerBase;
      const late = isInner ? innerLate : outerLate;
      petal.material.color.copy(base).lerp(late, 1 - choreo.saturation);
    }

    centerMesh.scale.setScalar(1 + Math.sin(now * 1.4) * 0.03);

    const positions = particles.points.geometry.attributes.position;
    for (let i = 0; i < particles.speeds.length; i++) {
      let y = positions.getY(i) + particles.speeds[i] * 0.01;
      if (y > 3.5) y = -2.5;
      const drift = Math.sin(now * 0.3 + particles.drifts[i]) * 0.01;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) + drift);
    }
    positions.needsUpdate = true;

    const dollyX = quality.allowDolly ? choreo.cameraOffsetX : 0;
    const dollyY = quality.allowDolly ? choreo.cameraOffsetY : 0.4;
    const distance = quality.allowDolly ? choreo.cameraDistance : 17;

    camera.position.set(dollyX, dollyY + 0.6, distance);
    camera.lookAt(0, 0.1, 0);

    idleRotation += 0.0045 + choreo.bloom * 0.0025;
    flower.rotation.y = idleRotation;
    particles.points.rotation.y = idleRotation * 0.4;
    flower.position.y = basePosition.y + Math.sin(now * 0.45) * 0.06;

    canvas.style.filter = choreo.blur > 0 ? `blur(${(choreo.blur * 6).toFixed(2)}px)` : '';
    canvas.style.opacity = String(1 - choreo.blur * 0.15);

    renderer.render(scene, camera);
  }

  win.requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
