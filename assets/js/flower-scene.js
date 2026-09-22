import * as THREE from '../../moments/vendor/three.module.js';
import { GLTFLoader } from '../../moments/vendor/jsm/loaders/GLTFLoader.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-6';

const MOBILE_QUERY = '(max-width: 760px)';
const BUD_MODEL_URL = new URL('../models/peony-bud.glb', import.meta.url).href;
const BLOOM_MODEL_URL = new URL('../models/peony-bloom.glb', import.meta.url).href;
const CROSSFADE_START = 0.28;
const CROSSFADE_END = 0.62;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Normalize a loaded model to a target height and re-center it on its own
// origin, so both the bud and bloom meshes (scanned at different real-world
// sizes) line up consistently regardless of their source photo framing.
function frameModel(object, targetHeight) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const scale = targetHeight / Math.max(size.y, 0.001);
  object.scale.setScalar(scale);
}

function loadModel(loader, url, targetHeight, onReady) {
  loader.load(
    url,
    (gltf) => {
      frameModel(gltf.scene, targetHeight);
      const materials = [];
      gltf.scene.traverse((node) => {
        if (node.isMesh) {
          node.material = node.material.clone();
          node.material.transparent = true;
          node.material.metalness = 0;
          node.material.metalnessMap = null;
          node.material.roughness = 0.75;
          node.material.roughnessMap = null;
          node.material.envMapIntensity = 1;
          materials.push(node.material);
        }
      });
      onReady(gltf.scene, materials);
    },
    undefined,
    () => {
      // Model failed to load (network hiccup, blocked asset, etc). The scene
      // stays up with whatever did load; this is a decorative background
      // layer, so we fail silently rather than surfacing an error to the
      // visitor.
    }
  );
}

function buildLights(scene) {
  scene.add(new THREE.AmbientLight(0xfff1e0, 2.2));
  const key = new THREE.DirectionalLight(0xffe6c8, 2.6);
  key.position.set(2, 3, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8c9ff, 1.2);
  fill.position.set(-3, 1.5, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a8, 1.5);
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

  const basePosition = isMobile ? { x: 0, y: 0.1 } : { x: -2.3, y: 0.2 };

  const budGroup = new THREE.Group();
  const bloomGroup = new THREE.Group();
  budGroup.position.set(basePosition.x, basePosition.y, 0);
  bloomGroup.position.set(basePosition.x, basePosition.y, 0);
  bloomGroup.visible = false;
  scene.add(budGroup, bloomGroup);

  let budMaterials = [];
  let bloomMaterials = [];

  const loader = new GLTFLoader();
  loadModel(loader, BUD_MODEL_URL, 2.0, (object, materials) => {
    budMaterials = materials;
    budGroup.add(object);
  });
  loadModel(loader, BLOOM_MODEL_URL, 2.4, (object, materials) => {
    for (const material of materials) material.opacity = 0;
    bloomMaterials = materials;
    bloomGroup.add(object);
  });

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
    const choreo = computeChoreography(currentProgress());
    const crossfade = smoothstep(CROSSFADE_START, CROSSFADE_END, choreo.bloom);

    for (const material of budMaterials) material.opacity = 1 - crossfade;
    for (const material of bloomMaterials) material.opacity = crossfade;
    budGroup.visible = crossfade < 0.995;
    bloomGroup.visible = crossfade > 0.005;

    budGroup.scale.setScalar(1 - crossfade * 0.1);
    bloomGroup.scale.setScalar(0.92 + crossfade * 0.16);

    const sway = Math.sin(now * 0.5) * 0.05;
    const flutter = Math.sin(now * 0.33 + 1.4) * 0.035;
    const bob = Math.sin(now * 0.45) * 0.06;
    for (const group of [budGroup, bloomGroup]) {
      group.rotation.set(flutter, idleRotation, sway);
      group.position.y = basePosition.y + bob;
    }

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

    // Mobile has no room to dolly sideways into a "corner" the way desktop
    // does, so it leans entirely on shrinking (via distance) and blurring/
    // fading to stay out of the way as content scrolls past. The 1.7x
    // multiplier compensates for the narrower horizontal FOV of a portrait
    // viewport at the same distance.
    const dollyX = quality.allowDolly ? choreo.cameraOffsetX : 0;
    const dollyY = quality.allowDolly ? choreo.cameraOffsetY : 0.3;
    const distance = quality.allowDolly ? choreo.cameraDistance : choreo.cameraDistance * 1.7;

    camera.position.set(dollyX, dollyY + 0.5, distance);
    camera.lookAt(0, 0.3, 0);

    idleRotation += 0.0035 + choreo.bloom * 0.0015;

    canvas.style.filter = choreo.blur > 0 ? `blur(${(choreo.blur * 6).toFixed(2)}px)` : '';
    canvas.style.opacity = String(1 - choreo.blur * 0.45);

    renderer.render(scene, camera);
  }

  win.requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
