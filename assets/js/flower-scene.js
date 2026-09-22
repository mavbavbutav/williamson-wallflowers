import * as THREE from '../../moments/vendor/three.module.js';
import { computeChoreography, getQualityProfile } from './flower-choreography.js?v=20260922-bloom-12';

const MOBILE_QUERY = '(max-width: 760px)';

// Art direction: luminous and abstract, not photoreal. This sits inches from
// professional photographs of real flower walls, and procedural geometry
// loses that comparison every time it tries to imitate one. So the goal is
// light and atmosphere — translucent, glowing, soft-edged — that reads as a
// bloom without inviting a like-for-like comparison with the photography.
//
// Petals are zero-thickness curved surfaces (not extruded slabs, which is
// what produced the hard "cardboard" rim), cupped and twisted, shaded with
// sheen + an environment map and finished with a real bloom pass.
const RINGS = [
  {
    name: 'outer',
    countOffset: 4,
    length: 1.65,
    width: 0.55,
    cup: 0.16,
    bend: 0.5,
    twist: 0.12,
    radius: 0.3,
    closedTilt: 0.06,
    openTilt: -2.1,
    baseColor: 0xb8445f,
    midColor: 0xe07f9d,
    tipColor: 0xf6c3d3
  },
  {
    name: 'mid',
    countOffset: 1,
    length: 1.2,
    width: 0.46,
    cup: 0.24,
    bend: 0.58,
    twist: -0.1,
    radius: 0.21,
    closedTilt: -0.04,
    openTilt: -1.72,
    baseColor: 0xc4546f,
    midColor: 0xe890aa,
    tipColor: 0xf9d3de
  },
  {
    name: 'inner',
    countOffset: -1,
    length: 0.8,
    width: 0.36,
    cup: 0.32,
    bend: 0.72,
    twist: 0.14,
    radius: 0.12,
    closedTilt: -0.16,
    openTilt: -1.2,
    baseColor: 0xcf6480,
    midColor: 0xf0a6bc,
    tipColor: 0xfde3ea
  }
];

// Deterministic per-petal pseudo-randomness, so the arrangement is
// irregular (nature is never evenly spaced) but identical on every load.
function rand(i, salt) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// A petal as a curved parametric sheet: narrow at the base, widest around
// the middle, tapering to a point, cupped across its width and twisted
// along its length. Zero thickness means no extrusion wall to catch light
// as a hard bright edge.
function buildPetalGeometry(config) {
  const { length, width, cup, bend, twist, baseColor, midColor, tipColor } = config;
  const segU = 16;
  const segV = 9;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  const cBase = new THREE.Color(baseColor);
  const cMid = new THREE.Color(midColor);
  const cTip = new THREE.Color(tipColor);
  const tmp = new THREE.Color();

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    // Elliptical outline raised to a low power: full-bodied with a rounded
    // tip. A sine profile tapers to a sharp point, which made the petals
    // read as glassy shards rather than a bloom.
    const halfWidth = width * Math.pow(Math.max(0, 1 - Math.pow(2 * u - 1, 2)), 0.42);
    const bendZ = bend * (1 - Math.cos(u * Math.PI * 0.62));
    const twistAngle = twist * u;
    const cos = Math.cos(twistAngle);
    const sin = Math.sin(twistAngle);

    for (let iv = 0; iv <= segV; iv++) {
      const v = (iv / segV) * 2 - 1;
      const x = halfWidth * v;
      const z = bendZ + cup * v * v * (0.35 + u);

      positions.push(x * cos - z * sin, length * u, x * sin + z * cos);
      uvs.push((v + 1) / 2, u);

      if (u < 0.55) tmp.copy(cBase).lerp(cMid, u / 0.55);
      else tmp.copy(cMid).lerp(cTip, (u - 0.55) / 0.45);
      tmp.lerp(cTip, Math.abs(v) * 0.12);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }

  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * (segV + 1) + iv;
      const b = a + segV + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildPetalRing(config, count) {
  const geometry = buildPetalGeometry(config);
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.52,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color(0xffd3e0),
    emissive: new THREE.Color(config.baseColor).multiplyScalar(0.07),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    // Transparent petals overlap constantly; writing depth makes them
    // occlude each other wrongly and produces hard seams.
    depthWrite: false
  });

  const petals = [];
  for (let i = 0; i < count; i++) {
    const jitterAngle = (rand(i, 1) - 0.5) * (Math.PI / count) * 0.9;
    const angle = ((Math.PI * 2) / count) * i + jitterAngle;

    const radialPivot = new THREE.Object3D();
    radialPivot.rotation.y = angle;

    const hinge = new THREE.Object3D();
    hinge.position.set(0, 0, config.radius * (0.88 + rand(i, 2) * 0.24));
    hinge.rotation.x = config.closedTilt;
    hinge.rotation.z = (rand(i, 3) - 0.5) * 0.22;

    const petal = new THREE.Mesh(geometry, material);
    petal.scale.set(0.84 + rand(i, 4) * 0.34, 0.8 + rand(i, 5) * 0.42, 1);
    petal.rotation.y = (rand(i, 6) - 0.5) * 0.4;
    petal.renderOrder = 2;

    hinge.add(petal);
    radialPivot.add(hinge);

    petals.push({
      hinge,
      root: radialPivot,
      closedTilt: config.closedTilt,
      openTilt: config.openTilt * (0.86 + rand(i, 7) * 0.28),
      phase: i * 1.31 + config.radius * 17
    });
  }

  return { petals, material };
}

