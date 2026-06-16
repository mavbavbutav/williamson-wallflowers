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
let spatialWalkLastTime = 0;
let spatialWalkClock = 0;
let spatialTourPlaying = true;
let spatialTourProgress = 0;
let spatialTourTarget = 0;
let spatialTourHoldMs = 0;
let spatialScrubProgress = 0;
let spatialLastInteractionTime = 0;
let spatialArrivalProgress = 1;
let spatialWalkQuality = "high";
let spatialWalkSoundUnlocked = false;
let spatialTourActive = false;
let spatialWalkControlsTimer = 0;
const spatialPointerParallax = { x: 0, y: 0 };
const spatialPointerParallaxTarget = { x: 0, y: 0 };
let slideIndex = 0;
let lastFocusedElement = null;
let currentCapsuleView = "timeline";
let feedAutoplayTimer = 0;
let feedAutoplayFrame = 0;
let feedScrollDirection = 0;
let lastFeedScrollTop = 0;
let feedSoundUnlocked = false;
let nativeSwipeFullscreenActive = false;
let nativeSpatialWalkFullscreenActive = false;
let spatialWalkCssFullscreen = false;
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
const SPATIAL_STATION_SIZE_MULTIPLIER = 1.32;
const SPATIAL_FEATURED_STATION_SCALE = 1.16;
const SPATIAL_DUST_PARTICLE_MULTIPLIER = 1.1;
const SPATIAL_CAMERA_PULLBACK = 7;
const SPATIAL_CAMERA_SAFE_PULLBACK = 1.15;
const SPATIAL_CAMERA_HEIGHT = 2.15;
const SPATIAL_STATION_FOCUS_HEIGHT = 1.35;
const SPATIAL_GROUND_CLEARANCE = 1.35;
const SPATIAL_PLACARD_GAP = 0.22;
const SPATIAL_MEDIA_WARM_RADIUS = 2;
const SPATIAL_CAMERA_FOV = 42;
const SPATIAL_FIT_MARGIN = 1.32;
const SPATIAL_NEAR_STATION_RADIUS = 2.35;
const SPATIAL_VIDEO_PLAY_RADIUS = 0.72;
const SPATIAL_TOUR_DWELL_MS = 2600;
const SPATIAL_TOUR_VIDEO_MIN_DWELL_MS = 8000;
const SPATIAL_TOUR_VIDEO_FALLBACK_DWELL_MS = 31000;
const SPATIAL_TOUR_VIDEO_MAX_DWELL_MS = 34000;
const SPATIAL_TOUR_VIDEO_END_BUFFER_MS = 0;
const SPATIAL_TOUR_TRAVEL_MS = 2600;
const SPATIAL_TOUR_RESUME_MS = 6000;
const SPATIAL_ARRIVAL_MS = 2600;
const SPATIAL_IDLE_FLOAT = 0.07;
const SPATIAL_PARALLAX_STRENGTH = 0.6;
const SPATIAL_CAMERA_DAMP = 0.18;

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
  qs("#capsuleWalk")?.addEventListener("scroll", handleSpatialWalkScroll, { passive: true });
  qs("#capsuleWalk")?.addEventListener("pointermove", revealSpatialWalkControls, { passive: true });
  qs("#capsuleWalk")?.addEventListener("pointerdown", revealSpatialWalkControls, { passive: true });
  qs("#capsuleWalk")?.addEventListener("touchstart", revealSpatialWalkControls, { passive: true });
  qs("#capsuleWalkTourToggle")?.addEventListener("click", toggleSpatialTour);
  qs("#capsuleWalkSoundButton")?.addEventListener("click", toggleSpatialWalkSound);
  qs("#capsuleWalkFullscreenButton")?.addEventListener("click", toggleSpatialWalkFullscreen);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseSpatialWalkVideos();
      stopSpatialWalkLoop();
    }
    else if (currentCapsuleView === "walk" && spatialWalkScene) startSpatialWalkLoop();
  });
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
      if (event.key === "Escape" && spatialWalkCssFullscreen) {
        event.preventDefault();
        exitSpatialWalkCssFullscreen();
      }
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
  const caption = getSpatialMomentCaption(placement);
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

function getSpatialMomentCaption(placement) {
  // Only the guest's own words — no machine-written descriptions.
  const item = placement?.item || {};
  return cleanCaptionText(item.caption || item.guestNote);
}

function cleanCaptionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  const centerY = stationCenterY(display.height);
  const focus = {
    x: routeCurve + sourceHint + clusterOffset,
    y: centerY,
    z: -index * SPATIAL_STATION_SPACING
  };
  const cameraPosition = stationCameraPose(focus, display);
  const lookAt = stationLookAt(focus, display);
  const rotationY = Math.atan2(cameraPosition.x - focus.x, cameraPosition.z - focus.z);

  return {
    id: placement.id || `station-${index}`,
    item,
    itemIndex: stationItemIndex(placement.item),
    placement,
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
    const width = 3.65 * SPATIAL_STATION_SIZE_MULTIPLIER;
    return {
      width,
      height: clamp(width / safeAspect, 2.08, 3.42)
    };
  }

  const height = 3.36 * SPATIAL_STATION_SIZE_MULTIPLIER;
  return {
    width: clamp(height * safeAspect, 2.12, 3.48),
    height
  };
}

function stationCenterY(displayHeight) {
  return Math.max(SPATIAL_STATION_FOCUS_HEIGHT, displayHeight / 2 + SPATIAL_GROUND_CLEARANCE);
}

function stationCameraPose(focus, display) {
  // Pull back far enough that the whole frame (its full height) fits inside the
  // vertical field of view — tall 9:16 media included — so nothing is clipped.
  const halfFovTan = Math.tan((SPATIAL_CAMERA_FOV * Math.PI / 180) / 2);
  const fitDistance = (display.height / 2) / halfFovTan * SPATIAL_FIT_MARGIN;
  const distance = Math.max(SPATIAL_CAMERA_PULLBACK, fitDistance) + SPATIAL_CAMERA_SAFE_PULLBACK;
  return {
    x: focus.x * 0.32,
    y: focus.y + display.height * 0.05,
    z: focus.z + distance
  };
}

function stationLookAt(focus, display) {
  // Look near the frame's center (only a touch low to seat the placard) so the
  // top of tall media is never cut and the bottom space is used.
  return {
    x: focus.x,
    y: focus.y - display.height * 0.06,
    z: focus.z
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
    await buildSpatialWalkComposer(THREE);
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
  spatialWalkQuality = getWalkQuality();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setClearColor(0x0d0c0b, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, spatialWalkQuality === "lite" ? 1.25 : 1.5));
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0c0b);
  scene.fog = new THREE.Fog(0x0d0c0b, 13, Math.max(48, stations.length * 8));

  const camera = new THREE.PerspectiveCamera(SPATIAL_CAMERA_FOV, 1, 0.1, Math.max(120, stations.length * 16));

  // Gallery rig: low fill, warm key, cool rim, plus a moving spotlight pool.
  const hemi = new THREE.HemisphereLight(0x3a4654, 0x140f0c, 0.48);
  const key = new THREE.DirectionalLight(0xffe9d6, 0.38);
  const rim = new THREE.DirectionalLight(0x9fb8c4, 0.34);
  key.position.set(5, 9, 7);
  rim.position.set(-6, 5, -9);
  const SPATIAL_SPOTLIGHT_INTENSITY = spatialWalkQuality === "lite" ? 1.45 : 1.85;
  const spot = new THREE.SpotLight(0xfff2e2, SPATIAL_SPOTLIGHT_INTENSITY, 0, 0.72, 0.68, 0);
  const spotTarget = new THREE.Object3D();
  const firstFocus = stations[0]?.focus || { x: 0, y: SPATIAL_STATION_FOCUS_HEIGHT, z: 0 };
  spotTarget.position.set(firstFocus.x, firstFocus.y, firstFocus.z);
  spot.position.set(firstFocus.x + 1.2, firstFocus.y + 3.6, firstFocus.z + 2.8);
  spot.target = spotTarget;
  scene.add(hemi, key, rim, spot, spotTarget);

  const routePoints = stations.map((station) => new THREE.Vector3(
    station.focus.x,
    0.02,
    station.focus.z
  ));
  const stationHitMeshes = [];
  const backdrop = addGalleryBackdrop(THREE, scene);
  addGalleryFloor(THREE, scene, stations);
  addSpatialEventTitleBackdrop(THREE, scene, stations);
  addSpatialRouteRibbon(THREE, scene, routePoints);
  stations.forEach((station) => addSpatialStationMesh(THREE, scene, station, stationHitMeshes));
  const dust = addGalleryDust(THREE, scene, stations);
  const atmosphereStreams = addGalleryAtmosphereStreams(THREE, scene, stations);

  spatialWalkScene = {
    THREE,
    renderer,
    scene,
    camera,
    routePoints,
    stations,
    stationHitMeshes,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    composer: null,
    bloom: null,
    spot,
    spotTarget,
    dust,
    atmosphereStreams,
    backdrop,
    currentLookAt: new THREE.Vector3(firstFocus.x, firstFocus.y, firstFocus.z)
  };
  camera.position.set(firstFocus.x, firstFocus.y + SPATIAL_CAMERA_HEIGHT, firstFocus.z + SPATIAL_CAMERA_PULLBACK + SPATIAL_CAMERA_SAFE_PULLBACK);
  bindSpatialWalkInteractions(canvas);
  playSpatialWalkArrival();
  updateSpatialWalkViewButton();
  updateSpatialWalkSoundButton();
  updateSpatialWalkOverlay();
}

