import { formatDate, formatDateTime, getParam, qs, requestJson, setNotice } from "../shared.js?v=20260531-2";

const eventId = getParam("event");
const token = readShareToken();
let capsule = null;
let items = [];
let slideIndex = 0;
let lastFocusedElement = null;
let currentCapsuleView = "timeline";
let feedScrollTimer = 0;

init();

async function init() {
  qs("#playSlideshowButton").addEventListener("click", () => openSlide(0));
  qsaCapsuleViewButtons().forEach((button) => {
    button.addEventListener("click", () => setCapsuleView(button.dataset.capsuleView || "timeline"));
  });
  qs("#capsuleFeed").addEventListener("scroll", () => {
    window.clearTimeout(feedScrollTimer);
    feedScrollTimer = window.setTimeout(pauseOffscreenFeedMedia, 120);
  }, { passive: true });
  qs("#slideClose").addEventListener("click", closeSlide);
  qs("#slidePrev").addEventListener("click", () => changeSlide(-1));
  qs("#slideNext").addEventListener("click", () => changeSlide(1));
  qs("#slideshowModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSlide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !qs("#slideshowModal").hidden) closeSlide();
    if (event.key === "ArrowRight" && !qs("#slideshowModal").hidden) changeSlide(1);
    if (event.key === "ArrowLeft" && !qs("#slideshowModal").hidden) changeSlide(-1);
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
              : `<video src="${escapeAttribute(item.mediaUrl)}&disposition=inline" preload="metadata" muted playsinline></video>`}
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
    <article class="capsule-feed-card is-${escapeAttribute(item.mediaType)}" data-feed-index="${index}">
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
}

function renderFeedMedia(item, index) {
  const mediaUrl = `${escapeAttribute(item.mediaUrl)}&disposition=inline`;
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
    <video data-feed-media="${index}" src="${mediaUrl}" preload="metadata" playsinline></video>
    <button class="capsule-feed-play" type="button" data-feed-play="${index}" aria-label="Play ${title}">
      <span>Tap to play</span>
    </button>
  `;
}

function setCapsuleView(view) {
  currentCapsuleView = view === "feed" && items.length ? "feed" : "timeline";
  qs("#capsuleTimeline").hidden = currentCapsuleView !== "timeline";
  qs("#capsuleFeed").hidden = currentCapsuleView !== "feed";

  if (currentCapsuleView !== "feed") {
    pauseAllFeedMedia();
  } else {
    qs("#capsuleFeed").scrollTo({ top: 0, behavior: "smooth" });
  }

  qsaCapsuleViewButtons().forEach((button) => {
    const isActive = button.dataset.capsuleView === currentCapsuleView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function toggleFeedPlayback(index) {
  const card = qs(`[data-feed-index="${cssEscape(String(index))}"]`);
  const media = card?.querySelector("[data-feed-media]");
  if (!media) return;

  const shouldPlay = media.paused;
  pauseAllFeedMedia(media);
  setFeedCardPlaying(card, false);

  if (!shouldPlay) {
    media.pause();
    setFeedCardPlaying(card, false);
    return;
  }

  media.play().then(() => {
    setFeedCardPlaying(card, true);
  }).catch(() => {
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
  const feed = qs("#capsuleFeed");
  const feedRect = feed?.getBoundingClientRect?.();
  if (!feedRect || feed.hidden) return;

  qsaPlayableMedia(feed).forEach((media) => {
    const card = media.closest?.(".capsule-feed-card");
    const rect = card?.getBoundingClientRect?.();
    if (!rect) return;

    const center = rect.top + rect.height / 2;
    const isNearCenter = center >= feedRect.top && center <= feedRect.bottom;
    if (!isNearCenter) {
      media.pause();
      setFeedCardPlaying(card, false);
    }
  });
}

function setFeedCardPlaying(card, isPlaying) {
  if (!card) return;
  card.classList.toggle("is-playing", isPlaying);
  const button = card.querySelector("[data-feed-play]");
  if (button) button.querySelector("span").textContent = isPlaying ? "Tap to pause" : "Tap to play";
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
    video.src = `${item.mediaUrl}&disposition=inline`;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    stage.append(video);
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
  return Array.from(root.querySelectorAll("video, audio"));
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