// The centre is a glowing core rather than a botanically accurate stamen
// cluster — fine filaments catching the bloom pass read as light, which is
// the whole point of the abstract direction.
function buildCore() {
  const group = new THREE.Group();

  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 24, 18),
    new THREE.MeshStandardMaterial({
      color: 0xf9dfb0,
      emissive: 0xf7b757,
      emissiveIntensity: 1.1,
      roughness: 0.55
    })
  );
  group.add(disc);

  const count = 46;
  const filament = new THREE.CylinderGeometry(0.006, 0.011, 0.3, 4);
  filament.translate(0, 0.15, 0);
  const filaments = new THREE.InstancedMesh(
    filament,
    new THREE.MeshStandardMaterial({
      color: 0xfff3d8,
      emissive: 0xffc871,
      emissiveIntensity: 0.9,
      roughness: 0.45
    }),
    count
  );

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const a = i * 2.39996; // golden angle — even spread, never repeating
    const r = 0.05 + (i / count) * 0.12;
    const lean = 0.22 + (i / count) * 0.8;
    euler.set(lean * Math.cos(a), -a, lean * Math.sin(a));
    quaternion.setFromEuler(euler);
    position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r);
    scale.set(1, 0.7 + rand(i, 9) * 0.7, 1);
    matrix.compose(position, quaternion, scale);
    filaments.setMatrixAt(i, matrix);
  }
  filaments.instanceMatrix.needsUpdate = true;
  filaments.renderOrder = 1;
  group.add(filaments);

  return group;
}

function buildStem() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x7f9c6a, roughness: 0.72 });

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.1, -0.9, 0.05),
    new THREE.Vector3(0.04, -1.9, -0.04),
    new THREE.Vector3(0.16, -3.1, 0)
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.055, 8, false), material));

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.24, 0.2, 0.24, 0.56, 0, 0.76);
  leafShape.bezierCurveTo(-0.24, 0.56, -0.24, 0.2, 0, 0);
  const leafGeometry = new THREE.ShapeGeometry(leafShape, 12);
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x749260,
    roughness: 0.78,
    side: THREE.DoubleSide
  });

  for (const p of [
    { y: -1.05, angle: 0.6, tilt: 0.55 },
    { y: -1.35, angle: -2.3, tilt: 0.62 }
  ]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(0.05, p.y, 0);
    pivot.rotation.y = p.angle;
    const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
    leaf.rotation.z = -Math.PI / 2 + p.tilt;
    pivot.add(leaf);
    group.add(pivot);
  }

  return group;
}