function addSpatialRouteRibbon(THREE, scene, routePoints) {
  if (routePoints.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(routePoints);
  const geometry = new THREE.TubeGeometry(curve, Math.max(24, routePoints.length * 14), 0.014, 8, false);
  const material = new THREE.MeshBasicMaterial({
    color: 0xf7d8c7,
    transparent: true,
    opacity: 0.22
  });
  scene.add(new THREE.Mesh(geometry, material));
}

let walkShadowTexture = null;
let walkDustSprite = null;

function getWalkQuality() {
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
  const small = (window.innerWidth || 1024) < 760;
  return coarse || small ? "lite" : "high";
}

function spatialFloorCenterZ(stations) {
  return -((Math.max(1, stations.length) - 1) * SPATIAL_STATION_SPACING) / 2;
}

function addGalleryFloor(THREE, scene, stations) {
  const depth = Math.max(64, stations.length * SPATIAL_STATION_SPACING + 48);
  const material = new THREE.MeshStandardMaterial({
    color: 0x100d0c,
    roughness: 0.44,
    metalness: 0.2,
    map: createFloorTexture(THREE)
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(72, depth), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, spatialFloorCenterZ(stations));
  scene.add(floor);
}

function addSpatialEventTitleBackdrop(THREE, scene, stations) {
  const title = capsule?.eventTitle || capsule?.title || capsule?.name || "Wallflower Moments";
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (!first) return;

  // Grand entrance — the walk opens by drifting toward the event name.
  const entranceZ = first.cameraPosition.z + 4.5;
  const entranceY = stationCenterY(first.display.height) + 2.2;
  addSpatialTitlePanel(THREE, scene, title, { x: 0, y: entranceY, z: entranceZ }, 0.72, true);

  // The event name recurs softly, high in the atmosphere, as the walk goes deeper.
  const interval = 3;
  for (let index = interval; index < stations.length; index += interval) {
    const station = stations[index];
    addSpatialTitlePanel(
      THREE,
      scene,
      title,
      { x: 0, y: stationCenterY(station.display.height) + 4.7, z: station.focus.z + SPATIAL_STATION_SPACING * 0.5 },
      0.16,
      false
    );
  }

  // Quiet reprise behind the final piece.
  if (last && last !== first) {
    const endZ = last.focus.z - Math.max(9, SPATIAL_STATION_SPACING * 0.9);
    addSpatialTitlePanel(THREE, scene, title, { x: 0, y: 3.7, z: endZ }, 0.4, true);
  }
}

function addSpatialTitlePanel(THREE, scene, title, position, opacity, withHalo) {
  const texture = createSpatialTitleTexture(THREE, title);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  material.fog = false;
  const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(20.5, 5.2), material);
  titleMesh.position.set(position.x, position.y, position.z);
  titleMesh.renderOrder = -4;
  scene.add(titleMesh);

  if (!withHalo) return;
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 6.2),
    new THREE.MeshBasicMaterial({
      color: 0xfff1dc,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    })
  );
  halo.material.fog = false;
  halo.position.set(position.x, position.y, position.z - 0.08);
  halo.renderOrder = -5;
  scene.add(halo);
}

function addGalleryBackdrop(THREE, scene) {
  const material = new THREE.MeshBasicMaterial({
    map: createBackdropTexture(THREE),
    depthWrite: false,
    side: THREE.DoubleSide
  });
  material.fog = false;
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(96, 56), material);
  backdrop.renderOrder = -10;
  scene.add(backdrop);
  return backdrop;
}

function createBackdropTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#0a0908");
  gradient.addColorStop(0.42, "#1b1410");
  gradient.addColorStop(0.6, "#33231a");
  gradient.addColorStop(0.74, "#1a120e");
  gradient.addColorStop(1, "#090807");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 256);

  const glow = ctx.createRadialGradient(32, 150, 8, 32, 150, 150);
  glow.addColorStop(0, "rgba(122,82,52,0.42)");
  glow.addColorStop(1, "rgba(122,82,52,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
  return texture;
}

function createSpatialTitleTexture(THREE, eventTitle) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(1024, 330, 20, 1024, 330, 860);
  glow.addColorStop(0, "rgba(255,250,245,0.22)");
  glow.addColorStop(0.5, "rgba(247,216,199,0.09)");
  glow.addColorStop(1, "rgba(255,250,245,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,250,245,0.72)";
  ctx.font = "800 44px Manrope, Arial, sans-serif";
  drawTrackedCanvasText(ctx, "WALLFLOWER MOMENTS", 1024, 122, 7);

  const lines = titleLinesForCanvas(ctx, eventTitle, 1560);
  const titleFontSize = fitSpatialTitleFontSize(ctx, lines, lines.length > 1 ? 138 : 166, 76, 1600);
  ctx.font = `700 ${titleFontSize}px Cormorant Garamond, Georgia, serif`;
  ctx.shadowColor = "rgba(255,232,210,0.62)";
  ctx.shadowBlur = 36;
  ctx.fillStyle = "#fffaf5";
  const lineHeight = lines.length > 1 ? titleFontSize * 1.02 : 0;
  const baseY = lines.length > 1 ? 318 - ((lines.length - 1) * lineHeight) / 2 : 316;
  lines.forEach((line, index) => {
    ctx.fillText(line, 1024, baseY + index * lineHeight);
  });

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,250,245,0.52)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(420, 525);
  ctx.lineTo(1628, 525);
  ctx.stroke();

  const dateLine = capsule?.eventDate ? formatDate(capsule.eventDate) : "A PRIVATE TIME CAPSULE";
  ctx.fillStyle = "rgba(255,250,245,0.66)";
  ctx.font = "800 38px Manrope, Arial, sans-serif";
  drawTrackedCanvasText(ctx, dateLine.toUpperCase(), 1024, 570, 5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
  return texture;
}

function titleLinesForCanvas(ctx, eventTitle, maxWidth) {
  const title = String(eventTitle || "Wallflower Moments").replace(/\s+/g, " ").trim();
  const words = title.split(" ");
  const lines = [];
  let line = "";

  ctx.font = "700 148px Cormorant Garamond, Georgia, serif";
  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(nextLine).width > maxWidth && line && lines.length < 1) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  });

  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(" ")];
}

function fitSpatialTitleFontSize(ctx, lines, preferredSize, minSize, maxWidth) {
  let size = preferredSize;
  while (size > minSize) {
    ctx.font = `700 ${size}px Cormorant Garamond, Georgia, serif`;
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
    if (widest <= maxWidth) return size;
    size -= 6;
  }
  return minSize;
}

