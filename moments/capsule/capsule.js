import { formatDate, formatDateTime, getParam, qs, requestJson, setNotice } from "../shared.js?v=20260531-2";
import { dataUrlToBlob } from "../video-thumbnails.js?v=20260601-video-thumbs-1";

const eventId = getParam("event");
const token = readShareToken();
let capsule = null;
let items = [];
let slideIndex = 0;
let lastFocusedElement = null;
let currentCapsuleView = "timeline";
let feedScrollTimer = 0;
let feedSoundUnlocked = false;
let nativeSwipeFullscreenActive = false;
const videoPosterCache = new Map();
const videoPosterPersistCache = new Set();
const FEED_MEDIA_WARM_RADIUS = 1;
const FEED_IMAGE_WARM_RADIUS = 2;
const FEED_PLAYABLE_READY_STATE = 2;

init();

async function init() {
  qs("#playSlideshowButton").addEventListener("click", () => openSlide(0));
  qs("#exitSwipeFeedButton").addEventListener("click", () => setCapsuleView("timeline", { userInitiated: true }));
  qsaCapsuleViewButtons().forEach((button) => {
    button.addEventListener("click", () => setCapsuleView(button.dataset.capsuleView || "timeline", { userInitiated: true }));
  });
  qs("#capsuleFeed").addEventListener("scroll", () => {
    scheduleFeedAutoplay(120);
  }, { passive: true });
  qs("#slideClose").addEventListener("click", closeSlide);
  qs("#slidePrev").addEventListener("click", () => changeSlide(-1));
  qs("#slideNext").addEventListener("click", () => changeSlide(1));
  qs("#slideshowModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSlide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && currentCapsuleView === "feed") setCapsuleView("timeline", { userInitiated: true });
    if (event.key === "Escape" && !qs("#slideshowModal").hidden) closeSlide();
    if (event.key === "ArrowRight" && !qs("#slideshowModal").hidden) changeSlide(1);
    if (event.key === "ArrowLeft" && !qs("#slideshowModal").hidden) changeSlide(-1);
  });
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

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
    render();
  } catch (error) {
    showError(error.message || "This Time Capsule link is not valid.");
  }
}

