import { formatDate, formatDateTime, getParam, qs, requestJson, setNotice } from "../shared.js?v=20260531-2";
import { dataUrlToBlob } from "../video-thumbnails.js?v=20260601-video-thumbs-1";

const eventId = getParam("event");
const token = readShareToken();
let capsule = null;
let items = [];
let spatialLayout = null;
let spatialClusters = [];
let spatialPlacements = [];
let spatialWalkStarted = false;
let spatialWalkScene = null;
let spatialWalkFrame = 0;
let spatialWalkStations = [];
let spatialActiveStationIndex = 0;
let spatialHoveredStationIndex = -1;
let spatialWalkInteractionsBound = false;
let slideIndex = 0;
let lastFocusedElement = null;
let currentCapsuleView = "timeline";
let feedAutoplayTimer = 0;
let feedAutoplayFrame = 0;
let feedScrollDirection = 0;
let lastFeedScrollTop = 0;
let feedSoundUnlocked = false;
let nativeSwipeFullscreenActive = false;
let nativeSlideshowFullscreenActive = false;
let slideAutoPlaying = true;
let slideAdvanceTimer = 0;
let slideshowControlsTimer = 0;
let castTvPanelOpen = false;
const videoPosterCache = new Map();
const videoPosterPersistCache = new Set();
const FEED_MEDIA_WARM_RADIUS = 2;
const FEED_IMAGE_WARM_RADIUS = 2;
const FEED_PLAYABLE_READY_STATE = 2;
const FEED_EARLY_PLAY_VISIBILITY_RATIO = 0.28;
const PHOTO_SLIDE_DURATION_MS = 20000;
const SLIDE_ERROR_ADVANCE_MS = 6000;
const CAST_RECEIVER_APP_ID = "D4D06631";
const SPATIAL_STATION_SPACING = 10;
const SPATIAL_STATION_SIDE_OFFSET = 4.4;
const SPATIAL_CAMERA_PULLBACK = 8.6;
const SPATIAL_CAMERA_HEIGHT = 2.15;
const SPATIAL_STATION_FOCUS_HEIGHT = 1.35;
const SPATIAL_NEAR_STATION_RADIUS = 2.35;

init();

