import { formatDateTime, getParam, qs, requestJson } from "../../shared.js?v=20260531-2";

const eventId = getParam("event");
const token = readShareToken();
let items = [];
let slideIndex = 0;
let slideTimer = 0;
let displayStarted = false;
const PHOTO_SLIDE_DURATION_MS = 20000;
const SLIDE_ERROR_ADVANCE_MS = 6000;

init();

async function init() {
  qs("#startCastDisplayButton").addEventListener("click", startCastDisplay);
  window.addEventListener("resize", sizeCastFrame);

  if (!eventId || !token) {
    showCastStatus("This TV display link is missing its event or private token.");
    return;
  }

  try {
    const payload = await requestJson(`/capsules/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 12000
    });
    items = payload.items || [];
    qs("#castTitle").textContent = payload.event?.title || payload.event?.name || "Wallflower Time Capsule TV";
    showCastStatus(items.length ? "Ready to start the TV slideshow." : "This Time Capsule does not have visible moments yet.");
    renderCastSlide();
  } catch (error) {
    showCastStatus(error.message || "This TV display link is not valid.");
  }
}

async function startCastDisplay() {
  displayStarted = true;
  qs("#castStart").hidden = true;
  await requestCastFullscreen();
  renderCastSlide();
}

function renderCastSlide() {
  const stage = qs("#castStage");
  window.clearTimeout(slideTimer);
  pauseCastMedia();
  stage.innerHTML = "";

  if (!items.length) return;

  const item = items[slideIndex];
  const { frame, media } = createTvSlideFrame(item);
  stage.append(frame);
  sizeCastFrame();
  window.setTimeout(sizeCastFrame, 80);
  hydrateStreamVideos(stage);

  if (item.mediaType === "photo") {
    if (displayStarted) slideTimer = window.setTimeout(showNextCastSlide, PHOTO_SLIDE_DURATION_MS);
    return;
  }

  if (!media) return;
  media.addEventListener("ended", showNextCastSlide, { once: true });
  media.addEventListener("error", () => {
    slideTimer = window.setTimeout(showNextCastSlide, SLIDE_ERROR_ADVANCE_MS);
  }, { once: true });

  if (displayStarted) {
    media.play().catch(() => {
      media.controls = true;
      qs("#castStart").hidden = false;
      showCastStatus("Tap start, then play the media if this browser blocks autoplay.");
    });
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
    : item.thumbnailUrl || "";
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
    audio.controls = false;
    audio.preload = "auto";
    panel.append(audio);
    return { element: panel, media: audio };
  }

  const video = document.createElement("video");
  video.className = "tv-slide-foreground";
  const source = videoSourceAttributes(item);
  video.src = source.src;
  if (source.streamUrl) video.dataset.streamUrl = source.streamUrl;
  if (item.thumbnailUrl) video.poster = item.thumbnailUrl;
  video.preload = "auto";
  video.playsInline = true;
  video.controls = false;
  return { element: video, media: video };
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
  window.requestAnimationFrame(sizeCastFrame);
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

function showNextCastSlide() {
  if (!items.length) return;
  slideIndex = (slideIndex + 1) % items.length;
  renderCastSlide();
}

function sizeCastFrame() {
  const stage = qs("#castStage");
  const frame = stage?.querySelector(".tv-slide-frame");
  if (!frame) return;

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

async function requestCastFullscreen() {
  const target = document.documentElement;
  const requestFullscreen = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
  if (!requestFullscreen || document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) return;

  try {
    await requestFullscreen.call(target, { navigationUI: "hide" });
  } catch {
    try {
      await requestFullscreen.call(target);
    } catch {
      // The display link still works in full-viewport mode if fullscreen is denied.
    }
  }
}

function pauseCastMedia() {
  Array.from(qs("#castStage")?.querySelectorAll("video, audio") || []).forEach((media) => media.pause());
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

function inlineMediaUrl(url) {
  const value = String(url || "");
  return `${value}${value.includes("?") ? "&" : "?"}disposition=inline`;
}

function videoSourceAttributes(item) {
  const preferredUrl = item.streamUrl || item.mediaUrl;
  const fallbackUrl = preferredUrl === item.streamUrl ? item.mediaUrl : preferredUrl;
  return {
    src: inlineMediaUrl(fallbackUrl),
    streamUrl: item.streamUrl || ""
  };
}

function readShareToken() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("token") || query.get("token") || "";
}

function showCastStatus(message) {
  qs("#castStatus").textContent = message || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