function render() {
  qs("#capsuleTitle").textContent = capsule.title || capsule.name || "Wallflower Time Capsule";
  qs("#capsuleMeta").textContent = `${formatDate(capsule.eventDate)}${capsule.publishedAt ? ` | Published ${formatDateTime(capsule.publishedAt)}` : ""}`;
  qs("#playSlideshowButton").hidden = items.length === 0;
  qs("#capsuleEmpty").hidden = items.length > 0;
  renderTimeline();
  renderSwipeFeed();
  setCapsuleView(items.length ? currentCapsuleView : "timeline");
  hydrateVideoPosters();
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
              : `<video ${videoPosterAttributes(item)} src="${escapeAttribute(inlineMediaUrl(item.mediaUrl))}" preload="metadata" muted playsinline></video>`}
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
    button.addEventListener("click", () => openSlide(Number(button.dataset.slide || 0)));
  });
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
    <video data-feed-media="${index}" ${videoPosterAttributes(item)} src="${mediaUrl}" preload="metadata" playsinline muted></video>
    <button class="capsule-feed-play" type="button" data-feed-play="${index}" aria-label="Play ${title}">
      <span>Tap to play</span>
    </button>
  `;
}

function setCapsuleView(view, options = {}) {
  currentCapsuleView = view === "feed" && items.length ? "feed" : "timeline";
  qs("#capsuleTimeline").hidden = currentCapsuleView !== "timeline";
  qs("#capsuleFeed").hidden = currentCapsuleView !== "feed";
  qs("#exitSwipeFeedButton").hidden = currentCapsuleView !== "feed";
  document.body.classList.toggle("is-swipe-feed-active", currentCapsuleView === "feed");

  if (currentCapsuleView !== "feed") {
    pauseAllFeedMedia();
    if (!options.skipFullscreenExit) exitSwipeFullscreen();
  } else {
    qs("#capsuleFeed").scrollTo({ top: 0, behavior: "smooth" });
    if (options.userInitiated) {
      unlockFeedSound();
      requestSwipeFullscreen();
      syncFeedAutoplay();
    } else {
      scheduleFeedAutoplay(320);
    }
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
  const target = qs("#capsuleDashboard");
  const activeElement = activeFullscreenElement();
  const isSwipeFullscreen = activeElement === target || Boolean(activeElement && target?.contains?.(activeElement));

  if (isSwipeFullscreen) {
    nativeSwipeFullscreenActive = true;
    document.body.classList.add("is-native-swipe-feed");
    return;
  }

  const wasNativeSwipeFullscreen = nativeSwipeFullscreenActive;
  nativeSwipeFullscreenActive = false;
  document.body.classList.remove("is-native-swipe-feed");

  if (wasNativeSwipeFullscreen && currentCapsuleView === "feed") {
    setCapsuleView("timeline", { skipFullscreenExit: true });
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

function scheduleFeedAutoplay(delay = 120) {
  window.clearTimeout(feedScrollTimer);
  feedScrollTimer = window.setTimeout(syncFeedAutoplay, delay);
}

function syncFeedAutoplay() {
  const feed = qs("#capsuleFeed");
  const feedRect = feed?.getBoundingClientRect?.();
  if (!feedRect || feed.hidden || currentCapsuleView !== "feed") {
    pauseAllFeedMedia();
    return;
  }

  const activeCard = getCenteredFeedCard(feed);
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
  media.play().then(() => {
    setFeedAutoplayBlocked(card, false);
    setFeedCardPlaying(card, true);
  }).catch(() => {
    setFeedAutoplayBlocked(card, true);
    setFeedCardPlaying(card, false);
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

function openSlide(index) {
  if (!items.length) return;
  slideIndex = normalizeSlideIndex(index);
  lastFocusedElement = document.activeElement;
  document.body.classList.add("modal-open");
  qs("#slideshowModal").hidden = false;
  renderSlide();
  qs("#slideClose").focus();
}

function renderSlide() {
  const item = items[slideIndex];
  const stage = qs("#slideStage");
  stage.innerHTML = "";
  qs("#slideTitle").textContent = item.title || "Time Capsule moment";
  qs("#slideMeta").textContent = `${slideIndex + 1} / ${items.length} | ${item.chapter || "Guest moments"} | ${formatDateTime(item.capturedAt)}`;
  qs("#slideCaption").textContent = item.caption || item.guestNote || "";

  if (item.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = `${item.mediaUrl}&disposition=inline`;
    image.alt = item.title || "Time Capsule photo";
    stage.append(image);
  } else if (item.mediaType === "audio") {
    const audio = document.createElement("audio");
    audio.src = `${item.mediaUrl}&disposition=inline`;
    audio.controls = true;
    audio.preload = "metadata";
    stage.append(audio);
  } else {
    const video = document.createElement("video");
    video.src = inlineMediaUrl(item.mediaUrl);
    video.poster = item.thumbnailUrl || videoPosterUrl(item);
    if (!item.thumbnailUrl) {
      video.crossOrigin = "anonymous";
      video.dataset.videoPosterUrl = inlineMediaUrl(item.mediaUrl);
      if (item.thumbnailUploadUrl) video.dataset.thumbnailUploadUrl = item.thumbnailUploadUrl;
    }
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    stage.append(video);
    hydrateVideoPosters(stage);
  }
}

function changeSlide(delta) {
  slideIndex = normalizeSlideIndex(slideIndex + delta);
  renderSlide();
}

function closeSlide() {
  qsaPlayableMedia(qs("#slideStage")).forEach((media) => media.pause());
  qs("#slideStage").innerHTML = "";
  qs("#slideshowModal").hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

function showError(message) {
  document.body.classList.remove("is-swipe-feed-active");
  qs("#capsuleTitle").textContent = "Time Capsule unavailable";
  qs("#capsuleMeta").textContent = "Ask the event host for the current private link.";
  setNotice(qs("#capsuleNotice"), message, "error");
  qs("#capsuleEmpty").hidden = true;
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