function drawTrackedCanvasText(ctx, text, x, y, spacing) {
  const characters = String(text || "").split("");
  const widths = characters.map((character) => ctx.measureText(character).width);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, characters.length - 1) * spacing;
  let cursor = x - totalWidth / 2;
  characters.forEach((character, index) => {
    ctx.fillText(character, cursor + widths[index] / 2, y);
    cursor += widths[index] + spacing;
  });
}

function createFloorTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0a09";
  ctx.fillRect(0, 0, 256, 256);
  const gradient = ctx.createRadialGradient(128, 128, 12, 128, 128, 150);
  gradient.addColorStop(0, "rgba(64,55,48,0.85)");
  gradient.addColorStop(1, "rgba(11,10,9,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
  return texture;
}

function addStationContactShadow(THREE, scene, station) {
  const size = Math.max(station.display.width, 1.6) * 1.5;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size * 0.5),
    new THREE.MeshBasicMaterial({
      map: getSharedShadowTexture(THREE),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(station.focus.x, 0.012, station.focus.z + 0.1);
  scene.add(mesh);
  station.contactShadow = mesh;
}

function addStationReflection(THREE, scene, station) {
  if (spatialWalkQuality !== "high") return;
  const material = new THREE.MeshBasicMaterial({
    map: station.card.material.map,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(station.display.width, station.display.height), material);
  mesh.position.set(station.focus.x, -station.focus.y, station.focus.z);
  mesh.rotation.set(station.rotation.x, station.rotation.y, station.rotation.z);
  mesh.scale.y = -1;
  scene.add(mesh);
  station.reflection = mesh;
}

function addGalleryDust(THREE, scene, stations) {
  const count = Math.round((spatialWalkQuality === "lite" ? 120 : 320) * SPATIAL_DUST_PARTICLE_MULTIPLIER);
  const depth = Math.max(40, stations.length * SPATIAL_STATION_SPACING + 20);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (hashUnit(index * 3 + 1) - 0.5) * 22;
    positions[index * 3 + 1] = hashUnit(index * 3 + 2) * 5.2 + 0.2;
    positions[index * 3 + 2] = -hashUnit(index * 3 + 3) * depth + 4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xf7e6d2,
    size: 0.05,
    map: getSharedDustSprite(THREE),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return points;
}

function addGalleryAtmosphereStreams(THREE, scene, stations) {
  const count = Math.round((spatialWalkQuality === "lite" ? 90 : 260) * SPATIAL_DUST_PARTICLE_MULTIPLIER);
  const depth = Math.max(50, stations.length * SPATIAL_STATION_SPACING + 32);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (hashUnit(index * 11 + 4) - 0.5) * 30;
    positions[index * 3 + 1] = hashUnit(index * 11 + 5) * 6.4 + 0.35;
    positions[index * 3 + 2] = -hashUnit(index * 11 + 6) * depth + 6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffd7bc,
    size: spatialWalkQuality === "lite" ? 0.045 : 0.065,
    map: getSharedDustSprite(THREE),
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  const streams = new THREE.Points(geometry, material);
  streams.userData.depth = depth;
  scene.add(streams);
  return streams;
}

function getSharedShadowTexture(THREE) {
  if (walkShadowTexture) return walkShadowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,0.7)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  walkShadowTexture = new THREE.CanvasTexture(canvas);
  return walkShadowTexture;
}

function getSharedDustSprite(THREE) {
  if (walkDustSprite) return walkDustSprite;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  walkDustSprite = new THREE.CanvasTexture(canvas);
  return walkDustSprite;
}

function hashUnit(value) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function addSpatialStationMesh(THREE, scene, station, stationHitMeshes) {
  const item = station.item;
  const mediaType = String(item.mediaType || "").toLowerCase();
  const isAudio = mediaType === "audio";
  const width = station.display.width;
  const height = station.display.height;
  const group = new THREE.Group();
  group.userData.stationIndex = station.index;

  // Brushed-metal outer bevel.
  const bevel = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 0.34, height + 0.34),
    new THREE.MeshStandardMaterial({
      color: station.tint,
      roughness: 0.34,
      metalness: 0.62,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide
    })
  );
  bevel.position.z = -0.05;
  bevel.userData.stationIndex = station.index;

  // Matte museum mat.
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 0.18, height + 0.18),
    new THREE.MeshStandardMaterial({
      color: 0xf4ece2,
      roughness: 0.92,
      metalness: 0.04,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide
    })
  );
  frame.position.z = -0.02;
  frame.userData.stationIndex = station.index;

  // The print itself — lit, with an emissive floor so it reads in a dark room.
  const cardGeometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0,
    emissive: 0xffffff,
    emissiveIntensity: isAudio ? 0.22 : 0.24,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  material.map = spatialTextureForItem(THREE, station, isAudio, material, (texture) => updateSpatialStationMediaAspect(THREE, station, texture));
  material.emissiveMap = material.map;
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
  hitArea.position.z = 0.06;
  hitArea.userData.stationIndex = station.index;

  group.add(bevel, frame, card, hitArea);
  group.position.set(station.focus.x, station.focus.y, station.focus.z);
  group.rotation.set(station.rotation.x, station.rotation.y, station.rotation.z);
  group.userData.frame = frame;
  group.userData.card = card;
  group.userData.hitArea = hitArea;
  scene.add(group);

  station.group = group;
  station.card = card;
  station.frame = frame;
  station.bevel = bevel;
  stationHitMeshes.push(hitArea);
  addStationContactShadow(THREE, scene, station);
  addStationReflection(THREE, scene, station);
  addStationPlacard(THREE, station);
}

function addStationPlacard(THREE, station) {
  if (!station.group) return;
  const texture = createStationPlacardTexture(THREE, station);
  if (!texture) return;
  const imageWidth = texture.image?.width || 1024;
  const imageHeight = texture.image?.height || 340;
  const width = clamp(station.display.width, 2.8, 4.8);
  const height = width * (imageHeight / imageWidth);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.userData.stationIndex = station.index;
  station.placard = mesh;
  station.placardHeight = height;
  station.group.add(mesh);
  repositionStationPlacard(station);
}

function repositionStationPlacard(station) {
  if (!station?.placard) return;
  const height = station.placardHeight || 1;
  station.placard.position.set(0, -(station.display.height / 2) - SPATIAL_PLACARD_GAP - height / 2, 0.04);
}