function buildFlower(quality) {
  const flower = new THREE.Group();
  flower.add(buildStem());
  flower.add(buildCore());

  const petals = [];
  const materials = [];
  for (const ring of RINGS) {
    const count = Math.max(5, quality.petalCount + ring.countOffset);
    const built = buildPetalRing(ring, count);
    for (const petal of built.petals) {
      flower.add(petal.root);
      petals.push(petal);
    }
    materials.push(built.material);
  }

  return { flower, petals, materials };
}

// A soft warm gradient used as the scene environment. Image-based lighting
// is what gives every surface a varying ambient/specular response — without
// it, a handful of directional lights flattens all the form out.
function buildEnvironment(renderer, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, '#fff8ee');
  gradient.addColorStop(0.45, '#f6e6d8');
  gradient.addColorStop(1, '#cbb6a6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(texture).texture;
  texture.dispose();
  pmrem.dispose();
}

function buildLights(scene) {
  const key = new THREE.DirectionalLight(0xfff0d8, 1.9);
  key.position.set(2.5, 3.2, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfd0ff, 0.5);
  fill.position.set(-3, 1.2, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd6a1, 1.4);
  rim.position.set(-1.2, 1.8, -3.4);
  scene.add(rim);
}

// A real bloom pass (EffectComposer + UnrealBloomPass) does not preserve
// canvas alpha — it renders an opaque background, which blacks out the page
// behind this fixed full-viewport canvas. So the glow is faked with soft
// additive sprites instead: cheaper, and alpha-safe.
function buildGlow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,228,178,0.85)');
  gradient.addColorStop(0.35, 'rgba(255,205,150,0.32)');
  gradient.addColorStop(1, 'rgba(255,196,140,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    opacity: 0.9
  });

  const core = new THREE.Sprite(material);
  core.scale.set(2.6, 2.6, 1);
  core.renderOrder = 3;

  const halo = new THREE.Sprite(material.clone());
  halo.material.opacity = 0.35;
  halo.scale.set(5.5, 5.5, 1);
  halo.renderOrder = 3;

  const group = new THREE.Group();
  group.add(halo);
  group.add(core);
  return { group, core, halo };
}

function buildParticleField(count) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,240,222,0.95)');
  gradient.addColorStop(1, 'rgba(255,240,222,0)');
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

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.16,
      map: texture,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );

  return { points, positions, speeds, drifts };
}

