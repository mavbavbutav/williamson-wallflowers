import * as THREE from '../../moments/vendor/three.module.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-9';

const MOBILE_QUERY = '(max-width: 760px)';

// One procedural mesh per petal, hinged at a fixed radius from the central
// axis. choreo.bloom (0-1) drives hinge.rotation.x directly, so the same
// vertices swing from "closed" (near-vertical, clustered into a bud) to
// "open" (swung out, bloomed) — a real transformation of one continuous
// object, not a crossfade between two separate models.
const RING_CONFIG = {
  outer: {
    length: 1.6,
    width: 0.36,
    curve: 0.26,
    radius: 0.28,
    closedTilt: 0.05,
    openTilt: -2.05,
    baseColor: 0xd8768f,
    tipColor: 0xf9d9e4
  },
  inner: {
    length: 0.9,
    width: 0.24,
    curve: 0.36,
    radius: 0.14,
    closedTilt: -0.1,
    openTilt: -1.5,
    baseColor: 0xe28ba1,
    tipColor: 0xfdeaf0
  }
};

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// Petal blade bent forward (curled) along its length, with a per-vertex
// color gradient from a deeper base tone to a pale tip — real peony petals
// darken toward the center, not just toward one flat hue.
function buildPetalGeometry(config) {
  const { length, width, curve, baseColor, tipColor } = config;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width, length * 0.3, width, length * 0.78, 0, length);
  shape.bezierCurveTo(-width, length * 0.78, -width, length * 0.3, 0, 0);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 18 });
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const base = new THREE.Color(baseColor);
  const tip = new THREE.Color(tipColor);

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = Math.min(1, Math.max(0, y / length));
    const bend = Math.sin(t * Math.PI * 0.5) * curve;
    position.setZ(i, position.getZ(i) + bend);

    const c = lerpColor(base, tip, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  position.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildPetalRing(config, count, ringName) {
  const geometry = buildPetalGeometry(config);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0,
    emissive: new THREE.Color(config.baseColor).multiplyScalar(0.08),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.96
  });

  const petals = [];
  for (let i = 0; i < count; i++) {
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const angle = ((Math.PI * 2) / count) * i + (ringName === 'inner' ? Math.PI / count : 0) + jitter * 0.06;

    const radialPivot = new THREE.Object3D();
    radialPivot.rotation.y = angle;

    const hinge = new THREE.Object3D();
    hinge.position.set(0, 0, config.radius);
    hinge.rotation.x = config.closedTilt;

    const petal = new THREE.Mesh(geometry, material);
    const scaleJitter = 0.92 + Math.abs(jitter) * 0.16;
    petal.scale.setScalar(scaleJitter);

    hinge.add(petal);
    radialPivot.add(hinge);

    petals.push({
      root: radialPivot,
      hinge,
      closedTilt: config.closedTilt,
      openTilt: config.openTilt,
      phase: i * 1.31 + (ringName === 'inner' ? 10 : 0)
    });
  }

  return { petals, material };
}

// A small cluster of stamens at the flower's center — cheap geometry, but
// it's what makes a procedural bloom read as a peony instead of a generic
// flat flower icon.
function buildStamens() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xf6c453,
    emissive: 0xf2a63c,
    emissiveIntensity: 0.5,
    roughness: 0.4
  });
  const geometry = new THREE.ConeGeometry(0.02, 0.16, 6);
  const stamenCount = 14;
  for (let i = 0; i < stamenCount; i++) {
    const angle = (Math.PI * 2 * i) / stamenCount;
    const radius = 0.05 + (i % 3) * 0.02;
    const stamen = new THREE.Mesh(geometry, material);
    stamen.position.set(Math.cos(angle) * radius, 0.06, Math.sin(angle) * radius);
    stamen.rotation.x = Math.PI * 0.42 + Math.sin(angle) * 0.15;
    stamen.rotation.z = Math.cos(angle) * 0.15;
    group.add(stamen);
  }
  return group;
}

// A couple of simple leaves partway down the stem — cheap, but it's the
// difference between "a flower head floating on a rod" and a plant.
function buildLeaves() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.22, 0.18, 0.22, 0.5, 0, 0.68);
  shape.bezierCurveTo(-0.22, 0.5, -0.22, 0.18, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 8 });
  const material = new THREE.MeshStandardMaterial({ color: 0x6f8f5c, roughness: 0.75, side: THREE.DoubleSide });

  const placements = [
    { y: -1.0, angle: 0.55, tilt: 0.5 },
    { y: -1.25, angle: -2.4, tilt: 0.55 }
  ];
  for (const p of placements) {
    const pivot = new THREE.Object3D();
    pivot.position.set(0, p.y, 0);
    pivot.rotation.y = p.angle;
    const leaf = new THREE.Mesh(geometry, material);
    leaf.rotation.z = -Math.PI / 2 + p.tilt;
    leaf.position.x = 0.06;
    pivot.add(leaf);
    group.add(pivot);
  }
  return group;
}

