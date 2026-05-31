import { formatDate, formatDateTime, getParam, qs, requestJson, setNotice } from "../shared.js?v=20260531-1";

const eventId = getParam("event");
const token = readShareToken();
let capsule = null;
let items = [];
let slideIndex = 0;
let lastFocusedElement = null;

init();

async function init() {
  qs("#playSlideshowButton").addEventListener("click", () => openSlide(0));
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

  qs("#capsuleTimeline").innerHTML = items.map((item, index) => `
    <article class="media-card capsule-memory-card">
      <button class="capsule-memory-button" type="button" data-slide="${index}" aria-label="Open ${escapeAttribute(item.title)}">
        <span class="media-thumb is-${escapeAttribute(item.mediaType)}">
          ${item.mediaType === "photo"
            ? `<img src="${escapeAttribute(item.mediaUrl)}&disposition=inline" alt="${escapeAttribute(item.title)}" loading="lazy" />`
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
  qsaVideos(qs("#slideStage")).forEach((video) => video.pause());
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
  const value = hash.get("token") || query.get("token") || "";

  if (value) {
    query.delete("token");
    hash.delete("token");
    const nextUrl = new URL(window.location.href);
    nextUrl.search = query.toString();
    nextUrl.hash = hash.toString();
    window.history.replaceState(null, "", nextUrl.toString());
  }

  return value;
}

function normalizeSlideIndex(index) {
  return (index + items.length) % items.length;
}

function qsaSlides() {
  return Array.from(document.querySelectorAll("[data-slide]"));
}

function qsaVideos(root) {
  return Array.from(root.querySelectorAll("video"));
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