export function mount(root, win) {
  const doc = win.document;
  const isMobile = win.matchMedia(MOBILE_QUERY).matches;
  const quality = getQualityProfile(isMobile);

  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
  root.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, quality.pixelRatioCap));
  renderer.setSize(win.innerWidth, win.innerHeight);
  renderer.setClearAlpha(0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, win.innerWidth / win.innerHeight, 0.1, 100);
  buildEnvironment(renderer, scene);
  buildLights(scene);

  const basePosition = isMobile ? { x: 0, y: 0.2 } : { x: -1.7, y: 0.5 };

  const { flower, petals } = buildFlower(quality);
  flower.position.set(basePosition.x, basePosition.y, 0);
  scene.add(flower);

  const glow = buildGlow();
  flower.add(glow.group);

  const particles = buildParticleField(isMobile ? 10 : 20);
  particles.points.position.set(basePosition.x, basePosition.y, 0);
  scene.add(particles.points);

  let cachedScrollRange = Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
  function currentProgress() {
    return win.scrollY / cachedScrollRange;
  }

  let visible = true;
  doc.addEventListener('visibilitychange', () => {
    visible = doc.visibilityState === 'visible';
  });

  function resize() {
    cachedScrollRange = Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
    camera.aspect = win.innerWidth / win.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(win.innerWidth, win.innerHeight);
  }
  win.addEventListener('resize', resize);
  resize();

  let idleRotation = 0;
  let lastScrollY = win.scrollY;
  let lastScrollAt = 0;
  let lastOpacity = -1;
  let lastBlur = -1;
  let frameIndex = 0;
  const startTime = (win.performance || Date).now();

  function frame() {
    win.requestAnimationFrame(frame);
    if (!visible) return;

    const nowMs = (win.performance || Date).now();
    frameIndex++;

    if (win.scrollY !== lastScrollY) {
      lastScrollY = win.scrollY;
      lastScrollAt = nowMs;
    }
    // Once the page has been still for a moment, only the idle sway is
    // changing — no need to redraw a full-viewport bloom pass at 60fps.
    const idle = nowMs - lastScrollAt > 250;
    if (idle && frameIndex % 2 === 1) return;

    const now = (nowMs - startTime) / 1000;
    const progress = currentProgress();
    const choreo = computeChoreography(progress);

    for (const petal of petals) {
      const sway = Math.sin(now * 1.15 + petal.phase) * 0.085 + Math.sin(now * 0.41 + petal.phase * 1.6) * 0.035;
      petal.hinge.rotation.x = petal.closedTilt + (petal.openTilt - petal.closedTilt) * choreo.bloom + sway;
    }

    const bob = Math.sin(now * 0.45) * 0.06;
    flower.position.y = basePosition.y + bob;
    flower.rotation.z = Math.sin(now * 0.5) * 0.02;

    // The core glow swells as the bloom opens and breathes gently at rest.
    const breath = 0.92 + Math.sin(now * 0.9) * 0.08;
    const glowScale = (0.45 + choreo.bloom * 0.75) * breath;
    glow.core.scale.set(2.6 * glowScale, 2.6 * glowScale, 1);
    glow.halo.scale.set(5.5 * glowScale, 5.5 * glowScale, 1);
    glow.core.material.opacity = 0.55 + choreo.bloom * 0.35;
    glow.halo.material.opacity = 0.16 + choreo.bloom * 0.22;

    const positions = particles.points.geometry.attributes.position;
    for (let i = 0; i < particles.speeds.length; i++) {
      let y = positions.getY(i) + particles.speeds[i] * 0.01;
      if (y > 3.5) y = -2.5;
      positions.setY(i, y);
      positions.setX(i, positions.getX(i) + Math.sin(now * 0.3 + particles.drifts[i]) * 0.01);
    }
    positions.needsUpdate = true;

    // Vertical travel: the camera rises only modestly while its aim point
    // sweeps up faster. That difference is what actually slides the flower
    // down the frame — moving the camera and the aim together (as this did
    // previously) just changes the viewing angle and leaves the subject
    // pinned to the middle of the screen.
    const weaveX = quality.allowDolly ? Math.sin(progress * Math.PI * 2.5) * 0.8 : 0;
    const dollyX = quality.allowDolly ? choreo.cameraOffsetX + weaveX : 0;
    const dollyY = choreo.cameraOffsetY * 0.3;
    const aimY = 0.3 + choreo.cameraOffsetY * 0.52;
    const distance = quality.allowDolly ? choreo.cameraDistance : choreo.cameraDistance * 1.7;

    camera.position.set(dollyX, dollyY + 0.6, distance);
    camera.lookAt(0, aimY, 0);

    idleRotation += 0.0035 + choreo.bloom * 0.0015;
    flower.rotation.y = idleRotation;

    // Only touch style when the value actually changes — these are writes
    // to a full-viewport fixed element, and the canvas no longer carries a
    // CSS transition that would fight a per-frame write.
    const opacity = Math.round(choreo.opacity * 100) / 100;
    if (opacity !== lastOpacity) {
      canvas.style.opacity = String(opacity);
      lastOpacity = opacity;
    }
    const blur = Math.round(choreo.blur * 3 * 10) / 10;
    if (blur !== lastBlur) {
      canvas.style.filter = blur > 0 ? `blur(${blur}px)` : '';
      lastBlur = blur;
    }

    renderer.render(scene, camera);
  }

  win.requestAnimationFrame(frame);

  return { renderer, scene, camera };
}