function createStationPlacardTexture(THREE, station) {
  const item = station.item || {};
  const title = cleanCaptionText(item.title) || "Time Capsule moment";
  const message = getSpatialMomentCaption(station);
  const date = formatDateTime(item.capturedAt);
  const hasMessage = Boolean(message);

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = hasMessage ? 340 : 168;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";

  if (date) {
    ctx.fillStyle = "rgba(255,250,245,0.6)";
    ctx.font = "700 24px Manrope, Arial, sans-serif";
    ctx.textBaseline = "alphabetic";
    drawTrackedCanvasText(ctx, date.toUpperCase(), 512, 42, 4);
  }

  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#fffaf5";
  let titleSize = 78;
  ctx.font = `700 ${titleSize}px "Cormorant Garamond", Georgia, serif`;
  while (titleSize > 44 && ctx.measureText(title).width > 940) {
    titleSize -= 4;
    ctx.font = `700 ${titleSize}px "Cormorant Garamond", Georgia, serif`;
  }
  ctx.fillText(title, 512, 122);

  if (hasMessage) {
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(255,250,245,0.85)";
    ctx.font = "600 30px Manrope, Arial, sans-serif";
    wrapCanvasText(ctx, message, 512, 196, 900, 42, 2);
  }
  ctx.shadowBlur = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
  const maxAnisotropy = spatialWalkScene?.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

function updateSpatialStationMediaAspect(THREE, station, texture) {
  const image = texture?.image || {};
  const width = Number(image.naturalWidth || image.videoWidth || image.width || 0);
  const height = Number(image.naturalHeight || image.videoHeight || image.height || 0);
  if (!width || !height || !station.card || !station.frame || !station.group?.userData?.hitArea) return;

  const display = displaySizeFromAspect(width / height);
  station.display = display;
  const centerY = stationCenterY(display.height);
  station.focus = { ...station.focus, y: centerY };
  station.cameraPosition = stationCameraPose(station.focus, display);
  station.lookAt = stationLookAt(station.focus, display);
  station.group.position.y = centerY;

  station.card.geometry.dispose?.();
  station.card.geometry = new THREE.PlaneGeometry(display.width, display.height);
  station.frame.geometry.dispose?.();
  station.frame.geometry = new THREE.PlaneGeometry(display.width + 0.18, display.height + 0.18);
  station.group.userData.hitArea.geometry.dispose?.();
  station.group.userData.hitArea.geometry = new THREE.PlaneGeometry(display.width + 0.52, display.height + 0.52);
  if (station.bevel) {
    station.bevel.geometry.dispose?.();
    station.bevel.geometry = new THREE.PlaneGeometry(display.width + 0.34, display.height + 0.34);
  }
  if (station.reflection) {
    station.reflection.material.map = texture;
    station.reflection.material.needsUpdate = true;
    station.reflection.geometry.dispose?.();
    station.reflection.geometry = new THREE.PlaneGeometry(display.width, display.height);
    station.reflection.position.y = -centerY;
  }
  repositionStationPlacard(station);
}

function spatialTextureForItem(THREE, station, isAudio, material, onTextureReady) {
  const item = station.item;
  const fallbackTexture = createSpatialCardTexture(THREE, item);
  // Defer real media until the station is near the camera (proximity warming),
  // so opening the walk does not fire every full-res download at once. The
  // lightweight card texture renders instantly; warmSpatialStationMedia() swaps
  // in the real photo / video poster as the station is approached.
  station.cardMaterial = material;
  station.cardFallbackTexture = fallbackTexture;
  station.onMediaTexture = onTextureReady;
  station.mediaState = isAudio ? "ready" : "idle";
  return fallbackTexture;
}

function warmSpatialStationMedia(station) {
  if (!station || station.mediaState !== "idle") return;
  const THREE = spatialWalkScene?.THREE;
  if (!THREE) return;
  station.mediaState = "loading";

  const item = station.item;
  const mediaType = String(item.mediaType || "").toLowerCase();
  if (mediaType === "video") {
    warmSpatialVideoStill(THREE, station);
    return;
  }

  const url = item.mediaUrl ? inlineMediaUrl(item.mediaUrl) : "";
  if (!url) {
    station.mediaState = "ready";
    return;
  }
  const priority = station.index === spatialActiveStationIndex ? "high" : "auto";
  loadSpatialStillTexture(THREE, url, station, priority);
}

function warmSpatialVideoStill(THREE, station) {
  const item = station.item;
  // Prefer the server-side thumbnail (cheap). With none, keep the lightweight
  // card and let the clip stream in when reached — avoids downloading the whole
  // video just to grab a poster frame.
  if (item.thumbnailUrl) {
    loadSpatialStillTexture(THREE, item.thumbnailUrl, station, "auto");
    return;
  }
  station.mediaState = "ready";
}

function loadSpatialStillTexture(THREE, url, station, priority) {
  const material = station.cardMaterial;
  const fallbackTexture = station.cardFallbackTexture;
  const onTextureReady = station.onMediaTexture;

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  if (priority && "fetchPriority" in image) image.fetchPriority = priority;

  const apply = () => {
    // Cap texture size so a 4000px source photo isn't uploaded at full size —
    // the cards are small on screen, so 2048px is visually lossless and saves
    // a lot of GPU memory + upload bandwidth (especially on phones).
    const texture = new THREE.Texture(downscaleImageForTexture(image, 2048));
    texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
    texture.needsUpdate = true;
    applyWalkTextureQuality(THREE, texture);
    material.map = texture;
    material.emissiveMap = texture;
    material.needsUpdate = true;
    station.mediaState = "ready";
    onTextureReady?.(texture);
    requestSpatialWalkFrame();
  };

  image.onload = () => {
    // Decode off the main thread so the GPU upload doesn't hitch the walk.
    if (typeof image.decode === "function") image.decode().then(apply).catch(apply);
    else apply();
  };
  image.onerror = () => {
    material.map = fallbackTexture;
    material.emissiveMap = fallbackTexture;
    material.needsUpdate = true;
    station.mediaState = "ready";
    requestSpatialWalkFrame();
  };
  image.src = url;
}

function applyWalkTextureQuality(THREE, texture) {
  if (!texture) return;
  const maxAnisotropy = spatialWalkScene?.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.generateMipmaps = true;
  if (THREE.LinearMipmapLinearFilter) texture.minFilter = THREE.LinearMipmapLinearFilter;
}

function downscaleImageForTexture(image, maxDimension) {
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!width || !height || Math.max(width, height) <= maxDimension) return image;

  const scale = maxDimension / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return image;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createSpatialVideoTexture(THREE, station, fallbackTexture, material, onTextureReady) {
  const item = station.item;
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  // No looping by default: during the auto-tour the clip should play once and
  // hand off to the next station. syncSpatialVideoPlayback re-enables looping
  // only when the guest is parked on a clip (tour paused / scrubbing).
  video.loop = false;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  updateSpatialVideoSoundState(video);

  if (!configureSpatialVideoSource(video, item)) return null;

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
  texture.generateMipmaps = false;
  if (THREE.LinearFilter) {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }

  station.video = {
    element: video,
    texture,
    material,
    fallbackTexture,
    ready: false,
    playRequested: false,
    ended: false
  };

  video.addEventListener("loadedmetadata", () => {
    onTextureReady?.(texture);
    requestSpatialWalkFrame();
  }, { once: true });

  video.addEventListener("loadeddata", () => {
    station.video.ready = true;
    material.map = texture;
    material.emissiveMap = texture;
    material.needsUpdate = true;
    texture.needsUpdate = true;
    requestSpatialWalkFrame();
  }, { once: true });

  video.addEventListener("error", () => {
    material.map = fallbackTexture;
    material.emissiveMap = fallbackTexture;
    material.needsUpdate = true;
    station.video.ready = false;
    requestSpatialWalkFrame();
  }, { once: true });

  video.addEventListener("ended", () => {
    if (station.video) station.video.ended = true;
    requestSpatialWalkFrame();
  });

  video.load?.();
  return texture;
}

function updateSpatialVideoSoundState(video) {
  if (!video) return;
  video.muted = !spatialWalkSoundUnlocked;
  video.defaultMuted = !spatialWalkSoundUnlocked;
  video.volume = spatialWalkSoundUnlocked ? 1 : 0;
  video.dataset.spatialWalkSound = spatialWalkSoundUnlocked ? "on" : "muted";
  if (spatialWalkSoundUnlocked) {
    video.removeAttribute("muted");
  } else {
    video.setAttribute("muted", "");
  }
}

function configureSpatialVideoSource(video, item) {
  // Prefer the adaptive HLS stream so playback starts from a small prefetch
  // instead of downloading the entire file; fall back to the direct media URL.
  const streamUrl = item.streamUrl || "";
  if (streamUrl) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.dataset.spatialVideoSource = "stream-native";
      return true;
    }

    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        maxBufferLength: 10,
        maxMaxBufferLength: 18,
        startFragPrefetch: true
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      video.wallflowerSpatialHls = hls;
      video.dataset.spatialVideoSource = "stream-hls";
      return true;
    }
  }

  const directUrl = item.mediaUrl ? inlineMediaUrl(item.mediaUrl) : "";
  if (directUrl) {
    video.src = directUrl;
    video.dataset.spatialVideoSource = "media";
    return true;
  }

  return false;
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
  spatialWalkScene.composer?.setSize?.(width, height);
  spatialWalkScene.bloom?.setSize?.(Math.max(1, Math.round(width * 0.5)), Math.max(1, Math.round(height * 0.5)));
  spatialWalkScene.camera.aspect = width / height;
  spatialWalkScene.camera.updateProjectionMatrix();
  requestSpatialWalkFrame();
}

function requestSpatialWalkFrame() {
  if (currentCapsuleView !== "walk" || !spatialWalkScene) return;
  startSpatialWalkLoop();
}