function buildFlower(quality) {
  const flower = new THREE.Group();

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, 3, 8),
    new THREE.MeshStandardMaterial({ color: 0x7c9a68, roughness: 0.7 })
  );
  stem.position.y = -1.7;
  flower.add(stem);
  flower.add(buildLeaves());

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xf6c453, emissive: 0xf6c453, emissiveIntensity: 0.3, roughness: 0.5 })
  );
  flower.add(center);
  flower.add(buildStamens());

  const glow = new THREE.PointLight(0xffdcae, 0.6, 2.2, 2);
  glow.position.set(0, 0.1, 0.15);
  flower.add(glow);

  const outerCount = quality.petalCount;
  const innerCount = Math.max(4, Math.round(quality.petalCount * 0.6));

  const outer = buildPetalRing(RING_CONFIG.outer, outerCount, 'outer');
  const inner = buildPetalRing(RING_CONFIG.inner, innerCount, 'inner');
  const petals = outer.petals.concat(inner.petals);

  for (const petal of petals) flower.add(petal.root);

  return { flower, petals, materials: [outer.material, inner.material] };
}

function buildLights(scene) {
  scene.add(new THREE.AmbientLight(0xfff1e0, 1.3));
  const key = new THREE.DirectionalLight(0xffe6c8, 1.5);
  key.position.set(2, 3, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8c9ff, 0.7);
  fill.position.set(-3, 1.5, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a8, 0.9);
  rim.position.set(-1, 2, -3);
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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, quality.pixelRatioCap));
  renderer.setSize(win.innerWidth, win.innerHeight);
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, win.innerWidth / win.innerHeight, 0.1, 100);
  buildLights(scene);

  const basePosition = isMobile ? { x: 0, y: 0.2 } : { x: -1.7, y: 0.5 };

  const { flower, petals, materials } = buildFlower(quality);
  flower.position.set(basePosition.x, basePosition.y, 0);
  scene.add(flower);

  const particleCount = isMobile ? 8 : 16;
  const particles = buildParticleField(particleCount);
  particles.points.position.set(basePosition.x, basePosition.y, 0);
  scene.add(particles.points);

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
    const progress = currentProgress();
    const choreo = computeChoreography(progress);

    for (const petal of petals) {
      const sway = Math.sin(now * 1.15 + petal.phase) * 0.09 + Math.sin(now * 0.41 + petal.phase * 1.6) * 0.035;
      const flutter = Math.sin(now * 0.6 + petal.phase) * 0.05;
      petal.hinge.rotation.x = petal.closedTilt + (petal.openTilt - petal.closedTilt) * choreo.bloom + sway;
      petal.hinge.rotation.z = flutter;
    }
    for (const material of materials) {
      material.opacity = 0.96;
    }

    const sway = Math.sin(now * 0.5) * 0.05;
    const bob = Math.sin(now * 0.45) * 0.06;
    flower.position.y = basePosition.y + bob;
    flower.rotation.z = sway * 0.3;

    const positions = particles.points.geometry.attributes.position;
    for (let i = 0; i < particles.speeds.length; i++) {
      let y = positions.getY(i) + particles.speeds[i] * 0.01;
      if (y > 3.5) y = -2.5;
      const drift = Math.sin(now * 0.3 + particles.drifts[i]) * 0.01;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) + drift);
    }
    positions.needsUpdate = true;
    particles.points.rotation.y = idleRotation * 0.4;

    // cameraOffsetY always applies (mobile included) so the flower visibly
    // travels down with the page rather than sitting in one spot once past
    // the hero. The horizontal weave is desktop-only, since a narrow mobile
    // viewport has no room to swing sideways without immediately clipping
    // the edge.
    const weaveX = quality.allowDolly ? Math.sin(progress * Math.PI * 2.5) * 0.8 : 0;
    const dollyX = quality.allowDolly ? choreo.cameraOffsetX + weaveX : 0;
    const dollyY = choreo.cameraOffsetY;
    const distance = quality.allowDolly ? choreo.cameraDistance : choreo.cameraDistance * 1.7;

    camera.position.set(dollyX, dollyY + 0.6, distance);
    camera.lookAt(0, 0.3, 0);

    idleRotation += 0.0035 + choreo.bloom * 0.0015;
    flower.rotation.y = idleRotation;

    canvas.style.filter = choreo.blur > 0 ? `blur(${(choreo.blur * 6).toFixed(2)}px)` : '';
    canvas.style.opacity = String(choreo.opacity);

    renderer.render(scene, camera);
  }

  win.requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