async function init() {
  initCastTvControls();
  qs("#playSlideshowButton").addEventListener("click", () => openSlide(0, { autoPlay: true, requestFullscreen: true }));
  qs("#exitSwipeFeedButton").addEventListener("click", () => setCapsuleView("timeline", { userInitiated: true }));
  qsaCapsuleViewButtons().forEach((button) => {
    button.addEventListener("click", () => setCapsuleView(button.dataset.capsuleView || "timeline", { userInitiated: true }));
  });
  const capsuleFeed = qs("#capsuleFeed");
  capsuleFeed.addEventListener("scroll", () => {
    const nextScrollTop = Number(capsuleFeed.scrollTop || 0);
    const delta = nextScrollTop - lastFeedScrollTop;
    if (delta) feedScrollDirection = Math.sign(delta);
    lastFeedScrollTop = nextScrollTop;
    scheduleFeedAutoplay();
  }, { passive: true });
  qs("#capsuleWalk")?.addEventListener("scroll", requestSpatialWalkFrame, { passive: true });
  qs("#capsuleWalkViewButton")?.addEventListener("click", () => openSpatialWalkStation(spatialActiveStationIndex));
  qs("#slideClose").addEventListener("click", closeSlide);
  qs("#slidePrev").addEventListener("click", () => changeSlide(-1));
  qs("#slideNext").addEventListener("click", () => changeSlide(1));
  qs("#slidePlayPause").addEventListener("click", toggleSlideAutoPlay);
  qs("#slideshowModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSlide();
  });
  qs("#slideshowModal").addEventListener("pointermove", revealSlideshowControls);
  qs("#slideshowModal").addEventListener("pointerdown", revealSlideshowControls);
  qs("#slideshowModal").addEventListener("touchstart", revealSlideshowControls, { passive: true });
  document.addEventListener("keydown", (event) => {
    if (!qs("#slideshowModal").hidden) revealSlideshowControls();
    if (event.key === "Escape" && currentCapsuleView === "feed") setCapsuleView("timeline", { userInitiated: true });
    if (event.key === "Escape" && !qs("#slideshowModal").hidden) closeSlide();
    if (currentCapsuleView === "walk" && qs("#slideshowModal").hidden) {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        scrollSpatialWalkToStation(spatialActiveStationIndex + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        scrollSpatialWalkToStation(spatialActiveStationIndex - 1);
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSpatialWalkStation(spatialActiveStationIndex);
      }
    }
    if (event.key === "ArrowRight" && !qs("#slideshowModal").hidden) changeSlide(1);
    if (event.key === "ArrowLeft" && !qs("#slideshowModal").hidden) changeSlide(-1);
  });
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  window.addEventListener?.("resize", () => {
    sizeTvSlideFrame();
    resizeSpatialWalkScene();
  });

  if (!eventId || !token) {
    showError("This private Time Capsule link is missing its event or access token.");
    return;
  }

  try {
    const payload = await requestJson(`/capsules/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    capsule = payload.event;
    items = payload.items || [];
    spatialLayout = payload.spatialLayout || null;
    spatialClusters = Array.isArray(payload.spatialClusters) ? payload.spatialClusters : [];
    spatialPlacements = Array.isArray(payload.spatialPlacements) ? payload.spatialPlacements : [];
    render();
  } catch (error) {
    showError(error.message || "This Time Capsule link is not valid.");
  }
}

function render() {
  qs("#capsuleTitle").textContent = capsule.title || capsule.name || "Wallflower Time Capsule";
  qs("#capsuleMeta").textContent = `${formatDate(capsule.eventDate)}${capsule.publishedAt ? ` | Published ${formatDateTime(capsule.publishedAt)}` : ""}`;
  qs("#playSlideshowButton").hidden = items.length === 0;
  qs("#castTvButton").hidden = items.length === 0;
  if (!items.length) {
    qs("#castTvPanel").hidden = true;
    castTvPanelOpen = false;
  }
  qs("#capsuleEmpty").hidden = items.length > 0;
  renderTimeline();
  renderSwipeFeed();
  renderSpatialWalk();
  setCapsuleView(items.length ? currentCapsuleView : "timeline");
  updateCastTvControls();
  hydrateVideoPosters();
  hydrateStreamVideos();
}

function initCastTvControls() {
  loadGoogleCastSender();
  qs("#castTvButton").addEventListener("click", () => {
    castTvPanelOpen = !castTvPanelOpen;
    updateCastTvControls();
  });
  qs("#startAirplayFullscreenButton").addEventListener("click", () => openSlide(slideIndex || 0, { autoPlay: true, requestFullscreen: true }));
  qs("#copyTvDisplayLinkButton").addEventListener("click", copyTvDisplayLink);
  qs("#startChromecastButton").addEventListener("click", startChromecastSession);
  updateCastTvControls();
}

function updateCastTvControls() {
  const panel = qs("#castTvPanel");
  const castButton = qs("#castTvButton");
  const chromecastButton = qs("#startChromecastButton");
  const openLink = qs("#openTvDisplayLinkButton");
  const status = qs("#castTvStatus");
  const tvDisplayUrl = buildTvDisplayUrl();
  const hasNativeCast = configureCastContext();

  panel.hidden = !castTvPanelOpen || !items.length;
  castButton?.setAttribute("aria-expanded", String(!panel.hidden));
  if (openLink) openLink.href = tvDisplayUrl;

  chromecastButton.hidden = !hasNativeCast;
  chromecastButton.disabled = !hasNativeCast;
  status.textContent = castTvStatusMessage(hasNativeCast);
}

function castTvStatusMessage(hasNativeCast) {
  if (hasNativeCast) {
    return "Chromecast is available in this browser. Start Chromecast to send the TV slideshow to the receiver.";
  }

  if (CAST_RECEIVER_APP_ID) {
    return "Chromecast receiver is configured. Open this Time Capsule in desktop Chrome or Android Chrome on the same Wi-Fi as the Chromecast to show the native Cast button. On iPhone or iPad, use Start fullscreen, then Screen Mirroring from Control Center.";
  }

  return "Chromecast receiver setup is not configured yet. Fullscreen Screen Mirroring and the TV display link are ready now.";
}

async function copyTvDisplayLink() {
  const link = buildTvDisplayUrl();

  try {
    await navigator.clipboard.writeText(link);
    setNotice(qs("#capsuleNotice"), "TV display link copied.", "success");
  } catch {
    setNotice(qs("#capsuleNotice"), link, "success");
  }
}

async function startChromecastSession() {
  updateCastTvControls();
  if (!configureCastContext()) {
    setNotice(qs("#capsuleNotice"), castTvStatusMessage(false), "error");
    return;
  }

  try {
    const castContext = window.cast.framework.CastContext.getInstance();
    await castContext.requestSession();
    const session = castContext.getCurrentSession();
    await session?.sendMessage?.("urn:x-cast:com.wallflower.timecapsule", {
      eventId,
      token,
      url: buildTvDisplayUrl()
    });
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Chromecast could not start from this browser.", "error");
  }
}

function loadGoogleCastSender() {
  if (!CAST_RECEIVER_APP_ID || document.querySelector("[data-google-cast-sender]")) return;

  const previousCallback = window.__onGCastApiAvailable;
  window.__onGCastApiAvailable = (isAvailable) => {
    if (typeof previousCallback === "function") previousCallback(isAvailable);
    if (isAvailable) configureCastContext();
    updateCastTvControls();
  };

  const script = document.createElement("script");
  script.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
  script.async = true;
  script.dataset.googleCastSender = "true";
  document.head.append(script);
}

function configureCastContext() {
  if (!CAST_RECEIVER_APP_ID || !window.chrome || !window.cast?.framework) return false;

  const castContext = window.cast.framework.CastContext.getInstance();
  castContext.setOptions({
    receiverApplicationId: CAST_RECEIVER_APP_ID,
    autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  return true;
}

function buildTvDisplayUrl() {
  const url = new URL("cast/", window.location.href);
  const currentParams = new URLSearchParams(window.location.search);
  url.searchParams.set("event", eventId || "");
  url.searchParams.set("music", "1");
  ["api", "site"].forEach((name) => {
    const value = currentParams.get(name);
    if (value) url.searchParams.set(name, value);
  });
  url.hash = token ? `token=${encodeURIComponent(token)}` : "";
  return url.href;
}

function renderTimeline() {
  qs("#capsuleTimeline").innerHTML = items.map((item, index) => `
    <article class="media-card capsule-memory-card">
      <button class="capsule-memory-button" type="button" data-slide="${index}" aria-label="Open ${escapeAttribute(item.title)}">
        <span class="media-thumb is-${escapeAttribute(item.mediaType)}">
          ${item.mediaType === "photo"
            ? `<img src="${escapeAttribute(item.mediaUrl)}&disposition=inline" alt="${escapeAttribute(item.title)}" loading="lazy" />`
            : item.mediaType === "audio"
              ? `<audio src="${escapeAttribute(item.mediaUrl)}&disposition=inline" preload="metadata" controls></audio>`
              : `<video ${videoPosterAttributes(item)} ${videoSourceAttributes(item)} preload="metadata" muted playsinline></video>`}
        </span>
        <span class="media-body">
          <span class="status-pill">${escapeHtml(item.chapter || "Guest moments")}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="muted">${escapeHtml(formatDateTime(item.capturedAt))}</span>
          <span>${escapeHtml(item.caption || item.guestNote || "")}</span>
        </span>
      </button>
    </article>
  `).join("");

  qsaSlides().forEach((button) => {
    button.addEventListener("click", () => openSlide(Number(button.dataset.slide || 0), { autoPlay: false }));
  });
  bindTimelineMediaAspects();
}

function renderSwipeFeed() {
  const feed = qs("#capsuleFeed");
  feed.innerHTML = items.map((item, index) => `
    <article class="capsule-feed-card is-${escapeAttribute(item.mediaType)}${item.mediaType === "photo" ? " is-media-ready" : ""}" data-feed-index="${index}">
      <div class="capsule-feed-media">
        ${renderFeedMedia(item, index)}
      </div>
      <div class="capsule-feed-copy">
        <div class="button-row">
          <span class="status-pill">${escapeHtml(item.chapter || "Guest moments")}</span>
          <span class="status-pill">${escapeHtml(getMediaTypeLabel(item.mediaType))}</span>
        </div>
        <strong>${escapeHtml(item.title || "Time Capsule moment")}</strong>
        <p>${escapeHtml(item.caption || item.guestNote || "")}</p>
        <span>${escapeHtml(formatDateTime(item.capturedAt))}</span>
      </div>
    </article>
  `).join("");

  qsaFeedPlayButtons().forEach((button) => {
    button.addEventListener("click", () => toggleFeedPlayback(Number(button.dataset.feedPlay || 0)));
  });
  qsaPlayableMedia(feed).forEach(bindFeedMediaEvents);
}

function renderFeedMedia(item, index) {
  const rawMediaUrl = inlineMediaUrl(item.mediaUrl);
  const mediaUrl = escapeAttribute(rawMediaUrl);
  const title = escapeAttribute(item.title || "Time Capsule moment");

  if (item.mediaType === "photo") {
    return `<img src="${mediaUrl}" alt="${title}" loading="lazy" />`;
  }

  if (item.mediaType === "audio") {
    return `
      <div class="capsule-feed-audio">
        <div class="voice-memo-panel">
          <div class="voice-memo-header">
            <div class="voice-memo-copy">
              <span class="voice-memo-kicker">Voice memo</span>
              <strong>${escapeHtml(item.title || "Time Capsule voice memo")}</strong>
              <span class="voice-memo-detail">${escapeHtml(item.durationSeconds ? formatDuration(item.durationSeconds) : "Tap play to listen")}</span>
            </div>
          </div>
          <div class="voice-waveform" aria-hidden="true">
            ${[34, 62, 48, 78, 42, 90, 56, 70, 38, 82, 50, 66].map((height) => `<span style="--bar-height: ${height}%"></span>`).join("")}
          </div>
          <audio data-feed-media="${index}" src="${mediaUrl}" preload="metadata"></audio>
        </div>
      </div>
      <button class="capsule-feed-play" type="button" data-feed-play="${index}" aria-label="Play ${title}">
        <span>Tap to play</span>
      </button>
    `;
  }

  return `
    <video data-feed-media="${index}" ${videoPosterAttributes(item)} ${videoSourceAttributes(item)} preload="metadata" playsinline muted></video>
    <button class="capsule-feed-play" type="button" data-feed-play="${index}" data-feed-prompt="video" aria-label="Play ${title}">
      <span>Tap to play</span>
    </button>
  `;
}

function renderSpatialWalk() {
  const walk = qs("#capsuleWalk");
  const fallback = qs("#capsuleWalkFallback");
  const spacer = qs("#capsuleWalkScrollSpacer");
  const walkButton = qs('[data-capsule-view="walk"]');
  const placements = getSpatialWalkPlacements();
  const hasWalk = placements.length > 0;

  if (walkButton) {
    walkButton.hidden = !hasWalk;
    walkButton.parentElement?.classList.toggle("has-walk", hasWalk);
  }

  if (!walk) return;

  if (!hasWalk) {
    walk.hidden = true;
    if (fallback) fallback.innerHTML = "";
    if (spacer) spacer.style.setProperty("--walk-spacer-height", "0px");
    return;
  }

  if (spacer) {
    const spacerHeight = Math.max(720, placements.length * 520);
    spacer.style.setProperty("--walk-spacer-height", `${spacerHeight}px`);
  }

  const pathLabel = spatialLayout?.layoutMode === "timeline_path" || !spatialLayout
    ? "Cinematic memory path"
    : spatialLayout.layoutMode === "visual_cluster"
      ? "Adaptive memory path"
      : "Spatial memory path";
  const summary = capsule?.title || capsule?.name || "this Time Capsule";

  if (fallback) {
    fallback.hidden = Boolean(spatialWalkScene);
    fallback.innerHTML = `
      <div class="capsule-walk-fallback-head">
        <span class="status-pill">${escapeHtml(pathLabel)}</span>
        <strong>Walk through ${escapeHtml(summary)}</strong>
        <p class="capsule-walk-fallback-note">A polished static path is ready while the 3D view loads or when this browser prefers a calmer experience.</p>
      </div>
      <div class="capsule-walk-path">
        ${placements.map(renderSpatialWalkFallbackCard).join("")}
      </div>
    `;
    qsaWalkCards().forEach((button) => {
      button.addEventListener("click", () => openSlide(Number(button.dataset.walkSlide || 0), { autoPlay: false }));
    });
  }
}

function renderSpatialWalkFallbackCard(placement, index) {
  const item = placement.item;
  const cluster = placement.cluster;
  const label = cluster?.label || item.chapter || "Memory path";
  const caption = item.caption || item.guestNote || cluster?.summary || "";
  const itemIndex = stationItemIndex(item);

  return `
    <button class="capsule-walk-card is-${escapeAttribute(item.mediaType || "photo")}" type="button" data-walk-slide="${itemIndex}">
      <span class="capsule-walk-step">${String(index + 1).padStart(2, "0")}</span>
      <div class="capsule-walk-card-media">
        ${renderSpatialWalkFallbackMedia(item)}
      </div>
      <div class="capsule-walk-card-copy">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(item.title || "Time Capsule moment")}</strong>
        <p>${escapeHtml(caption)}</p>
        <small>${escapeHtml(formatDateTime(item.capturedAt))}</small>
      </div>
    </button>
  `;
}

function renderSpatialWalkFallbackMedia(item) {
  const mediaType = String(item.mediaType || "").toLowerCase();
  const title = escapeAttribute(item.title || "Time Capsule moment");

  if (mediaType === "photo" && item.mediaUrl) {
    return `<img src="${escapeAttribute(inlineMediaUrl(item.mediaUrl))}" alt="${title}" loading="lazy" />`;
  }

  if (mediaType === "video") {
    const poster = item.thumbnailUrl || videoPosterUrl(item);
    return `
      <img src="${escapeAttribute(poster)}" alt="${title}" loading="lazy" />
      <span class="capsule-walk-media-badge">Video</span>
    `;
  }

  return `
    <div class="capsule-walk-audio-marker" aria-label="${title}">
      <span></span><span></span><span></span><span></span><span></span>
    </div>
  `;
}

function hasSpatialWalk() {
  return getSpatialWalkPlacements().length > 0;
}

function getSpatialWalkPlacements() {
  if (!spatialLayout || !Array.isArray(spatialPlacements) || !spatialPlacements.length) {
    return buildFallbackSpatialPlacements();
  }

  const itemMap = new Map(items.map((item) => [String(item.id || ""), item]));
  const clusterMap = new Map(spatialClusters.map((cluster) => [String(cluster.id || ""), cluster]));

  return spatialPlacements
    .map((placement, index) => normalizeSpatialPlacement(placement, index, itemMap, clusterMap))
    .filter(Boolean)
    .sort((left, right) => left.routeOrder - right.routeOrder);
}

function buildFallbackSpatialPlacements() {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.item.capturedAt || left.item.createdAt || "");
      const rightTime = Date.parse(right.item.capturedAt || right.item.createdAt || "");
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
        return Number.isFinite(leftTime) ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ item }, routeOrder) => {
      const x = Math.sin(routeOrder * 0.9) * Math.min(3.2, 1.35 + items.length * 0.08);
      const y = 0.1 + (routeOrder % 3) * 0.16;

      return {
        id: `fallback-${item.id || routeOrder}`,
        item,
        cluster: {
          id: `fallback-cluster-${routeOrder}`,
          label: item.chapter || "Memory path",
          summary: "Arranged by the order this Time Capsule was captured."
        },
        routeOrder,
        position: {
          x,
          y,
          z: -routeOrder * 2.2
        },
        rotation: {
          x: 0,
          y: -x * 0.08,
          z: 0
        },
        scale: 1
      };
    });
}

function normalizeSpatialPlacement(placement, index, itemMap, clusterMap) {
  const itemId = String(placement.itemId || placement.timeCapsuleItemId || placement.time_capsule_item_id || "");
  const item = itemMap.get(itemId);
  if (!item) return null;

  const fallbackX = Math.sin(index * 0.88) * 1.8;
  const fallbackY = 0.15 + (index % 3) * 0.18;
  const fallbackZ = -index * 2.15;
  const position = placement.position || {};
  const rotation = placement.rotation || {};
  const clusterId = String(placement.clusterId || placement.cluster_id || "");

  return {
    ...placement,
    item,
    cluster: clusterMap.get(clusterId) || null,
    routeOrder: safeSpatialNumber(placement.routeOrder ?? placement.route_order, index, -10000, 10000),
    position: {
      x: safeSpatialNumber(position.x ?? placement.positionX ?? placement.position_x, fallbackX, -40, 40),
      y: safeSpatialNumber(position.y ?? placement.positionY ?? placement.position_y, fallbackY, -8, 12),
      z: safeSpatialNumber(position.z ?? placement.positionZ ?? placement.position_z, fallbackZ, -80, 20)
    },
    rotation: {
      x: safeSpatialNumber(rotation.x ?? placement.rotationX ?? placement.rotation_x, 0, -Math.PI * 2, Math.PI * 2),
      y: safeSpatialNumber(rotation.y ?? placement.rotationY ?? placement.rotation_y, 0, -Math.PI * 2, Math.PI * 2),
      z: safeSpatialNumber(rotation.z ?? placement.rotationZ ?? placement.rotation_z, 0, -Math.PI * 2, Math.PI * 2)
    },
    scale: safeSpatialNumber(placement.scale, 1, 0.45, 2.4)
  };
}

function getSpatialWalkStations() {
  const placements = getSpatialWalkPlacements();
  return placements.map((placement, index) => buildSpatialStation(placement, index, placements.length));
}

function buildSpatialStation(placement, index, total) {
  const item = placement.item;
  const sourcePosition = placement.position || { x: 0, y: 0, z: 0 };
  const display = getStationDisplaySize(item);
  const clusterSeed = placement.cluster?.id || placement.cluster?.label || item.chapter || "";
  const clusterOffset = clusterSeed
    ? ((hashSpatialText(clusterSeed) % 100) / 100 - 0.5) * 1.25
    : 0;
  const routeCurve = Math.sin(index * 0.72) * SPATIAL_STATION_SIDE_OFFSET;
  const sourceHint = clamp(Number(sourcePosition.x || 0) * 0.18, -1.25, 1.25);
  const focus = {
    x: routeCurve + sourceHint + clusterOffset,
    y: SPATIAL_STATION_FOCUS_HEIGHT + Math.sin(index * 0.41) * 0.22,
    z: -index * SPATIAL_STATION_SPACING
  };
  const cameraPosition = {
    x: focus.x * 0.32,
    y: focus.y + SPATIAL_CAMERA_HEIGHT,
    z: focus.z + SPATIAL_CAMERA_PULLBACK + Math.min(1.4, display.height * 0.18)
  };
  const lookAt = {
    x: focus.x,
    y: focus.y + display.height * 0.04,
    z: focus.z
  };
  const rotationY = Math.atan2(cameraPosition.x - focus.x, cameraPosition.z - focus.z);

  return {
    id: placement.id || `station-${index}`,
    item,
    itemIndex: stationItemIndex(placement.item),
    cluster: placement.cluster || null,
    index,
    total,
    focus,
    cameraPosition: cameraPosition,
    lookAt: lookAt,
    rotation: { x: 0, y: rotationY, z: 0 },
    display,
    tint: spatialTintForStation(placement, index)
  };
}

function stationItemIndex(item) {
  const id = String(item?.id || "");
  const index = items.findIndex((candidate) => String(candidate.id || "") === id);
  return index >= 0 ? index : 0;
}

function getStationDisplaySize(item) {
  const mediaType = String(item?.mediaType || "").toLowerCase();
  if (mediaType === "audio") return { width: 3.2, height: 1.8 };
  const aspect = getStationMediaAspect(item);
  return displaySizeFromAspect(aspect);
}

function getStationMediaAspect(item) {
  const width = Number(item?.displayWidth || item?.mediaWidth || item?.width || 0);
  const height = Number(item?.displayHeight || item?.mediaHeight || item?.height || 0);
  if (width > 0 && height > 0) return width / height;
  const aspect = Number(item?.aspectRatio || item?.mediaAspectRatio || 0);
  if (aspect > 0) return aspect;
  return 3 / 4;
}

function displaySizeFromAspect(aspect) {
  const safeAspect = clamp(Number(aspect) || 0.75, 0.42, 2.4);
  if (safeAspect >= 1) {
    return {
      width: 3.65,
      height: clamp(3.65 / safeAspect, 1.82, 2.9)
    };
  }

  return {
    width: clamp(3.36 * safeAspect, 1.86, 2.95),
    height: 3.36
  };
}

function spatialTintForStation(placement, index) {
  const palette = [0xf7d8c7, 0xfffaf5, 0xded3c8, 0xc9d7cc, 0xe6c7b8];
  const seed = placement.cluster?.id || placement.cluster?.label || placement.item?.chapter || String(index);
  return palette[hashSpatialText(seed) % palette.length];
}

function hashSpatialText(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function canUseWebGl() {
  const canvas = qs("#capsuleWalkCanvas");
  if (!canvas || typeof canvas.getContext !== "function") return false;

  try {
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return Boolean(context);
  } catch {
    return false;
  }
}

async function startSpatialWalkScene() {
  if (!hasSpatialWalk()) return;

  if (spatialWalkScene) {
    hideSpatialWalkFallback();
    resizeSpatialWalkScene();
    requestSpatialWalkFrame();
    return;
  }

  if (spatialWalkStarted) return;
  spatialWalkStarted = true;
  renderSpatialWalk();

  if (prefersReducedMotion()) {
    showSpatialWalkFallback("A still spatial path is shown because reduced motion is enabled.");
    return;
  }

  if (!canUseWebGl()) {
    showSpatialWalkFallback("This browser is showing the static spatial path.");
    return;
  }

  try {
    const THREE = await import("../vendor/three.module.js");
    buildSpatialWalkScene(THREE);
    hideSpatialWalkFallback();
    resizeSpatialWalkScene();
    requestSpatialWalkFrame();
  } catch {
    showSpatialWalkFallback("The 3D scene could not load, so this capsule is showing the static spatial path.");
  }
}

function buildSpatialWalkScene(THREE) {
  const canvas = qs("#capsuleWalkCanvas");
  const stations = getSpatialWalkStations();
  spatialWalkStations = stations;
  spatialActiveStationIndex = 0;
  spatialHoveredStationIndex = -1;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setClearColor(0x171514, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x171514, 16, Math.max(46, stations.length * 7));

  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, Math.max(110, stations.length * 14));
  const ambient = new THREE.AmbientLight(0xfffaf5, 1.2);
  const key = new THREE.DirectionalLight(0xf7d8c7, 2.45);
  const rim = new THREE.DirectionalLight(0xc9d7cc, 1.3);
  key.position.set(4, 7, 8);
  rim.position.set(-5, 4, -8);
  scene.add(ambient, key, rim);

  const routePoints = stations.map((station) => new THREE.Vector3(
    station.focus.x,
    0.04,
    station.focus.z
  ));
  const stationHitMeshes = [];
  addSpatialRouteRibbon(THREE, scene, routePoints);
  stations.forEach((station) => addSpatialStationMesh(THREE, scene, station, stationHitMeshes));

  spatialWalkScene = {
    THREE,
    renderer,
    scene,
    camera,
    routePoints,
    stations,
    stationHitMeshes,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2()
  };
  bindSpatialWalkInteractions(canvas);
  updateSpatialWalkViewButton();
}

function addSpatialRouteRibbon(THREE, scene, routePoints) {
  if (routePoints.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(routePoints);
  const geometry = new THREE.TubeGeometry(curve, Math.max(24, routePoints.length * 14), 0.018, 8, false);
  const material = new THREE.MeshBasicMaterial({
    color: 0xf7d8c7,
    transparent: true,
    opacity: 0.42
  });
  scene.add(new THREE.Mesh(geometry, material));
}

function addSpatialStationMesh(THREE, scene, station, stationHitMeshes) {
  const item = station.item;
  const mediaType = String(item.mediaType || "").toLowerCase();
  const isAudio = mediaType === "audio";
  const width = station.display.width;
  const height = station.display.height;
  const group = new THREE.Group();
  group.userData.stationIndex = station.index;

  const frameGeometry = new THREE.PlaneGeometry(width + 0.16, height + 0.16);
  const frame = new THREE.Mesh(frameGeometry, new THREE.MeshBasicMaterial({
    color: station.tint,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false
  }));
  frame.position.z = -0.026;
  frame.userData.stationIndex = station.index;

  const cardGeometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    color: isAudio ? 0x3f6d58 : 0xfffaf5,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  material.map = spatialTextureForItem(THREE, item, isAudio, material, (texture) => updateSpatialStationMediaAspect(THREE, station, texture));
  material.needsUpdate = true;
  const card = new THREE.Mesh(cardGeometry, material);
  card.userData.stationIndex = station.index;

  const hitGeometry = new THREE.PlaneGeometry(width + 0.52, height + 0.52);
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const hitArea = new THREE.Mesh(hitGeometry, hitMaterial);
  hitArea.position.z = 0.045;
  hitArea.userData.stationIndex = station.index;

  group.add(frame, card, hitArea);
  group.position.set(station.focus.x, station.focus.y, station.focus.z);
  group.rotation.set(station.rotation.x, station.rotation.y, station.rotation.z);
  group.userData.frame = frame;
  group.userData.card = card;
  group.userData.hitArea = hitArea;
  scene.add(group);

  station.group = group;
  station.card = card;
  station.frame = frame;
  stationHitMeshes.push(hitArea);
}

function updateSpatialStationMediaAspect(THREE, station, texture) {
  const image = texture?.image || {};
  const width = Number(image.naturalWidth || image.videoWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.videoHeight || image.height || 0);
  if (!width || !height || !station.card || !station.frame || !station.group?.userData?.hitArea) return;

  const display = displaySizeFromAspect(width / height);
  station.display = display;
  station.cameraPosition = {
    ...station.cameraPosition,
    z: station.focus.z + SPATIAL_CAMERA_PULLBACK + Math.min(1.4, display.height * 0.18)
  };
  station.lookAt = {
    ...station.lookAt,
    y: station.focus.y + display.height * 0.04
  };

  station.card.geometry.dispose?.();
  station.card.geometry = new THREE.PlaneGeometry(display.width, display.height);
  station.frame.geometry.dispose?.();
  station.frame.geometry = new THREE.PlaneGeometry(display.width + 0.16, display.height + 0.16);
  station.group.userData.hitArea.geometry.dispose?.();
  station.group.userData.hitArea.geometry = new THREE.PlaneGeometry(display.width + 0.52, display.height + 0.52);
}

function spatialTextureForItem(THREE, item, isAudio, material, onTextureReady) {
  const fallbackTexture = createSpatialCardTexture(THREE, item);
  if (isAudio) return fallbackTexture;

  const mediaType = String(item.mediaType || "").toLowerCase();
  const textureUrl = mediaType === "video"
    ? item.thumbnailUrl || videoPosterUrl(item)
    : item.mediaUrl
      ? inlineMediaUrl(item.mediaUrl)
      : "";
  if (!textureUrl) return fallbackTexture;

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin?.("anonymous");
  loader.load(textureUrl, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
    material.map = texture;
    material.needsUpdate = true;
    onTextureReady?.(texture);
    requestSpatialWalkFrame();
  }, undefined, () => {
    material.map = fallbackTexture;
    material.needsUpdate = true;
    requestSpatialWalkFrame();
  });
  return fallbackTexture;
}

function createSpatialCardTexture(THREE, item) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 420;
  const context = canvas.getContext("2d");
  const title = item.title || "Time Capsule moment";
  const detail = item.mediaType === "audio" ? "Voice memo" : getMediaTypeLabel(item.mediaType);

  context.fillStyle = "#2f2b28";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = item.mediaType === "audio" ? "#3f6d58" : "#a98776";
  context.globalAlpha = 0.92;
  context.beginPath();
  context.arc(118, 120, 58, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.fillStyle = "#fffaf5";
  context.font = "700 32px Manrope, sans-serif";
  context.fillText(detail, 56, 230);
  context.font = "700 44px Georgia, serif";
  wrapCanvasText(context, title, 56, 292, 532, 48, 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
  return texture;
}

function wrapCanvasText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let lineCount = 0;

  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (context.measureText(nextLine).width > maxWidth && line) {
      context.fillText(line, x, y + lineCount * lineHeight);
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines) return;
    } else {
      line = nextLine;
    }
  }

  if (line && lineCount < maxLines) {
    context.fillText(line, x, y + lineCount * lineHeight);
  }
}

function resizeSpatialWalkScene() {
  if (!spatialWalkScene) return;

  const walk = qs("#capsuleWalk");
  const rect = walk?.getBoundingClientRect?.();
  const width = Math.max(1, Math.round(rect?.width || walk?.clientWidth || 1));
  const height = Math.max(1, Math.round(rect?.height || walk?.clientHeight || 1));

  spatialWalkScene.renderer.setSize(width, height, false);
  spatialWalkScene.camera.aspect = width / height;
  spatialWalkScene.camera.updateProjectionMatrix();
  requestSpatialWalkFrame();
}

function requestSpatialWalkFrame() {
  if (!spatialWalkScene || spatialWalkFrame) return;

  const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
  spatialWalkFrame = requestFrame(() => {
    spatialWalkFrame = 0;
    renderSpatialWalkFrame();
  });
}

function cancelSpatialWalkFrame() {
  if (!spatialWalkFrame) return;

  const cancelFrame = window.cancelAnimationFrame || window.clearTimeout;
  cancelFrame(spatialWalkFrame);
  spatialWalkFrame = 0;
}

function renderSpatialWalkFrame() {
  if (!spatialWalkScene || currentCapsuleView !== "walk") return;

  const { THREE, renderer, scene, camera, stations } = spatialWalkScene;
  const progress = getSpatialScrollProgress();
  const stationCount = stations.length;
  const lookAt = new THREE.Vector3(0, SPATIAL_STATION_FOCUS_HEIGHT, -4);

  if (stationCount > 1) {
    const stationFloat = progress * (stationCount - 1);
    const routeIndex = Math.min(stationCount - 2, Math.floor(stationFloat));
    const segmentProgress = stationFloat - routeIndex;
    const current = stations[routeIndex];
    const next = stations[routeIndex + 1];
    const currentCamera = vectorFromPose(THREE, current.cameraPosition);
    const nextCamera = vectorFromPose(THREE, next.cameraPosition);
    const currentLookAt = vectorFromPose(THREE, current.lookAt);
    const nextLookAt = vectorFromPose(THREE, next.lookAt);
    const eased = easeSpatialStation(segmentProgress);
    camera.position.lerpVectors(currentCamera, nextCamera, eased);
    lookAt.lerpVectors(currentLookAt, nextLookAt, Math.min(1, eased + 0.12));
    updateSpatialStationFocus(stationFloat);
  } else if (stationCount === 1) {
    const station = stations[0];
    camera.position.copy(vectorFromPose(THREE, station.cameraPosition));
    lookAt.copy(vectorFromPose(THREE, station.lookAt));
    updateSpatialStationFocus(0);
  }

  camera.lookAt(lookAt);
  renderer.render(scene, camera);
}

function getSpatialScrollProgress() {
  const walk = qs("#capsuleWalk");
  if (!walk) return 0;

  const maxScroll = Math.max(1, Number(walk.scrollHeight || 0) - Number(walk.clientHeight || 0));
  return clamp(Number(walk.scrollTop || 0) / maxScroll, 0, 1);
}

function vectorFromPose(THREE, pose) {
  return new THREE.Vector3(pose.x, pose.y, pose.z);
}

function easeSpatialStation(value) {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function updateSpatialStationFocus(stationFloat) {
  if (!spatialWalkScene) return;
  const nextActive = clamp(Math.round(stationFloat), 0, spatialWalkStations.length - 1);
  if (nextActive !== spatialActiveStationIndex) {
    spatialActiveStationIndex = nextActive;
    updateSpatialWalkViewButton();
  }

  spatialWalkScene.stations.forEach((station) => {
    if (!station.group || !station.card || !station.frame) return;
    const distance = Math.abs(station.index - stationFloat);
    const near = distance <= SPATIAL_NEAR_STATION_RADIUS;
    const isActive = station.index === spatialActiveStationIndex;
    const isHovered = station.index === spatialHoveredStationIndex;
    const opacity = isActive ? 1 : near ? Math.max(0.34, 0.74 - distance * 0.16) : 0.12;
    const scale = isActive ? 1.06 : near ? Math.max(0.78, 0.94 - distance * 0.08) : 0.58;
    station.group.visible = distance < 4.5;
    station.group.scale.setScalar(isHovered ? scale + 0.05 : scale);
    station.card.material.opacity = opacity;
    station.frame.material.opacity = isHovered ? 0.62 : isActive ? 0.48 : near ? 0.24 : 0.08;
  });
}

function updateSpatialWalkViewButton() {
  const button = qs("#capsuleWalkViewButton");
  const station = spatialWalkStations[spatialActiveStationIndex];
  if (!button || !station) {
    if (button) button.hidden = true;
    return;
  }
  button.hidden = currentCapsuleView !== "walk";
  button.textContent = `View ${String(spatialActiveStationIndex + 1).padStart(2, "0")}`;
  button.setAttribute("aria-label", `View ${station.item.title || "Time Capsule moment"} full screen`);
}

function scrollSpatialWalkToStation(stationIndex) {
  const walk = qs("#capsuleWalk");
  const nextIndex = clamp(Math.round(Number(stationIndex) || 0), 0, spatialWalkStations.length - 1);
  if (!walk || spatialWalkStations.length <= 1) {
    spatialActiveStationIndex = nextIndex;
    updateSpatialWalkViewButton();
    requestSpatialWalkFrame();
    return;
  }
  const maxScroll = Math.max(1, Number(walk.scrollHeight || 0) - Number(walk.clientHeight || 0));
  const top = maxScroll * (nextIndex / (spatialWalkStations.length - 1));
  walk.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function showSpatialWalkFallback(message) {
  const walk = qs("#capsuleWalk");
  const fallback = qs("#capsuleWalkFallback");
  if (walk) walk.classList.remove("is-webgl-ready");
  if (!fallback) return;

  fallback.hidden = false;
  const note = fallback.querySelector?.(".capsule-walk-fallback-note");
  if (note && message) note.textContent = message;
}

function hideSpatialWalkFallback() {
  const fallback = qs("#capsuleWalkFallback");
  const walk = qs("#capsuleWalk");
  if (fallback) fallback.hidden = true;
  if (walk) walk.classList.add("is-webgl-ready");
}

function bindSpatialWalkInteractions(canvas) {
  if (!canvas || spatialWalkInteractionsBound) return;
  spatialWalkInteractionsBound = true;
  canvas.addEventListener("pointermove", handleSpatialWalkPointerMove);
  canvas.addEventListener("pointerleave", clearSpatialWalkHover);
  canvas.addEventListener("click", handleSpatialWalkClick);
}

function handleSpatialWalkPointerMove(event) {
  const station = stationFromSpatialPointer(event);
  spatialHoveredStationIndex = station ? station.index : -1;
  if (event.currentTarget?.style) {
    event.currentTarget.style.cursor = station ? "pointer" : "";
  }
  requestSpatialWalkFrame();
}

function clearSpatialWalkHover(event) {
  spatialHoveredStationIndex = -1;
  if (event?.currentTarget?.style) event.currentTarget.style.cursor = "";
  requestSpatialWalkFrame();
}

function handleSpatialWalkClick(event) {
  const station = stationFromSpatialPointer(event);
  openSpatialWalkStation(station ? station.index : spatialActiveStationIndex);
}

function stationFromSpatialPointer(event) {
  if (!spatialWalkScene || !spatialWalkScene.stationHitMeshes?.length) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const { pointer, raycaster, camera, stationHitMeshes, stations } = spatialWalkScene;
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(stationHitMeshes, false);
  if (!hits.length) return null;
  const stationIndex = Number(hits[0].object.userData.stationIndex);
  return stations[stationIndex] || null;
}

function openSpatialWalkStation(stationIndex) {
  const station = spatialWalkStations[clamp(Math.round(Number(stationIndex) || 0), 0, spatialWalkStations.length - 1)];
  if (!station) return;
  openSlide(station.itemIndex, { autoPlay: false });
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function safeSpatialNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(number, min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setCapsuleView(view, options = {}) {
  if (view === "walk" && !hasSpatialWalk()) {
    view = "timeline";
  }

  currentCapsuleView = view === "feed" && items.length ? "feed" : view === "walk" ? "walk" : "timeline";
  qs("#capsuleTimeline").hidden = currentCapsuleView !== "timeline";
  qs("#capsuleFeed").hidden = currentCapsuleView !== "feed";
  qs("#capsuleWalk").hidden = currentCapsuleView !== "walk";
  updateSpatialWalkViewButton();
  qs("#exitSwipeFeedButton").hidden = currentCapsuleView !== "feed";
  document.body.classList.toggle("is-swipe-feed-active", currentCapsuleView === "feed");
  document.body.classList.toggle("is-spatial-walk-active", currentCapsuleView === "walk");

  if (currentCapsuleView !== "feed") {
    pauseAllFeedMedia();
    if (!options.skipFullscreenExit) exitSwipeFullscreen();
  } else {
    const feed = qs("#capsuleFeed");
    lastFeedScrollTop = 0;
    feedScrollDirection = 0;
    feed.scrollTo({ top: 0, behavior: "smooth" });
    if (options.userInitiated) {
      unlockFeedSound();
      requestSwipeFullscreen();
      scheduleFeedAutoplay();
      scheduleFeedAutoplay(90);
    } else {
      scheduleFeedAutoplay(320);
    }
  }

  if (currentCapsuleView === "walk") {
    renderSpatialWalk();
    startSpatialWalkScene();
  } else {
    cancelSpatialWalkFrame();
  }

  qsaCapsuleViewButtons().forEach((button) => {
    const isActive = button.dataset.capsuleView === currentCapsuleView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

async function requestSwipeFullscreen() {
  const target = qs("#capsuleDashboard");
  const requestFullscreen = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
  if (!requestFullscreen || activeFullscreenElement()) return;

  try {
    await requestFullscreen.call(target, { navigationUI: "hide" });
  } catch {
    try {
      await requestFullscreen.call(target);
    } catch {
      nativeSwipeFullscreenActive = false;
    }
  }
}

async function exitSwipeFullscreen() {
  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (!exitFullscreen || !activeFullscreenElement()) return;

  try {
    await exitFullscreen.call(document);
  } catch {
    nativeSwipeFullscreenActive = false;
  }
}

function activeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

function handleFullscreenChange() {
  const swipeTarget = qs("#capsuleDashboard");
  const slideshowTarget = qs("#slideshowModal");
  const activeElement = activeFullscreenElement();
  const isSwipeFullscreen = activeElement === swipeTarget || Boolean(activeElement && swipeTarget?.contains?.(activeElement));
  const isSlideshowFullscreen = activeElement === slideshowTarget || Boolean(activeElement && slideshowTarget?.contains?.(activeElement));

  if (isSwipeFullscreen) {
    nativeSwipeFullscreenActive = true;
    document.body.classList.add("is-native-swipe-feed");
  } else {
    const wasNativeSwipeFullscreen = nativeSwipeFullscreenActive;
    nativeSwipeFullscreenActive = false;
    document.body.classList.remove("is-native-swipe-feed");

    if (wasNativeSwipeFullscreen && currentCapsuleView === "feed") {
      setCapsuleView("timeline", { skipFullscreenExit: true });
    }
  }

  if (isSlideshowFullscreen) {
    nativeSlideshowFullscreenActive = true;
    document.body.classList.add("is-native-tv-slideshow");
    window.setTimeout(sizeTvSlideFrame, 80);
    return;
  }

  const wasNativeSlideshowFullscreen = nativeSlideshowFullscreenActive;
  nativeSlideshowFullscreenActive = false;
  document.body.classList.remove("is-native-tv-slideshow");

  if (wasNativeSlideshowFullscreen && !slideshowTarget.hidden) {
    closeSlide({ skipFullscreenExit: true });
  }
}

function toggleFeedPlayback(index) {
  const card = qs(`[data-feed-index="${cssEscape(String(index))}"]`);
  const media = card?.querySelector("[data-feed-media]");
  if (!media) return;

  const shouldUnmuteVideo = isFeedVideo(media) && !media.paused && media.muted;
  const shouldPlay = media.paused || shouldUnmuteVideo;
  if (shouldPlay) unlockFeedSound();
  warmFeedAroundCard(qs("#capsuleFeed"), card);
  pauseAllFeedMedia(media);
  setFeedCardPlaying(card, !media.paused);
  setFeedAutoplayBlocked(card, false);

  if (!shouldPlay) {
    media.pause();
    setFeedCardPlaying(card, false);
    return;
  }

  media.play().then(() => {
    setFeedAutoplayBlocked(card, false);
    setFeedCardPlaying(card, true);
  }).catch(() => {
    setFeedAutoplayBlocked(card, true);
    setFeedCardPlaying(card, false);
  });
}

function pauseAllFeedMedia(except = null) {
  qsaPlayableMedia(qs("#capsuleFeed")).forEach((media) => {
    if (media === except) return;
    media.pause();
    setFeedCardPlaying(media.closest?.(".capsule-feed-card"), false);
  });
}

function pauseOffscreenFeedMedia() {
  syncFeedAutoplay();
}

function scheduleFeedAutoplay(delay = 0) {
  window.clearTimeout(feedAutoplayTimer);
  if (delay > 0) {
    feedAutoplayTimer = window.setTimeout(requestFeedAutoplayFrame, delay);
    return;
  }

  requestFeedAutoplayFrame();
}

function requestFeedAutoplayFrame() {
  if (feedAutoplayFrame) return;

  const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
  feedAutoplayFrame = requestFrame(() => {
    feedAutoplayFrame = 0;
    syncFeedAutoplay();
  });
}

function syncFeedAutoplay() {
  const feed = qs("#capsuleFeed");
  const feedRect = feed?.getBoundingClientRect?.();
  if (!feedRect || feed.hidden || currentCapsuleView !== "feed") {
    pauseAllFeedMedia();
    return;
  }

  const activeCard = getGestureFeedCard(feed) || getCenteredFeedCard(feed);
  const activeMedia = activeCard?.querySelector("[data-feed-media]");
  warmFeedAroundCard(feed, activeCard);
  qsaPlayableMedia(feed).forEach((media) => {
    if (media !== activeMedia) {
      media.pause();
      setFeedCardPlaying(media.closest?.(".capsule-feed-card"), false);
    }
  });

  if (activeMedia) autoplayFeedMedia(activeMedia);
}

function getCenteredFeedMedia(feed) {
  return getCenteredFeedCard(feed)?.querySelector("[data-feed-media]") || null;
}

function getCenteredFeedCard(feed) {
  const feedRect = feed?.getBoundingClientRect?.();
  if (!feedRect) return null;

  const feedCenter = feedRect.top + feedRect.height / 2;
  let activeCard = null;
  let activeDistance = Number.POSITIVE_INFINITY;

  qsaFeedCards(feed).forEach((card) => {
    const rect = card.getBoundingClientRect?.();
    if (!rect || rect.bottom <= feedRect.top || rect.top >= feedRect.bottom) return;

    const distance = Math.abs(rect.top + rect.height / 2 - feedCenter);
    if (distance < activeDistance) {
      activeCard = card;
      activeDistance = distance;
    }
  });

  return activeCard;
}

function getGestureFeedCard(feed) {
  const visibleCards = getVisibleFeedCards(feed);
  if (!visibleCards.length || !feedScrollDirection) return null;

  const playableCards = visibleCards.filter((entry) => entry.ratio >= FEED_EARLY_PLAY_VISIBILITY_RATIO);
  if (!playableCards.length) return null;

  return feedScrollDirection > 0
    ? playableCards[playableCards.length - 1].card
    : playableCards[0].card;
}

function getVisibleFeedCards(feed) {
  const feedRect = feed?.getBoundingClientRect?.();
  if (!feedRect) return [];

  return qsaFeedCards(feed)
    .map((card, index) => {
      const rect = card.getBoundingClientRect?.();
      if (!rect || rect.bottom <= feedRect.top || rect.top >= feedRect.bottom) return null;

      const visibleHeight = Math.min(rect.bottom, feedRect.bottom) - Math.max(rect.top, feedRect.top);
      const ratio = Math.max(0, Math.min(1, visibleHeight / Math.max(1, rect.height)));
      return { card, index, ratio };
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);
}

function warmFeedAroundCard(feed, activeCard) {
  const cards = qsaFeedCards(feed);
  if (!cards.length) return;

  const activeIndex = Math.max(0, cards.indexOf(activeCard));
  cards.forEach((card, index) => {
    const distance = Math.abs(index - activeIndex);
    if (distance <= FEED_IMAGE_WARM_RADIUS) primeFeedImage(card);

    const media = card.querySelector("[data-feed-media]");
    if (!media) {
      setFeedCardReady(card, true);
      return;
    }

    if (distance <= FEED_MEDIA_WARM_RADIUS) {
      warmFeedMedia(media);
    } else {
      coolFeedMedia(media);
    }
  });
}

function bindTimelineMediaAspects() {
  document.querySelectorAll(".capsule-memory-card .media-thumb").forEach((frame) => {
    const media = frame.querySelector("img, video");
    bindMediaFrameAspect(frame, media);
  });
}

function bindMediaFrameAspect(frame, media) {
  if (!frame || !media) return;

  const apply = () => {
    const width = media.videoWidth || media.naturalWidth || 0;
    const height = media.videoHeight || media.naturalHeight || 0;
    if (!width || !height) return;
    const aspect = width / height;

    frame.style.setProperty("--media-aspect", `${width} / ${height}`);
    frame.classList.add("has-media-aspect");
    frame.classList.toggle("is-media-portrait", aspect < 0.92);
    frame.classList.toggle("is-media-landscape", aspect > 1.08);
    frame.classList.toggle("is-media-square", aspect >= 0.92 && aspect <= 1.08);
  };

  if (media.tagName === "VIDEO") {
    media.addEventListener("loadedmetadata", apply, { once: true });
  } else if (media.complete) {
    apply();
  } else {
    media.addEventListener("load", apply, { once: true });
  }
}

function warmFeedMedia(media) {
  if (!media) return;
  const card = media.closest?.(".capsule-feed-card");

  media.preload = "auto";
  if (isFeedMediaReady(media)) {
    setFeedCardReady(card, true);
    return;
  }

  setFeedCardReady(card, false);
  if (media.dataset.feedWarmState !== "warming") {
    media.dataset.feedWarmState = "warming";
    media.load?.();
  }
}

function coolFeedMedia(media) {
  if (!media) return;
  media.preload = "metadata";
  delete media.dataset.feedWarmState;
}

function primeFeedImage(card) {
  const image = card?.querySelector("img");
  if (!image) return;

  image.loading = "eager";
  image.decoding = "async";
  if (image.complete) {
    setFeedCardReady(card, true);
    return;
  }

  if (typeof image.decode === "function" && image.dataset.feedImageDecode !== "warming") {
    image.dataset.feedImageDecode = "warming";
    image.decode().then(() => setFeedCardReady(card, true)).catch(() => {
      image.dataset.feedImageDecode = "fallback";
    });
  }
}

function autoplayFeedMedia(media) {
  const card = media.closest?.(".capsule-feed-card");
  if (!card || !media.paused) {
    setFeedCardPlaying(card, Boolean(media && !media.paused));
    return;
  }

  if (isFeedVideo(media)) {
    media.muted = !feedSoundUnlocked;
  }

  warmFeedMedia(media);
  media.play().catch(async () => {
    if (isFeedVideo(media) && !media.muted) {
      media.muted = true;
      try {
        await media.play();
        return "muted";
      } catch {
        return "blocked";
      }
    }

    return "blocked";
  }).then((result) => {
    const isBlocked = result === "blocked";
    setFeedAutoplayBlocked(card, isBlocked);
    setFeedCardPlaying(card, !isBlocked);
  });
}

function bindFeedMediaEvents(media) {
  const card = media.closest?.(".capsule-feed-card");
  if (!card) return;

  const markReady = () => {
    delete media.dataset.feedWarmState;
    setFeedCardReady(card, true);
  };
  const markLoading = () => {
    if (!isFeedMediaReady(media)) setFeedCardReady(card, false);
  };

  if (isFeedMediaReady(media)) markReady();
  else markLoading();

  media.addEventListener("loadeddata", markReady);
  media.addEventListener("canplay", markReady);
  media.addEventListener("playing", markReady);
  media.addEventListener("loadstart", markLoading);
  media.addEventListener("waiting", markLoading);
  media.addEventListener("play", () => {
    setFeedAutoplayBlocked(card, false);
    setFeedCardPlaying(card, true);
  });
  media.addEventListener("click", () => toggleFeedPlayback(Number(media.dataset.feedMedia || 0)));
  media.addEventListener("pause", () => setFeedCardPlaying(card, false));
  media.addEventListener("ended", () => setFeedCardPlaying(card, false));
  media.addEventListener("volumechange", () => {
    if (isFeedVideo(media) && !media.muted) unlockFeedSound();
  });
}

function unlockFeedSound() {
  feedSoundUnlocked = true;
  qsaFeedVideos().forEach((video) => {
    video.muted = false;
  });
}

function setFeedCardPlaying(card, isPlaying) {
  if (!card) return;
  card.classList.toggle("is-playing", isPlaying);
  const button = card.querySelector("[data-feed-play]");
  if (button) button.querySelector("span").textContent = feedPlayButtonLabel(card, isPlaying);
}

function setFeedAutoplayBlocked(card, isBlocked) {
  if (!card) return;
  card.classList.toggle("is-autoplay-blocked", isBlocked);
}

function setFeedCardReady(card, isReady) {
  if (!card) return;
  const hasMedia = Boolean(card.querySelector("[data-feed-media]"));
  card.classList.toggle("is-media-ready", isReady);
  card.classList.toggle("is-media-loading", hasMedia && !isReady);
}

function isFeedMediaReady(media) {
  return Number(media?.readyState || 0) >= FEED_PLAYABLE_READY_STATE;
}

function feedPlayButtonLabel(card, isPlaying) {
  const media = card?.querySelector("[data-feed-media]");
  if (!media) return isPlaying ? "Tap to pause" : "Tap to play";
  if (card.classList.contains("is-autoplay-blocked")) {
    return isFeedAudio(media) ? "Tap to listen" : "Tap to play";
  }
  if (isPlaying && isFeedVideo(media) && media.muted) return "Tap for sound";
  if (isPlaying) return "Tap to pause";
  return isFeedAudio(media) ? "Tap to listen" : "Tap to play";
}

function isFeedVideo(media) {
  return media?.tagName?.toLowerCase() === "video";
}

function isFeedAudio(media) {
  return media?.tagName?.toLowerCase() === "audio";
}

function openSlide(index, options = {}) {
  if (!items.length) return;
  slideIndex = normalizeSlideIndex(index);
  slideAutoPlaying = options.autoPlay !== false;
  lastFocusedElement = document.activeElement;
  document.body.classList.add("modal-open", "is-tv-slideshow-active");
  qs("#slideshowModal").hidden = false;
  revealSlideshowControls();
  updateSlidePlayPauseButton();
  if (options.requestFullscreen) requestSlideshowFullscreen();
  renderSlide();
  qs("#slideClose").focus();
}

function renderSlide() {
  const item = items[slideIndex];
  const stage = qs("#slideStage");
  clearSlideAdvance();
  qsaPlayableMedia(stage).forEach((media) => media.pause());
  stage.innerHTML = "";
  qs("#slideTitle").textContent = item.title || "Time Capsule moment";
  qs("#slideMeta").textContent = `${slideIndex + 1} / ${items.length} | ${item.chapter || "Guest moments"} | ${formatDateTime(item.capturedAt)}`;
  qs("#slideCaption").textContent = item.caption || item.guestNote || "";

  const { frame, media } = createTvSlideFrame(item);
  stage.append(frame);
  sizeTvSlideFrame();
  window.setTimeout(sizeTvSlideFrame, 80);
  hydrateVideoPosters(stage);
  hydrateStreamVideos(stage);
  updateSlidePlayPauseButton();

  if (item.mediaType === "photo") {
    scheduleSlideAdvance(PHOTO_SLIDE_DURATION_MS);
  } else if (media) {
    bindSlidePlayback(media);
    if (slideAutoPlaying) playSlideMedia(media);
  }
}

function createTvSlideFrame(item) {
  const frame = document.createElement("div");
  frame.className = "tv-slide-frame is-" + (item.mediaType || "media");
  const backdrop = document.createElement("div");
  backdrop.className = "tv-slide-backdrop";
  const backdropMedia = createTvSlideBackdropMedia(item);
  if (backdropMedia) backdrop.append(backdropMedia);
  const foreground = document.createElement("div");
  foreground.className = "tv-slide-foreground-wrap";
  const content = createTvSlideForeground(item);
  bindTvMediaOrientation(content.element, frame);
  foreground.append(content.element);
  frame.append(backdrop, foreground);
  return { frame, media: content.media };
}

function createTvSlideBackdropMedia(item) {
  if (item.mediaType === "audio") return null;

  const image = document.createElement("img");
  image.className = "tv-slide-backdrop-media";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.decoding = "async";
  image.src = item.mediaType === "photo"
    ? inlineMediaUrl(item.mediaUrl)
    : item.thumbnailUrl || videoPosterUrl(item);
  return image;
}

function createTvSlideForeground(item) {
  if (item.mediaType === "photo") {
    const image = document.createElement("img");
    image.className = "tv-slide-foreground";
    image.src = inlineMediaUrl(item.mediaUrl);
    image.alt = item.title || "Time Capsule photo";
    image.decoding = "async";
    return { element: image, media: null };
  }

  if (item.mediaType === "audio") {
    const panel = document.createElement("div");
    panel.className = "tv-audio-stage tv-slide-foreground";
    panel.innerHTML = `
      <div class="tv-audio-mark" aria-hidden="true">
        ${[38, 72, 52, 88, 46, 96, 58, 76, 42, 84].map((height) => `<span style="--bar-height: ${height}%"></span>`).join("")}
      </div>
      <div class="tv-audio-copy">
        <span>Voice memo</span>
        <strong>${escapeHtml(item.title || "Time Capsule voice memo")}</strong>
        <p>${escapeHtml(item.caption || item.guestNote || "Listen to this memory from the event.")}</p>
      </div>
    `;
    const audio = document.createElement("audio");
    audio.src = inlineMediaUrl(item.mediaUrl);
    audio.controls = true;
    audio.preload = "auto";
    panel.append(audio);
    return { element: panel, media: audio };
  }

  const template = document.createElement("template");
  template.innerHTML = `<video class="tv-slide-foreground" ${videoPosterAttributes(item)} ${videoSourceAttributes(item)} preload="auto" playsinline controls></video>`;
  const video = template.content.firstElementChild;
  video.controls = true;
  video.playsInline = true;
  video.preload = "auto";
  prepareTvVideoForMirroring(video);
  return { element: video, media: video };
}

function prepareTvVideoForMirroring(video) {
  video.playsInline = true;
  video.disableRemotePlayback = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("disableRemotePlayback", "");
  video.setAttribute("x-webkit-airplay", "deny");
}

function bindTvMediaOrientation(element, frame) {
  if (!element || element.tagName?.toLowerCase() === "div") return;

  const update = () => applyTvMediaOrientation(element, frame);
  element.classList.add("is-orientation-pending");
  if (element.tagName?.toLowerCase() === "video") {
    element.addEventListener("loadedmetadata", update);
  } else {
    element.addEventListener("load", update);
  }
  update();
}

function applyTvMediaOrientation(element, frame = element?.closest?.(".tv-slide-frame")) {
  const size = getTvMediaIntrinsicSize(element);
  if (!size.width || !size.height) return;

  const aspect = size.width / size.height;
  const orientation = aspect < 0.85 ? "portrait" : aspect > 1.15 ? "landscape" : "square";
  const orientationClasses = ["is-orientation-pending", "is-portrait", "is-landscape", "is-square"];

  [element, frame].forEach((target) => {
    if (!target) return;
    target.classList.remove(...orientationClasses);
    target.classList.add(`is-${orientation}`);
    target.style.setProperty("--media-aspect", aspect.toFixed(4));
  });
  window.requestAnimationFrame(sizeTvSlideFrame);
}

function getTvMediaIntrinsicSize(element) {
  const tagName = element?.tagName?.toLowerCase();
  if (tagName === "video") {
    return {
      width: Number(element.videoWidth || 0),
      height: Number(element.videoHeight || 0)
    };
  }

  return {
    width: Number(element.naturalWidth || 0),
    height: Number(element.naturalHeight || 0)
  };
}

function bindSlidePlayback(media) {
  if (!media) return;

  if (media.tagName?.toLowerCase() === "video") {
    const video = media;
    video.addEventListener("ended", advanceSlideAfterPlayback, { once: true });
  } else {
    const audio = media;
    audio.addEventListener("ended", advanceSlideAfterPlayback, { once: true });
  }

  media.addEventListener("error", () => scheduleSlideAdvance(SLIDE_ERROR_ADVANCE_MS), { once: true });
}

function playSlideMedia(media) {
  if (!slideAutoPlaying || !media || typeof media.play !== "function") return;

  media.play().catch(() => {
    // Keep native controls available if a browser blocks unattended playback after fullscreen.
  });
}

function scheduleSlideAdvance(delayMs) {
  clearSlideAdvance();
  if (!slideAutoPlaying || items.length < 2) return;
  slideAdvanceTimer = window.setTimeout(advanceSlideAfterPlayback, delayMs);
}

function clearSlideAdvance() {
  window.clearTimeout(slideAdvanceTimer);
  slideAdvanceTimer = 0;
}

function revealSlideshowControls() {
  const modal = qs("#slideshowModal");
  if (!modal || modal.hidden) return;

  modal.classList.remove("is-controls-hidden");
  window.clearTimeout(slideshowControlsTimer);
  slideshowControlsTimer = window.setTimeout(() => {
    if (!modal.hidden) modal.classList.add("is-controls-hidden");
  }, 4200);
}

function advanceSlideAfterPlayback() {
  if (!slideAutoPlaying || !items.length) return;
  changeSlide(1);
}

function toggleSlideAutoPlay() {
  slideAutoPlaying = !slideAutoPlaying;
  updateSlidePlayPauseButton();

  if (!slideAutoPlaying) {
    clearSlideAdvance();
    qsaPlayableMedia(qs("#slideStage")).forEach((media) => media.pause());
    return;
  }

  const currentMedia = qsaPlayableMedia(qs("#slideStage"))[0];
  if (currentMedia) {
    playSlideMedia(currentMedia);
  } else {
    scheduleSlideAdvance(PHOTO_SLIDE_DURATION_MS);
  }
}

function updateSlidePlayPauseButton() {
  const button = qs("#slidePlayPause");
  button.textContent = slideAutoPlaying ? "Pause" : "Play";
  button.setAttribute("aria-pressed", String(slideAutoPlaying));
}

function sizeTvSlideFrame() {
  const modal = qs("#slideshowModal");
  const stage = qs("#slideStage");
  const frame = stage?.querySelector(".tv-slide-frame");
  if (!frame || modal?.hidden) return;

  const stageRect = stage.getBoundingClientRect?.();
  if (!stageRect?.width || !stageRect?.height) return;

  const width = Math.max(1, Math.min(stageRect.width, stageRect.height * (16 / 9)));
  frame.style.width = `${width}px`;
  frame.style.height = `${width * (9 / 16)}px`;
  sizeTvForeground(frame);
}

function sizeTvForeground(frame) {
  const media = frame?.querySelector(".tv-slide-foreground.is-portrait, .tv-slide-foreground.is-landscape, .tv-slide-foreground.is-square");
  const wrap = frame?.querySelector(".tv-slide-foreground-wrap");
  if (!media || !wrap || media.classList.contains("tv-audio-stage")) return;

  const frameRect = frame.getBoundingClientRect?.();
  if (!frameRect?.width || !frameRect?.height) return;

  const wrapStyle = window.getComputedStyle(wrap);
  const horizontalPadding = parseFloat(wrapStyle.paddingLeft || "0") + parseFloat(wrapStyle.paddingRight || "0");
  const verticalPadding = parseFloat(wrapStyle.paddingTop || "0") + parseFloat(wrapStyle.paddingBottom || "0");
  const availableWidth = Math.max(1, frameRect.width - horizontalPadding);
  const availableHeight = Math.max(1, frameRect.height - verticalPadding);
  const aspect = Number.parseFloat(media.style.getPropertyValue("--media-aspect") || frame.style.getPropertyValue("--media-aspect") || "1");
  if (!Number.isFinite(aspect) || aspect <= 0) return;

  let width = availableWidth;
  let height = width / aspect;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * aspect;
  }

  media.style.width = `${Math.round(width)}px`;
  media.style.height = `${Math.round(height)}px`;
}

async function requestSlideshowFullscreen() {
  const target = qs("#slideshowModal");
  const requestFullscreen = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
  if (!requestFullscreen || activeFullscreenElement()) return;

  try {
    await requestFullscreen.call(target, { navigationUI: "hide" });
  } catch {
    try {
      await requestFullscreen.call(target);
    } catch {
      nativeSlideshowFullscreenActive = false;
    }
  }
}

function changeSlide(delta) {
  slideIndex = normalizeSlideIndex(slideIndex + delta);
  renderSlide();
}

async function exitSlideshowFullscreen() {
  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (!exitFullscreen || !activeFullscreenElement()) return;

  try {
    await exitFullscreen.call(document);
  } catch {
    nativeSlideshowFullscreenActive = false;
  }
}

function closeSlide(options = {}) {
  clearSlideAdvance();
  window.clearTimeout(slideshowControlsTimer);
  qsaPlayableMedia(qs("#slideStage")).forEach((media) => media.pause());
  qs("#slideStage").innerHTML = "";
  qs("#slideshowModal").hidden = true;
  qs("#slideshowModal").classList.remove("is-controls-hidden");
  document.body.classList.remove("modal-open", "is-tv-slideshow-active", "is-native-tv-slideshow");
  nativeSlideshowFullscreenActive = false;
  if (!options.skipFullscreenExit) exitSlideshowFullscreen();
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

function showError(message) {
  document.body.classList.remove("is-swipe-feed-active", "is-spatial-walk-active");
  qs("#capsuleTitle").textContent = "Time Capsule unavailable";
  qs("#capsuleMeta").textContent = "Ask the event host for the current private link.";
  setNotice(qs("#capsuleNotice"), message, "error");
  qs("#capsuleEmpty").hidden = true;
  qs("#capsuleWalk").hidden = true;
}

function readShareToken() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("token") || query.get("token") || "";
}

function normalizeSlideIndex(index) {
  return (index + items.length) % items.length;
}

function qsaSlides() {
  return Array.from(document.querySelectorAll("[data-slide]"));
}

function qsaCapsuleViewButtons() {
  return Array.from(document.querySelectorAll("[data-capsule-view]"));
}

function qsaFeedPlayButtons() {
  return Array.from(document.querySelectorAll("[data-feed-play]"));
}

function qsaPlayableMedia(root) {
  return Array.from(root?.querySelectorAll("video, audio") || []);
}

function qsaFeedVideos() {
  const feed = qs("#capsuleFeed");
  return feed ? Array.from(feed.querySelectorAll("video[data-feed-media]")) : [];
}

function qsaFeedCards(feed) {
  return Array.from(feed?.querySelectorAll(".capsule-feed-card") || []);
}

function qsaWalkCards() {
  return document.querySelectorAll("[data-walk-slide]");
}

function getMediaTypeLabel(mediaType) {
  if (mediaType === "audio") return "Voice memo";
  if (mediaType === "video") return "Video";
  return "Photo";
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function hydrateVideoPosters(root = document) {
  qsaVideoPosterTargets(root).forEach((video) => {
    const sourceUrl = video.dataset.videoPosterUrl;
    if (!sourceUrl || video.dataset.videoPosterState === "loading") return;

    video.dataset.videoPosterState = "loading";
    getGeneratedVideoPoster(sourceUrl).then((poster) => {
      if (poster && video.isConnected !== false) {
        video.poster = poster;
        video.dataset.videoPosterState = "ready";
        persistGeneratedVideoPoster(video, poster);
      } else {
        video.dataset.videoPosterState = "fallback";
      }
    });
  });
}

function qsaVideoPosterTargets(root = document) {
  return Array.from(root.querySelectorAll("video[data-video-poster-url]"));
}

function hydrateStreamVideos(root = document) {
  Array.from(root.querySelectorAll("video[data-stream-url]")).forEach((video) => {
    const streamUrl = video.dataset.streamUrl;
    if (!streamUrl || video.dataset.streamState) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.dataset.streamState = "native";
      video.load?.();
      return;
    }

    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        maxBufferLength: 16,
        maxMaxBufferLength: 28,
        startFragPrefetch: true
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      video.dataset.streamState = "hls";
      video.wallflowerHls = hls;
      return;
    }

    video.dataset.streamState = "fallback";
  });
}

function getGeneratedVideoPoster(sourceUrl) {
  if (!videoPosterCache.has(sourceUrl)) {
    videoPosterCache.set(sourceUrl, captureVideoPoster(sourceUrl).catch(() => ""));
  }
  return videoPosterCache.get(sourceUrl);
}

async function captureVideoPoster(sourceUrl) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;

  try {
    await waitForMediaEvent(video, "loadedmetadata", 5000);
    await waitForMediaEvent(video, "loadeddata", 5000).catch(() => undefined);

    let bestFrame = null;
    for (const time of posterSampleTimes(video.duration)) {
      await seekVideo(video, time);
      const frame = captureVideoFrame(video);
      if (!frame) continue;

      if (!bestFrame || frame.score > bestFrame.score) {
        bestFrame = frame;
      }
      if (frame.score >= 34) break;
    }

    return bestFrame && bestFrame.score >= 14 ? bestFrame.dataUrl : "";
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

function posterSampleTimes(duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 3;
  const latestSample = Math.max(0.08, Math.min(safeDuration - 0.08, 8));
  const relativeSamples = [0.08, 0.18, 0.32, 0.48].map((ratio) => safeDuration * ratio);
  return [0.12, 0.35, 0.75, 1.25, 2, 3.5, 5, latestSample, ...relativeSamples]
    .map((time) => Math.min(Math.max(0.08, time), latestSample))
    .sort((left, right) => left - right)
    .filter((time, index, times) => index === 0 || Math.abs(time - times[index - 1]) > 0.04);
}

async function seekVideo(video, time) {
  const targetTime = Math.max(0, Number(time) || 0);
  if (video.readyState >= 2 && Math.abs(video.currentTime - targetTime) < 0.04) {
    await waitForVideoFrame(video);
    return;
  }

  const seeked = waitForMediaEvent(video, "seeked", 1800);
  video.currentTime = targetTime;
  await seeked.catch(() => undefined);
  if (video.readyState < 2) {
    await waitForMediaEvent(video, "loadeddata", 1200).catch(() => undefined);
  }
  if (targetTime > 0.08 && Math.abs(video.currentTime - targetTime) > 0.12) {
    await playVideoUntil(video, targetTime);
  }
  await waitForVideoFrame(video);
}

function captureVideoFrame(video) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const canvas = document.createElement("canvas");
  const width = Math.min(720, sourceWidth);
  const height = Math.max(1, Math.round(sourceHeight * (width / sourceWidth)));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const score = scoreVideoFrame(imageData.data);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.82),
    score
  };
}

function scoreVideoFrame(data) {
  let luminanceTotal = 0;
  let brightPixels = 0;
  let saturatedPixels = 0;
  const pixelCount = Math.max(1, data.length / 4);

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luminanceTotal += luminance;
    if (luminance > 42) brightPixels += 1;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 28) saturatedPixels += 1;
  }

  const averageLuminance = luminanceTotal / pixelCount;
  const brightRatio = brightPixels / pixelCount;
  const saturatedRatio = saturatedPixels / pixelCount;
  return averageLuminance + brightRatio * 38 + saturatedRatio * 24;
}

function waitForMediaEvent(element, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} timed out`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${eventName} failed`));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      element.removeEventListener(eventName, onEvent);
      element.removeEventListener("error", onError);
    };

    element.addEventListener(eventName, onEvent, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

function waitForVideoFrame(video, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);

    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(finish);
      return;
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });
}

async function playVideoUntil(video, targetTime, timeoutMs = 2800) {
  if (typeof video.play !== "function") return;

  try {
    await video.play();
    await waitForVideoTime(video, targetTime, timeoutMs);
  } catch {
    // Muted autoplay can still be blocked by some browsers; the generic poster stays as a safe fallback.
  } finally {
    if (typeof video.pause === "function") video.pause();
  }
}

function waitForVideoTime(video, targetTime, timeoutMs) {
  const target = Math.max(0, Number(targetTime) || 0);
  return new Promise((resolve) => {
    let frameRequest = 0;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frameRequest);
      video.removeEventListener("timeupdate", check);
      video.removeEventListener("ended", finish);
      resolve();
    };
    const check = () => {
      if (video.currentTime + 0.05 >= target || video.ended) {
        finish();
        return;
      }
      frameRequest = window.requestAnimationFrame(check);
    };
    const timeout = window.setTimeout(finish, timeoutMs);

    video.addEventListener("timeupdate", check);
    video.addEventListener("ended", finish, { once: true });
    check();
  });
}

function persistGeneratedVideoPoster(video, poster) {
  const uploadUrl = video.dataset.thumbnailUploadUrl;
  if (!uploadUrl || !poster || !poster.startsWith("data:image/") || videoPosterPersistCache.has(uploadUrl)) return;

  videoPosterPersistCache.add(uploadUrl);

  try {
    const formData = new FormData();
    formData.append("thumbnail", dataUrlToBlob(poster), "wallflower-video-thumbnail.jpg");
    window.fetch(uploadUrl, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData
    }).catch(() => undefined);
  } catch {
    videoPosterPersistCache.delete(uploadUrl);
  }
}

function videoPosterAttributes(item) {
  if (item.thumbnailUrl) {
    return `poster="${escapeAttribute(item.thumbnailUrl)}"`;
  }

  const sourceUrl = inlineMediaUrl(item.mediaUrl);
  const uploadAttribute = item.thumbnailUploadUrl
    ? ` data-thumbnail-upload-url="${escapeAttribute(item.thumbnailUploadUrl)}"`
    : "";
  return `poster="${escapeAttribute(videoPosterUrl(item))}" data-video-poster-url="${escapeAttribute(sourceUrl)}"${uploadAttribute} crossorigin="anonymous"`;
}

function videoSourceAttributes(item) {
  const preferredUrl = item.streamUrl || item.mediaUrl;
  const fallbackUrl = preferredUrl === item.streamUrl ? item.mediaUrl : preferredUrl;
  const streamAttribute = item.streamUrl
    ? ` data-stream-url="${escapeAttribute(item.streamUrl)}"`
    : "";
  return `src="${escapeAttribute(inlineMediaUrl(fallbackUrl))}"${streamAttribute}`;
}

function inlineMediaUrl(url) {
  const value = String(url || "");
  return `${value}${value.includes("?") ? "&" : "?"}disposition=inline`;
}

function videoPosterUrl(item) {
  const title = posterText(item.title || "Video moment", 34);
  const chapter = posterText(item.chapter || "Time Capsule", 24);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f7d8c7"/>
          <stop offset="0.52" stop-color="#8fb8a2"/>
          <stop offset="1" stop-color="#2f2926"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="1600" fill="url(#bg)"/>
      <path d="M0 1060 1200 760v840H0z" fill="#201c1a" opacity="0.86"/>
      <rect x="128" y="1170" width="944" height="6" rx="3" fill="#fffaf5" opacity="0.38"/>
      <circle cx="600" cy="680" r="156" fill="#fffaf5" opacity="0.9"/>
      <path d="M565 596v168l146-84z" fill="#2f2926"/>
      <text x="128" y="1256" fill="#fffaf5" font-family="Arial, sans-serif" font-size="42" font-weight="700" letter-spacing="4">${escapeHtml(chapter).toUpperCase()}</text>
      <text x="128" y="1356" fill="#fffaf5" font-family="Arial, sans-serif" font-size="76" font-weight="800">${escapeHtml(title)}</text>
      <text x="128" y="1432" fill="#fffaf5" font-family="Arial, sans-serif" font-size="40" font-weight="700" opacity="0.78">Tap to play video</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function posterText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