function startSpatialWalkLoop() {
  if (spatialWalkFrame || !spatialWalkScene) return;

  spatialWalkLastTime = 0;
  const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(() => callback(nowMs()), 16));
  const step = (timestamp) => {
    if (currentCapsuleView !== "walk" || !spatialWalkScene) {
      spatialWalkFrame = 0;
      return;
    }
    renderSpatialWalkLoop(timestamp);
    spatialWalkFrame = requestFrame(step);
  };
  spatialWalkFrame = requestFrame(step);
}

function stopSpatialWalkLoop() {
  if (!spatialWalkFrame) return;

  const cancelFrame = window.cancelAnimationFrame || window.clearTimeout;
  cancelFrame(spatialWalkFrame);
  spatialWalkFrame = 0;
}

async function buildSpatialWalkComposer(THREE) {
  if (!spatialWalkScene) return;
  if (spatialWalkQuality !== "high") {
    spatialWalkScene.composer = null;
    return;
  }

  try {
    const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
    const { RenderPass } = await import("three/addons/postprocessing/RenderPass.js");
    const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
    const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");
    const { renderer, scene, camera } = spatialWalkScene;
    const size = renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Bloom is a soft glow, so render it at half resolution — visually identical
    // and roughly 4x cheaper than full-res blur passes.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.round(size.x * 0.5)), Math.max(1, Math.round(size.y * 0.5))),
      0.32,
      0.5,
      0.85
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    spatialWalkScene.composer = composer;
    spatialWalkScene.bloom = bloom;
  } catch (error) {
    spatialWalkScene.composer = null;
  }
}

function renderSpatialWalkLoop(timestamp) {
  if (!spatialWalkScene || currentCapsuleView !== "walk") return;

  const time = Number(timestamp) || nowMs();
  if (!spatialWalkLastTime) spatialWalkLastTime = time;
  const dt = Math.min(0.05, Math.max(0, (time - spatialWalkLastTime) / 1000));
  spatialWalkLastTime = time;
  spatialWalkClock += dt;

  advanceSpatialArrival(dt);
  const progress = resolveSpatialWalkProgress(dt, time);
  applySpatialWalkCamera(progress, dt);
  updateSpatialStationFocus(progress * Math.max(1, spatialWalkStations.length - 1));
  animateSpatialAtmosphere(dt);

  const { composer, renderer, scene, camera } = spatialWalkScene;
  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
}

function resolveSpatialWalkProgress(dt, time) {
  const count = spatialWalkStations.length;
  if (count <= 1) return 0;

  const scrub = getSpatialScrollProgress();
  if (Math.abs(scrub - spatialScrubProgress) > 0.0009) {
    spatialScrubProgress = scrub;
    spatialLastInteractionTime = time;
    spatialTourProgress = scrub;
    spatialTourTarget = clamp(Math.round(scrub * (count - 1)), 0, count - 1);
    spatialTourHoldMs = 0;
  }

  const tourActive = spatialTourPlaying
    && spatialArrivalProgress >= 1
    && (time - spatialLastInteractionTime > SPATIAL_TOUR_RESUME_MS);
  spatialTourActive = tourActive;
  if (!tourActive) return clamp(spatialScrubProgress, 0, 1);

  const maxFloat = count - 1;
  const currentFloat = clamp(spatialTourProgress, 0, 1) * maxFloat;
  if (Math.abs(currentFloat - spatialTourTarget) < 0.012) {
    spatialTourHoldMs += dt * 1000;
    const targetStation = spatialWalkStations[spatialTourTarget];
    const dwellElapsed = spatialTourHoldMs >= spatialTourDwellMsForStation(spatialWalkStations[spatialTourTarget]);
    // Advance the moment a video/voice memo finishes playing — no looping,
    // no extra buffer — falling back to the dwell cap for stills or stalls.
    if ((dwellElapsed || isSpatialMediaFinished(targetStation)) && spatialTourTarget < maxFloat) {
      spatialTourHoldMs = 0;
      spatialTourTarget += 1;
    }
    return clamp(spatialTourProgress, 0, 1);
  }

  const stationStep = (dt * 1000) / Math.max(1, SPATIAL_TOUR_TRAVEL_MS);
  const direction = Math.sign(spatialTourTarget - currentFloat);
  const nextFloat = clamp(currentFloat + direction * stationStep, 0, maxFloat);
  spatialTourProgress = nextFloat / maxFloat;
  return spatialTourProgress;
}

function spatialTourDwellMsForStation(station) {
  const type = String(station?.item?.mediaType || "").toLowerCase();

  // Voice memos only play once sound is enabled; until then, hold the normal
  // short dwell instead of lingering silently for the clip's length.
  if (type === "audio") {
    if (!spatialWalkSoundUnlocked) return SPATIAL_TOUR_DWELL_MS;
    const audioSeconds = getSpatialAudioDurationSeconds(station);
    if (!audioSeconds) return SPATIAL_TOUR_VIDEO_FALLBACK_DWELL_MS;
    return clamp(
      Math.round(audioSeconds * 1000 + SPATIAL_TOUR_VIDEO_END_BUFFER_MS),
      SPATIAL_TOUR_VIDEO_MIN_DWELL_MS,
      SPATIAL_TOUR_VIDEO_MAX_DWELL_MS
    );
  }

  if (type !== "video") return SPATIAL_TOUR_DWELL_MS;

  const durationSeconds = getSpatialVideoDurationSeconds(station);
  if (!durationSeconds) return SPATIAL_TOUR_VIDEO_FALLBACK_DWELL_MS;

  return clamp(
    Math.round(durationSeconds * 1000 + SPATIAL_TOUR_VIDEO_END_BUFFER_MS),
    SPATIAL_TOUR_VIDEO_MIN_DWELL_MS,
    SPATIAL_TOUR_VIDEO_MAX_DWELL_MS
  );
}

function spatialMediaElementFinished(element) {
  if (!element) return false;
  if (element.ended) return true;
  const duration = Number(element.duration);
  return Number.isFinite(duration) && duration > 0 && element.currentTime >= duration - 0.05;
}

function isSpatialMediaFinished(station) {
  if (spatialMediaElementFinished(station?.video?.element)) return true;
  if (spatialMediaElementFinished(station?.audio?.element)) return true;
  return Boolean(station?.video?.ended || station?.audio?.ended);
}

function resetSpatialStationPlayback(station) {
  const video = station?.video;
  if (video) {
    video.ended = false;
    if (video.element) {
      try { video.element.currentTime = 0; } catch {}
    }
  }
  const audio = station?.audio;
  if (audio) {
    audio.ended = false;
    if (audio.element) {
      try { audio.element.currentTime = 0; } catch {}
    }
  }
}

function getSpatialAudioDurationSeconds(station) {
  const itemDuration = Number(station.item?.durationSeconds || station.item?.duration_seconds || 0);
  if (Number.isFinite(itemDuration) && itemDuration > 0) return itemDuration;

  const mediaDuration = Number(station.audio?.element?.duration || 0);
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;

  return 0;
}

function getSpatialVideoDurationSeconds(station) {
  const itemDuration = Number(station.item?.durationSeconds || station.item?.duration_seconds || 0);
  if (Number.isFinite(itemDuration) && itemDuration > 0) return itemDuration;

  const mediaDuration = Number(station.video?.element?.duration || 0);
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;

  return 0;
}

function applySpatialWalkCamera(progress, dt) {
  const scene = spatialWalkScene;
  if (!scene) return;
  const { THREE, camera, stations } = scene;
  const count = stations.length;
  if (!count) return;

  const desiredPos = scene._desiredPos || (scene._desiredPos = new THREE.Vector3());
  const desiredLook = scene._desiredLook || (scene._desiredLook = new THREE.Vector3());

  if (count > 1) {
    const stationFloat = clamp(progress, 0, 1) * (count - 1);
    const index = Math.min(count - 2, Math.floor(stationFloat));
    const eased = easeSpatialStation(stationFloat - index);
    const a = stations[index];
    const b = stations[index + 1];
    desiredPos.set(
      lerp(a.cameraPosition.x, b.cameraPosition.x, eased),
      lerp(a.cameraPosition.y, b.cameraPosition.y, eased),
      lerp(a.cameraPosition.z, b.cameraPosition.z, eased)
    );
    desiredLook.set(
      lerp(a.lookAt.x, b.lookAt.x, eased),
      lerp(a.lookAt.y, b.lookAt.y, eased),
      lerp(a.lookAt.z, b.lookAt.z, eased)
    );
  } else {
    const only = stations[0];
    desiredPos.set(only.cameraPosition.x, only.cameraPosition.y, only.cameraPosition.z);
    desiredLook.set(only.lookAt.x, only.lookAt.y, only.lookAt.z);
  }

  // Idle float + breathing keep the room alive when nobody is scrubbing.
  const t = spatialWalkClock;
  const float = prefersReducedMotion() ? 0 : SPATIAL_IDLE_FLOAT;
  desiredPos.x += Math.sin(t * 0.45) * float;
  desiredPos.y += Math.sin(t * 0.62) * float * 0.8 + Math.sin(t * 0.2) * float * 0.4;
  desiredLook.x += Math.sin(t * 0.33) * float * 0.6;
  desiredLook.y += Math.cos(t * 0.5) * float * 0.4;

  // Pointer parallax (damped target).
  const parallaxK = Math.min(1, dt * 3.2);
  spatialPointerParallax.x += (spatialPointerParallaxTarget.x - spatialPointerParallax.x) * parallaxK;
  spatialPointerParallax.y += (spatialPointerParallaxTarget.y - spatialPointerParallax.y) * parallaxK;
  desiredPos.x += spatialPointerParallax.x * SPATIAL_PARALLAX_STRENGTH;
  desiredPos.y += spatialPointerParallax.y * SPATIAL_PARALLAX_STRENGTH * 0.6;

  // Cinematic arrival blends from a far, low establishing pose.
  if (spatialArrivalProgress < 1 && scene._arrivalStart) {
    const ease = easeSpatialStation(spatialArrivalProgress);
    desiredPos.x = lerp(scene._arrivalStart.pos.x, desiredPos.x, ease);
    desiredPos.y = lerp(scene._arrivalStart.pos.y, desiredPos.y, ease);
    desiredPos.z = lerp(scene._arrivalStart.pos.z, desiredPos.z, ease);
    desiredLook.x = lerp(scene._arrivalStart.look.x, desiredLook.x, ease);
    desiredLook.y = lerp(scene._arrivalStart.look.y, desiredLook.y, ease);
    desiredLook.z = lerp(scene._arrivalStart.look.z, desiredLook.z, ease);
  }

  // Critically damped follow toward the target pose.
  const k = 1 - Math.exp(-dt / SPATIAL_CAMERA_DAMP);
  camera.position.lerp(desiredPos, k);
  scene.currentLookAt.lerp(desiredLook, k);
  camera.lookAt(scene.currentLookAt);

  // Spotlight pool tracks the active station.
  if (scene.spot && scene.spotTarget) {
    const activeIndex = clamp(Math.round(clamp(progress, 0, 1) * Math.max(1, count - 1)), 0, count - 1);
    const focus = stations[activeIndex].focus;
    scene.spotTarget.position.x += (focus.x - scene.spotTarget.position.x) * k;
    scene.spotTarget.position.y += (focus.y - scene.spotTarget.position.y) * k;
    scene.spotTarget.position.z += (focus.z - scene.spotTarget.position.z) * k;
    scene.spot.position.x += (focus.x + 1.2 - scene.spot.position.x) * k;
    scene.spot.position.y += (focus.y + 3.6 - scene.spot.position.y) * k;
    scene.spot.position.z += (focus.z + 2.8 - scene.spot.position.z) * k;
  }

  // Keep the atmospheric backdrop filling the view behind the art.
  if (scene.backdrop) {
    const dir = scene._backdropDir || (scene._backdropDir = new THREE.Vector3());
    camera.getWorldDirection(dir);
    scene.backdrop.position.copy(camera.position).addScaledVector(dir, 42);
    scene.backdrop.quaternion.copy(camera.quaternion);
  }
}

function advanceSpatialArrival(dt) {
  if (spatialArrivalProgress >= 1) return;
  spatialArrivalProgress = clamp(spatialArrivalProgress + (dt * 1000) / SPATIAL_ARRIVAL_MS, 0, 1);
}

function playSpatialWalkArrival() {
  const scene = spatialWalkScene;
  if (!scene || prefersReducedMotion()) {
    spatialArrivalProgress = 1;
    return;
  }

  const first = spatialWalkStations[0];
  if (!first) {
    spatialArrivalProgress = 1;
    return;
  }

  scene._arrivalStart = {
    pos: new scene.THREE.Vector3(
      first.cameraPosition.x * 0.3,
      first.cameraPosition.y + 3.4,
      first.cameraPosition.z + 13
    ),
    look: new scene.THREE.Vector3(first.lookAt.x, first.lookAt.y + 0.6, first.lookAt.z)
  };
  spatialArrivalProgress = 0;
}

function animateSpatialAtmosphere(dt) {
  const dust = spatialWalkScene?.dust;
  if (dust) {
    // Drift the whole field with transform only — no per-frame vertex buffer
    // re-upload to the GPU, which is the same look at a fraction of the cost.
    dust.rotation.y += dt * 0.015;
    dust.position.y = Math.sin(spatialWalkClock * 0.3) * 0.12;
  }

  const streams = spatialWalkScene?.atmosphereStreams;
  if (streams) {
    const depth = Number(streams.userData?.depth || 60);
    streams.rotation.y += dt * 0.024;
    streams.position.z = (spatialWalkClock * 1.8) % Math.max(8, SPATIAL_STATION_SPACING);
    streams.position.x = Math.sin(spatialWalkClock * 0.18) * 0.45;
    streams.material.opacity = 0.32 + Math.sin(spatialWalkClock * 0.7) * 0.06;
    if (streams.position.z > depth) streams.position.z = 0;
  }
}

function handleSpatialWalkScroll() {
  spatialLastInteractionTime = nowMs();
  requestSpatialWalkFrame();
}

function nowMs() {
  return (window.performance && typeof window.performance.now === "function")
    ? window.performance.now()
    : Date.now();
}

function lerp(start, end, factor) {
  return start + (end - start) * factor;
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
    updateSpatialWalkOverlay();
  }

  const stations = spatialWalkScene.stations;
  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i];
    if (!station.group || !station.card || !station.frame) continue;
    const distance = Math.abs(station.index - stationFloat);
    const visible = distance < 5;
    station.group.visible = visible;
    if (station.reflection) station.reflection.visible = visible;
    if (station.contactShadow) station.contactShadow.visible = visible;

    // Off-screen stations skip all per-frame material/media work; just make sure
    // any clip that was playing is paused as it leaves the frame.
    if (!visible) {
      if (station.video?.element && !station.video.element.paused) station.video.element.pause();
      if (station.audio?.element && !station.audio.element.paused) station.audio.element.pause();
      continue;
    }

    const near = distance <= SPATIAL_NEAR_STATION_RADIUS;
    const isActive = station.index === spatialActiveStationIndex;
    const isHovered = station.index === spatialHoveredStationIndex;
    const opacity = isActive ? 1 : near ? Math.max(0.4, 0.85 - distance * 0.16) : 0.12;
    const scale = isActive ? SPATIAL_FEATURED_STATION_SCALE : near ? Math.max(0.86, 1 - distance * 0.06) : 0.68;
    station.group.scale.setScalar(isHovered ? scale + 0.04 : scale);
    station.card.material.opacity = opacity;
    station.card.material.emissiveIntensity = isActive ? 0.28 : near ? 0.22 : 0.16;
    station.frame.material.opacity = opacity;
    if (station.bevel) station.bevel.material.opacity = opacity;
    if (station.reflection) station.reflection.material.opacity = opacity * 0.16;
    if (station.placard) station.placard.material.opacity = opacity;
    if (distance <= SPATIAL_MEDIA_WARM_RADIUS) warmSpatialStationMedia(station);
    syncSpatialVideoPlayback(station, distance, isActive);
    syncSpatialAudioPlayback(station, distance, isActive);
  }
}

function syncSpatialAudioPlayback(station, distance, isActive) {
  if (!station) return;
  if (String(station.item?.mediaType || "").toLowerCase() !== "audio") return;

  // Voice memos are audio-only, so they only make sense once sound is on and the
  // station is the active one.
  const shouldPlay = currentCapsuleView === "walk"
    && spatialWalkSoundUnlocked
    && isActive
    && station.group?.visible;

  if (shouldPlay && !station.audio) {
    attachSpatialStationAudio(station);
  }

  const audioState = station.audio;
  const element = audioState?.element;
  if (!element) return;

  if (!shouldPlay) {
    audioState.playRequested = false;
    if (typeof element.pause === "function" && !element.paused) element.pause();
    if (audioState.ended || spatialMediaElementFinished(element)) resetSpatialStationPlayback(station);
    return;
  }

  if (!element.paused || audioState.playRequested || typeof element.play !== "function") return;

  if (audioState.ended || spatialMediaElementFinished(element)) {
    // During the tour a finished memo does not replay; the tour advances.
    if (spatialTourActive) return;
    resetSpatialStationPlayback(station);
  }
  audioState.playRequested = true;
  element.play().then(() => {
    audioState.playRequested = false;
  }).catch(() => {
    audioState.playRequested = false;
  });
}

function attachSpatialStationAudio(station) {
  const item = station.item;
  const url = item?.mediaUrl ? inlineMediaUrl(item.mediaUrl) : "";
  if (!url) return;

  const element = document.createElement("audio");
  element.crossOrigin = "anonymous";
  element.preload = "auto";
  element.loop = false;
  element.src = url;

  station.audio = { element, playRequested: false, ended: false };

  element.addEventListener("ended", () => {
    if (station.audio) station.audio.ended = true;
    requestSpatialWalkFrame();
  });
  element.load?.();
}

function pauseSpatialWalkAudios() {
  spatialWalkStations.forEach((station) => {
    const element = station.audio?.element;
    if (!element || typeof element.pause !== "function") return;
    station.audio.playRequested = false;
    element.pause();
  });
}

function syncSpatialVideoPlayback(station, distance, isActive) {
  if (!station) return;
  if (String(station.item?.mediaType || "").toLowerCase() !== "video") return;

  const shouldPlay = currentCapsuleView === "walk"
    && station.group?.visible
    && (isActive || distance <= SPATIAL_VIDEO_PLAY_RADIUS);

  // Create + stream the actual <video> only when its station is reached, instead
  // of preloading every clip when the walk opens.
  if (shouldPlay && !station.video && spatialWalkScene?.THREE) {
    createSpatialVideoTexture(
      spatialWalkScene.THREE,
      station,
      station.cardFallbackTexture,
      station.cardMaterial,
      station.onMediaTexture
    );
  }

  const videoState = station.video;
  const video = videoState?.element;
  const texture = videoState?.texture;
  if (!video || !texture) return;
  updateSpatialVideoSoundState(video);

  if (!shouldPlay) {
    videoState.playRequested = false;
    if (typeof video.pause === "function" && !video.paused) video.pause();
    // Once the camera has moved past it, rewind a finished clip so a later
    // visit starts fresh — never while it is still on screen.
    if (videoState.ended || spatialMediaElementFinished(video)) resetSpatialStationPlayback(station);
    return;
  }

  texture.needsUpdate = true;
  // Never loop during the auto-tour; only loop when the guest is parked on it.
  video.loop = !spatialTourActive;
  if (!video.paused || videoState.playRequested || typeof video.play !== "function") return;

  // Use the element's own ended/position (set synchronously by the browser) so a
  // finished clip is never restarted for a frame before our flag catches up.
  if (videoState.ended || spatialMediaElementFinished(video)) {
    // During the tour a finished clip holds on its last frame and the tour
    // advances — it must not replay from the start.
    if (spatialTourActive) return;
    resetSpatialStationPlayback(station);
  }
  videoState.playRequested = true;
  video.play().then(() => {
    videoState.playRequested = false;
    texture.needsUpdate = true;
    updateSpatialWalkSoundButton();
    requestSpatialWalkFrame();
  }).catch(() => {
    videoState.playRequested = false;
    updateSpatialWalkSoundButton();
  });
}

function pauseSpatialWalkVideos() {
  spatialWalkStations.forEach((station) => {
    const video = station.video?.element;
    if (!video || typeof video.pause !== "function") return;
    station.video.playRequested = false;
    video.pause();
  });
}

function toggleSpatialWalkSound() {
  spatialWalkSoundUnlocked = !spatialWalkSoundUnlocked;
  spatialWalkStations.forEach((station) => updateSpatialVideoSoundState(station.video?.element));
  updateSpatialWalkSoundButton();

  const activeStation = spatialWalkStations[spatialActiveStationIndex];
  if (spatialWalkSoundUnlocked) {
    // Resume audible playback on the active moment immediately.
    syncSpatialVideoPlayback(activeStation, 0, true);
    syncSpatialAudioPlayback(activeStation, 0, true);
  } else {
    // Muting should silence voice memos outright (a muted memo is pointless).
    pauseSpatialWalkAudios();
  }
  requestSpatialWalkFrame();
}

function spatialSoundIconMarkup(isOn) {
  const speaker = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"></path>';
  const waves = isOn
    ? '<path d="M16 8.6a5 5 0 0 1 0 6.8"></path><path d="M18.7 6a8.5 8.5 0 0 1 0 12"></path>'
    : '<line x1="16.5" y1="9.5" x2="21" y2="14"></line><line x1="21" y1="9.5" x2="16.5" y2="14"></line>';
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${speaker}${waves}</svg>`;
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

function updateSpatialWalkSoundButton() {
  const button = qs("#capsuleWalkSoundButton");
  if (!button) return;
  const hasSound = spatialWalkStations.some((station) => {
    const type = String(station.item?.mediaType || "").toLowerCase();
    return type === "video" || type === "audio";
  });
  button.hidden = currentCapsuleView !== "walk" || !hasSound;
  button.innerHTML = spatialSoundIconMarkup(spatialWalkSoundUnlocked);
  button.classList.toggle("is-sound-on", spatialWalkSoundUnlocked);
  button.setAttribute("aria-pressed", String(spatialWalkSoundUnlocked));
  button.setAttribute("aria-label", spatialWalkSoundUnlocked ? "Turn sound off" : "Turn sound on");
  button.setAttribute("title", spatialWalkSoundUnlocked ? "Sound on" : "Sound off");
  document.body.classList.toggle("is-spatial-walk-sound-on", spatialWalkSoundUnlocked && currentCapsuleView === "walk");
}

function revealSpatialWalkControls() {
  if (currentCapsuleView !== "walk") return;
  document.body.classList.remove("is-walk-controls-hidden");
  window.clearTimeout(spatialWalkControlsTimer);
  spatialWalkControlsTimer = window.setTimeout(() => {
    if (currentCapsuleView === "walk") document.body.classList.add("is-walk-controls-hidden");
  }, 3600);
}

function updateSpatialWalkOverlay() {
  const station = spatialWalkStations[spatialActiveStationIndex];
  if (!station) return;

  const item = station.item;
  const cluster = station.cluster;
  const chapter = qs("#capsuleWalkChapter");
  const title = qs("#capsuleWalkTitle");
  const caption = qs("#capsuleWalkCaption");
  const date = qs("#capsuleWalkDate");
  if (chapter) chapter.textContent = cluster?.label || item.chapter || "Wallflower gallery";
  if (title) title.textContent = item.title || "Time Capsule moment";
  if (caption) caption.textContent = getSpatialMomentCaption(station);
  if (date) date.textContent = formatDateTime(item.capturedAt);

  const copy = qs("#capsuleWalkCopy");
  if (copy?.classList) {
    copy.classList.remove("is-swap");
    void copy.offsetWidth;
    copy.classList.add("is-swap");
  }
  updateSpatialWalkProgressRail();
}

function updateSpatialWalkProgressRail() {
  const rail = qs("#capsuleWalkProgress");
  if (!rail) return;

  const count = spatialWalkStations.length;
  if (!count) {
    rail.innerHTML = "";
    return;
  }

  if (rail.childElementCount !== count) {
    rail.innerHTML = spatialWalkStations
      .map((station, index) => `<button class="capsule-walk-dot" type="button" data-walk-dot="${index}" aria-label="Go to moment ${index + 1}"></button>`)
      .join("");
    qsaWalkDots().forEach((dot) => {
      dot.addEventListener("click", () => scrollSpatialWalkToStation(Number(dot.dataset.walkDot || 0)));
    });
  }

  qsaWalkDots().forEach((dot) => {
    const isActive = Number(dot.dataset.walkDot || 0) === spatialActiveStationIndex;
    dot.classList?.toggle("is-active", isActive);
    dot.setAttribute?.("aria-current", isActive ? "true" : "false");
  });
}

function toggleSpatialTour() {
  spatialTourPlaying = !spatialTourPlaying;
  if (spatialTourPlaying) {
    const count = spatialWalkStations.length;
    if (count > 1 && spatialTourTarget >= count - 1 && clamp(spatialTourProgress, 0, 1) >= 0.999) {
      spatialTourTarget = 0;
      spatialTourProgress = 0;
    }
    spatialLastInteractionTime = 0;
  }
  updateSpatialTourToggle();
  requestSpatialWalkFrame();
}

function updateSpatialTourToggle() {
  const button = qs("#capsuleWalkTourToggle");
  if (!button) return;
  button.textContent = spatialTourPlaying ? "Pause tour" : "Play tour";
  button.setAttribute("aria-pressed", String(spatialTourPlaying));
}

function updateSpatialWalkFullscreenButton() {
  const button = qs("#capsuleWalkFullscreenButton");
  const walk = qs("#capsuleWalk");
  if (!button || !walk) return;
  const isWalkFullscreen = isSpatialWalkFullscreen();
  button.hidden = currentCapsuleView !== "walk";
  button.textContent = isWalkFullscreen ? "Exit full screen" : "Full screen";
  button.setAttribute("aria-pressed", String(isWalkFullscreen));
}

function scrollSpatialWalkToStation(stationIndex) {
  const walk = qs("#capsuleWalk");
  const nextIndex = clamp(Math.round(Number(stationIndex) || 0), 0, spatialWalkStations.length - 1);
  spatialLastInteractionTime = nowMs();
  spatialTourTarget = nextIndex;
  spatialTourHoldMs = 0;
  if (!walk || spatialWalkStations.length <= 1) {
    spatialActiveStationIndex = nextIndex;
    updateSpatialWalkViewButton();
    updateSpatialWalkOverlay();
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
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (rect?.width && rect?.height && !prefersReducedMotion()) {
    spatialPointerParallaxTarget.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    spatialPointerParallaxTarget.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }
  requestSpatialWalkFrame();
}

function clearSpatialWalkHover(event) {
  spatialHoveredStationIndex = -1;
  spatialPointerParallaxTarget.x = 0;
  spatialPointerParallaxTarget.y = 0;
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
  pauseSpatialWalkVideos();
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
  updateSpatialWalkSoundButton();
  updateSpatialWalkFullscreenButton();
  qs("#exitSwipeFeedButton").hidden = currentCapsuleView !== "feed";
  document.body.classList.toggle("is-swipe-feed-active", currentCapsuleView === "feed");
  document.body.classList.toggle("is-spatial-walk-active", currentCapsuleView === "walk");
  if (currentCapsuleView === "walk" && options.userInitiated) {
    scrollSpatialWalkStageIntoView();
  }

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
    revealSpatialWalkControls();
  } else {
    pauseSpatialWalkVideos();
    pauseSpatialWalkAudios();
    stopSpatialWalkLoop();
    exitSpatialWalkCssFullscreen();
    window.clearTimeout(spatialWalkControlsTimer);
    document.body.classList.remove("is-walk-controls-hidden");
  }

  qsaCapsuleViewButtons().forEach((button) => {
    const isActive = button.dataset.capsuleView === currentCapsuleView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function scrollSpatialWalkStageIntoView() {
  const walk = qs("#capsuleWalk");
  if (!walk || typeof walk.scrollIntoView !== "function") return;
  window.setTimeout(() => {
    walk.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, 0);
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

async function toggleSpatialWalkFullscreen() {
  const target = qs("#capsuleWalk");
  if (!target) return;

  if (isSpatialWalkFullscreen()) {
    if (spatialWalkCssFullscreen) {
      exitSpatialWalkCssFullscreen();
      return;
    }
    try {
      await exitNativeFullscreen();
    } catch {
      nativeSpatialWalkFullscreenActive = false;
      updateSpatialWalkFullscreenButton();
    }
    return;
  }

  // iOS Safari (and some in-app/WebViews) expose no element Fullscreen API, so
  // fall back to a CSS pseudo-fullscreen that pins the walk to the viewport.
  const requestFullscreen = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
  if (!requestFullscreen) {
    enterSpatialWalkCssFullscreen();
    return;
  }

  try {
    await requestFullscreen.call(target, { navigationUI: "hide" });
  } catch {
    try {
      await requestFullscreen.call(target);
    } catch {
      enterSpatialWalkCssFullscreen();
    }
  }
}

function isSpatialWalkFullscreen() {
  if (spatialWalkCssFullscreen) return true;
  const walk = qs("#capsuleWalk");
  const activeElement = activeFullscreenElement();
  return Boolean(walk && activeElement && (activeElement === walk || walk.contains?.(activeElement)));
}

function enterSpatialWalkCssFullscreen() {
  if (spatialWalkCssFullscreen) return;
  spatialWalkCssFullscreen = true;
  document.body.classList.add("is-spatial-walk-fullscreen");
  updateSpatialWalkFullscreenButton();
  window.setTimeout(() => {
    resizeSpatialWalkScene();
    requestSpatialWalkFrame();
  }, 90);
}

function exitSpatialWalkCssFullscreen() {
  if (!spatialWalkCssFullscreen) return;
  spatialWalkCssFullscreen = false;
  document.body.classList.remove("is-spatial-walk-fullscreen");
  updateSpatialWalkFullscreenButton();
  window.setTimeout(() => {
    resizeSpatialWalkScene();
    requestSpatialWalkFrame();
  }, 90);
}

async function exitNativeFullscreen() {
  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (!exitFullscreen || !activeFullscreenElement()) return;
  await exitFullscreen.call(document);
}

async function exitSwipeFullscreen() {
  try {
    await exitNativeFullscreen();
  } catch {
    nativeSwipeFullscreenActive = false;
  }
}

function activeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

function handleFullscreenChange() {
  const swipeTarget = qs("#capsuleDashboard");
  const spatialTarget = qs("#capsuleWalk");
  const slideshowTarget = qs("#slideshowModal");
  const activeElement = activeFullscreenElement();
  const isSpatialFullscreen = activeElement === spatialTarget || Boolean(activeElement && spatialTarget?.contains?.(activeElement));
  const isSwipeFullscreen = !isSpatialFullscreen && (activeElement === swipeTarget || Boolean(activeElement && swipeTarget?.contains?.(activeElement)));
  const isSlideshowFullscreen = activeElement === slideshowTarget || Boolean(activeElement && slideshowTarget?.contains?.(activeElement));

  if (isSpatialFullscreen) {
    nativeSpatialWalkFullscreenActive = true;
    document.body.classList.add("is-native-spatial-walk");
    window.setTimeout(resizeSpatialWalkScene, 80);
  } else {
    nativeSpatialWalkFullscreenActive = false;
    document.body.classList.remove("is-native-spatial-walk");
  }
  updateSpatialWalkFullscreenButton();

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
  document.body.classList.remove("is-swipe-feed-active", "is-spatial-walk-active", "is-native-spatial-walk");
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

function qsaWalkDots() {
  return Array.from(document.querySelectorAll("[data-walk-dot]"));
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
