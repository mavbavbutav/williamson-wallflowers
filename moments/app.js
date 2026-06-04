import { apiBase, formatDate, formatDateTime, getParam, isLocalHost, qs, qsa, requestJson, setNotice } from "./shared.js?v=20260604-local-demo-1";
import { createVideoThumbnailFile } from "./video-thumbnails.js?v=20260601-video-thumbs-1";

const MAX_VIDEO_SECONDS = 30;
const MAX_AUDIO_SECONDS = 60;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "3gp", "3gpp", "3g2"];
const AUDIO_EXTENSIONS = ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "webm"];

const state = {
  tagCode: getParam("t"),
  event: null,
  uploadToken: "",
  mode: "",
  stream: null,
  recorder: null,
  chunks: [],
  facingMode: "environment",
  mediaBlob: null,
  mediaFile: null,
  thumbnailFile: null,
  mediaType: "",
  previewUrl: "",
  durationSeconds: 0,
  recordStartedAt: 0,
  timerId: 0,
  hostPosts: [],
  isLocalDemo: false,
  hostPostsTimerId: 0,
  countdownTimerId: 0,
  isCountdownLocked: false
};

const views = {
  loading: qs("#loadingView"),
  error: qs("#errorView"),
  welcome: qs("#welcomeView"),
  capture: qs("#captureView"),
  review: qs("#reviewView"),
  success: qs("#successView")
};

const cameraPreview = qs("#cameraPreview");
const permissionNotice = qs("#permissionNotice");
const fileInput = qs("#fileInput");
const progressTrack = qs("#progressTrack");
const progressBar = qs("#progressBar");
const uploadNotice = qs("#uploadNotice");
const switchCameraButton = qs("#switchCameraButton");
const cameraStage = qs("#cameraStage");
const voiceMemoCue = qs("#voiceMemoCue");
const countdownBadge = qs("#countdownBadge");
const countdownBanner = qs("#countdownBanner");
const countdownMessage = qs("#countdownMessage");
const countdownTimer = qs("#countdownTimer");
const countdownUnlockHint = qs("#countdownUnlockHint");
const countdownLockedNotice = qs("#countdownLockedNotice");
const hostPostsTitle = qs("#hostPostsTitle");
const hostPostsSubtitle = qs("#hostPostsSubtitle");

init();

async function init() {
  bindEvents();

  if (!state.tagCode) {
    showError("This link is missing its tag code. Please scan the Wallflower Moments tag again.");
    return;
  }

  try {
    const payload = getLocalDemoGuestPayload(state.tagCode) || await requestJson(`/tags/${encodeURIComponent(state.tagCode)}`);
    state.event = payload.event;
    state.uploadToken = payload.uploadToken || "";
    state.isLocalDemo = !!payload.isLocalDemo;
    state.hostPosts = payload.hostPosts || [];
    qs("#eventTitle").textContent = `${state.event.name}`;
    qs("#eventDetails").textContent = formatDate(state.event.eventDate);
    renderCountdown();
    showView("welcome");
    await loadHostPosts({ silent: true });
    startHostPostsPolling();
  } catch (error) {
    const message = error.message === "Failed to fetch" || error.message === "Request timed out"
      ? "We could not reach the Wallflower Moments service. Please check your connection or ask the host for help."
      : error.message || "This tag is not active for an event.";
    showError(message);
  }
}

function bindEvents() {
  qsa("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => chooseMode(button.dataset.mode));
  });

  qs("#resetFlowButton").addEventListener("click", resetFlow);
  qs("#fileFallbackButton").addEventListener("click", openPhoneLibrary);
  qs("#photoCaptureButton").addEventListener("click", capturePhoto);
  qs("#videoRecordButton").addEventListener("click", startRecording);
  qs("#videoStopButton").addEventListener("click", stopRecording);
  switchCameraButton.addEventListener("click", switchCamera);
  qs("#retakeButton").addEventListener("click", () => chooseMode(state.mode));
  qs("#addAnotherButton").addEventListener("click", resetFlow);
  qs("#submissionForm").addEventListener("submit", submitMoment);
  qs("#refreshHostPostsButton").addEventListener("click", () => loadHostPosts());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (isCountdownLocked()) {
      showCountdownLockedNotice();
      fileInput.value = "";
      return;
    }
    await acceptFile(file);
    fileInput.value = "";
  });
}

async function loadHostPosts({ silent = false } = {}) {
  if (!state.event?.id || !state.uploadToken) return;
  if (state.isLocalDemo) {
    renderHostPosts();
    if (!silent) setNotice(qs("#hostPostsNotice"), `${getGuestPartyViewName()} refreshed.`, "success");
    return;
  }

  try {
    const payload = await requestJson(`/events/${encodeURIComponent(state.event.id)}/host-posts`, {
      headers: { Authorization: `Bearer ${state.uploadToken}` },
      timeoutMs: 6000
    });
    state.hostPosts = payload.items || [];
    renderHostPosts();
    if (!silent && state.hostPosts.length === 0) {
      setNotice(qs("#hostPostsNotice"), `No ${getGuestPartyViewName()} moments yet. Check back soon.`, "");
    } else if (!silent) {
      setNotice(qs("#hostPostsNotice"), `${getGuestPartyViewName()} refreshed.`, "success");
    }
  } catch (error) {
    if (!silent) {
      setNotice(qs("#hostPostsNotice"), error.message || `Could not refresh ${getGuestPartyViewName()}.`, "error");
    }
    if (state.hostPosts.length === 0) {
      qs("#hostPostsView").hidden = true;
    }
  }
}

function startHostPostsPolling() {
  if (state.isLocalDemo) return;
  if (state.hostPostsTimerId) window.clearInterval(state.hostPostsTimerId);
  state.hostPostsTimerId = window.setInterval(() => loadHostPosts({ silent: true }), 30000);
}

function renderHostPosts() {
  const view = qs("#hostPostsView");
  const grid = qs("#guestHostPostsGrid");
  updateGuestPartyViewLanguage();
  const posts = state.hostPosts
    .slice()
    .sort((a, b) => new Date(b.capturedAt || b.createdAt || 0) - new Date(a.capturedAt || a.createdAt || 0));

  view.hidden = posts.length === 0;
  grid.innerHTML = "";

  posts.forEach((item) => {
    grid.append(renderHostPostCard(item));
  });
}

function renderHostPostCard(item) {
  const card = document.createElement("article");
  card.className = `party-card is-${item.mediaType}`;
  const partyViewName = getGuestPartyViewName();

  const mediaUrl = `${item.mediaUrl}&disposition=inline`;
  const media = document.createElement("div");
  media.className = `party-card-media is-${item.mediaType}`;

  if (item.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = item.title || `${partyViewName} photo`;
    image.loading = "lazy";
    media.append(image);
  } else if (item.mediaType === "audio") {
    media.innerHTML = `
      <div class="voice-memo-panel">
        <div class="voice-memo-header">
          <div class="voice-memo-copy">
            <span class="voice-memo-kicker">${item.source === "host" ? "Host voice memo" : "Guest voice memo"}</span>
            <strong>${escapeHtml(item.title || partyViewName)}</strong>
            <span class="voice-memo-detail">${escapeHtml(item.durationSeconds ? formatTimer(item.durationSeconds) : "Tap play to listen")}</span>
          </div>
        </div>
        <div class="voice-waveform" aria-hidden="true">
          ${[34, 62, 48, 78, 42, 90, 56, 70].map((height) => `<span style="--bar-height: ${height}%"></span>`).join("")}
        </div>
      </div>
    `;
    const audio = document.createElement("audio");
    audio.src = mediaUrl;
    audio.controls = true;
    audio.preload = "metadata";
    media.querySelector(".voice-memo-panel").append(audio);
  } else {
    const video = document.createElement("video");
    video.src = mediaUrl;
    if (item.thumbnailUrl) video.poster = item.thumbnailUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    media.append(video);
    bindPartyVideoOverlay(card, video);
  }

  const body = document.createElement("div");
  body.className = "party-card-body";
  body.innerHTML = `
    <div class="button-row">
      <span class="status-pill">${item.source === "host" ? "Host Post" : "Guest Moment"}</span>
      <span class="status-pill">${escapeHtml(getMediaTypeLabel(item.mediaType))}</span>
    </div>
    <strong>${escapeHtml(item.title || (item.source === "host" ? "Host Post" : "Guest moment"))}</strong>
    <p>${escapeHtml(item.caption || item.guestNote || "")}</p>
    <span class="muted">${escapeHtml(formatDateTime(item.capturedAt || item.createdAt))}</span>
  `;

  card.append(media, body);
  return card;
}

function bindPartyVideoOverlay(card, video) {
  let hideTimer = 0;

  const showOverlay = () => {
    window.clearTimeout(hideTimer);
    card.classList.remove("is-overlay-muted");
    if (!video.paused && !video.ended) {
      hideTimer = window.setTimeout(() => card.classList.add("is-overlay-muted"), 2600);
    }
  };

  const keepOverlayVisible = () => {
    window.clearTimeout(hideTimer);
    card.classList.remove("is-overlay-muted");
  };

  video.addEventListener("play", showOverlay);
  video.addEventListener("pause", keepOverlayVisible);
  video.addEventListener("ended", keepOverlayVisible);
  card.addEventListener("pointermove", showOverlay);
  card.addEventListener("touchstart", showOverlay, { passive: true });
  card.addEventListener("focusin", showOverlay);
}

function openPhoneLibrary() {
  if (isCountdownLocked()) {
    showCountdownLockedNotice();
    return;
  }

  fileInput.removeAttribute("capture");
  fileInput.click();
}

async function chooseMode(mode) {
  if (isCountdownLocked()) {
    showCountdownLockedNotice();
    return;
  }

  state.mode = mode;
  state.mediaType = mode;
  state.mediaBlob = null;
  state.mediaFile = null;
  state.thumbnailFile = null;
  state.durationSeconds = 0;
  state.facingMode = mode === "photo" ? "environment" : "user";
  cameraStage.classList.toggle("is-audio", mode === "audio");
  cameraPreview.hidden = mode === "audio";
  if (voiceMemoCue) voiceMemoCue.hidden = mode !== "audio";
  updateSwitchCameraButton();
  setNotice(permissionNotice, "");
  setNotice(uploadNotice, "");
  progressTrack.hidden = true;
  progressBar.style.width = "0%";
  progressTrack.setAttribute("aria-valuenow", "0");
  qs("#resetFlowButton").hidden = false;
  qs("#captureTitle").textContent = getCaptureTitle(mode);
  qs("#captureHelp").textContent = getCaptureHelp(mode);
  fileInput.accept = getAcceptTypes(mode);
  fileInput.removeAttribute("capture");
  qs("#photoCaptureButton").hidden = mode !== "photo";
  qs("#videoRecordButton").hidden = mode === "photo";
  qs("#videoRecordButton").textContent = mode === "audio" ? "Start voice memo" : "Start recording";
  qs("#videoStopButton").hidden = true;
  qs("#recordTimer").hidden = true;
  showView("capture");
  setNotice(
    permissionNotice,
    getOpeningNotice(mode)
  );
  await startCamera(mode);
}

async function startCamera(mode, options = {}) {
  stopStream();
  updateSwitchCameraButton(true);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setNotice(permissionNotice, mode === "audio"
      ? "Microphone recording is not available in this browser. Use upload from phone instead."
      : "Camera capture is not available in this browser. Use upload from phone instead.", "error");
    return false;
  }

  try {
    const constraints = buildCameraConstraints(mode, state.facingMode, options.exactFacingMode);

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraPreview.srcObject = mode === "audio" ? null : state.stream;
    updateSwitchCameraButton();
    setNotice(permissionNotice, getReadyNotice(mode), "success");
    return true;
  } catch (error) {
    updateSwitchCameraButton(true);
    setNotice(permissionNotice, mode === "audio"
      ? "Microphone permission was not available. Tap Upload from phone to choose an existing audio file."
      : "Camera permission was not available. Tap Upload from phone to choose an existing file.", "error");
    return false;
  }
}

async function switchCamera() {
  if (!state.mode || state.mode === "audio" || switchCameraButton.disabled) return;

  const nextFacingMode = state.facingMode === "user" ? "environment" : "user";
  const previousFacingMode = state.facingMode;

  state.facingMode = nextFacingMode;
  updateSwitchCameraButton(true);
  setNotice(permissionNotice, `Switching to ${cameraLabel(state.facingMode)} camera...`);

  const switched = await startCamera(state.mode, { exactFacingMode: true });
  if (!switched) {
    state.facingMode = previousFacingMode;
    await startCamera(state.mode);
    setNotice(permissionNotice, "That camera was not available on this device. Keeping the current camera.", "error");
  }
}

function buildCameraConstraints(mode, facingMode, exactFacingMode = false) {
  if (mode === "audio") {
    return {
      video: false,
      audio: true
    };
  }

  return {
    video: { facingMode: exactFacingMode ? { exact: facingMode } : { ideal: facingMode } },
    audio: mode === "video"
  };
}

function capturePhoto() {
  if (!state.stream) {
    openPhoneLibrary();
    return;
  }

  const video = cameraPreview;
  const canvas = document.createElement("canvas");
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(video, 0, 0, width, height);

  canvas.toBlob((blob) => {
    if (!blob) {
      setNotice(permissionNotice, "We could not capture that photo. Try uploading from your phone.", "error");
      return;
    }

    state.mediaBlob = blob;
    state.mediaFile = new File([blob], `wallflower-moment-${Date.now()}.jpg`, { type: "image/jpeg" });
    state.mediaType = "photo";
    stopStream();
    renderPreview();
  }, "image/jpeg", 0.88);
}

function startRecording() {
  if (!state.stream || !window.MediaRecorder) {
    setNotice(permissionNotice, state.mode === "audio"
      ? "Voice memo recording is not available in this browser. Upload an audio file instead."
      : "Video recording is not available in this browser. Upload a short phone video instead.", "error");
    openPhoneLibrary();
    return;
  }

  const isAudio = state.mode === "audio";
  const mediaType = isAudio ? "audio" : "video";
  const maxSeconds = getMaxDurationSeconds(mediaType);
  const mimeType = isAudio ? getSupportedAudioMimeType() : getSupportedVideoMimeType();
  state.chunks = [];
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
  state.recordStartedAt = Date.now();

  state.recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) state.chunks.push(event.data);
  });

  state.recorder.addEventListener("stop", async () => {
    const type = state.recorder.mimeType || mimeType || (isAudio ? "audio/webm" : "video/webm");
    const blob = new Blob(state.chunks, { type });
    state.durationSeconds = Math.min(maxSeconds, Math.round((Date.now() - state.recordStartedAt) / 1000));
    state.mediaBlob = blob;
    state.mediaFile = new File([blob], `${isAudio ? "wallflower-voice-memo" : "wallflower-message"}-${Date.now()}.${getRecorderExtension(type, mediaType)}`, { type });
    state.mediaType = mediaType;
    state.thumbnailFile = mediaType === "video" ? await createVideoThumbnailFile(state.mediaFile, `wallflower-video-thumbnail-${Date.now()}.jpg`) : null;
    stopTimer();
    stopStream();
    renderPreview();
  });

  state.recorder.start();
  setNotice(permissionNotice, `Recording. Keep it under ${maxSeconds} seconds, then tap Stop when you are done.`);
  qs("#videoRecordButton").hidden = true;
  qs("#videoStopButton").hidden = false;
  qs("#recordTimer").hidden = false;
  updateSwitchCameraButton(true);
  startTimer(maxSeconds);
  window.setTimeout(() => {
    if (state.recorder && state.recorder.state === "recording") stopRecording();
  }, maxSeconds * 1000);
}

function stopRecording() {
  if (state.recorder && state.recorder.state === "recording") {
    state.recorder.stop();
  }
}

function startTimer(maxSeconds = MAX_VIDEO_SECONDS) {
  stopTimer();
  const timer = qs("#recordTimer");
  state.timerId = window.setInterval(() => {
    const elapsed = Math.min(maxSeconds, Math.floor((Date.now() - state.recordStartedAt) / 1000));
    timer.textContent = formatTimer(elapsed);
  }, 250);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = 0;
}

function startCountdown() {
  if (!state.event) return;
  if (!state.event.countdownEnabled) {
    hideCountdown();
    return;
  }

  const target = getCountdownTarget();
  if (!target) {
    hideCountdown();
    return;
  }

  if (!countdownBanner || !countdownMessage || !countdownTimer) return;

  const label = state.event.countdownMessage || "Party starts in";

  const render = () => {
    const remaining = target - Date.now();
    const locked = remaining > 0;
    countdownBanner.hidden = false;
    countdownBanner.classList.toggle("is-live", !locked);
    applyGuestUploadLock(locked);
    if (!locked) {
      countdownBadge.textContent = "Now live";
      countdownMessage.textContent = "Party is underway";
      countdownTimer.innerHTML = `<span class="countdown-live-message">Guests can send moments now.</span>`;
      return;
    }

    countdownBadge.textContent = "Countdown";
    countdownMessage.textContent = `${label}`;
    countdownTimer.innerHTML = formatCountdown(remaining);
  };

  render();
  if (state.countdownTimerId) window.clearInterval(state.countdownTimerId);
  state.countdownTimerId = window.setInterval(render, 1000);
}

function hideCountdown() {
  if (countdownBanner) {
    countdownBanner.hidden = true;
    countdownBanner.classList.remove("is-live");
  }
  applyGuestUploadLock(false);

  if (state.countdownTimerId) {
    window.clearInterval(state.countdownTimerId);
    state.countdownTimerId = 0;
  }
}

function renderCountdown() {
  startCountdown();
}

function getCountdownTarget() {
  return parseCountdownStart(state.event?.eventStartAt);
}

function isCountdownLocked() {
  const target = getCountdownTarget();
  return Boolean(state.event?.countdownEnabled && target && target > Date.now());
}

function applyGuestUploadLock(locked) {
  const wasLocked = state.isCountdownLocked;
  state.isCountdownLocked = Boolean(locked);
  document.body.classList.toggle("is-countdown-locked", state.isCountdownLocked);
  if (countdownUnlockHint) countdownUnlockHint.hidden = !state.isCountdownLocked;
  if (countdownLockedNotice) countdownLockedNotice.hidden = !state.isCountdownLocked;
  updateGuestPartyViewLanguage();

  qsa("[data-mode]").forEach((button) => {
    button.disabled = state.isCountdownLocked;
    button.setAttribute("aria-disabled", String(state.isCountdownLocked));
    if (state.isCountdownLocked) {
      button.setAttribute("aria-describedby", "countdownLockedNotice");
      button.title = "Uploads unlock when the party starts.";
    } else {
      button.removeAttribute("aria-describedby");
      button.removeAttribute("title");
    }
  });

  ["#fileFallbackButton", "#photoCaptureButton", "#videoRecordButton", "#switchCameraButton"].forEach((selector) => {
    const control = qs(selector);
    if (!control) return;
    if (state.isCountdownLocked) {
      control.disabled = true;
    } else if (wasLocked) {
      control.disabled = false;
    }
  });

  const submitButton = qs("#submitButton");
  if (submitButton && state.isCountdownLocked) {
    submitButton.disabled = true;
  } else if (submitButton && wasLocked) {
    submitButton.disabled = false;
  }
}

function updateGuestPartyViewLanguage() {
  const name = getGuestPartyViewName();
  if (hostPostsTitle) hostPostsTitle.textContent = name;
  if (hostPostsSubtitle) {
    hostPostsSubtitle.textContent = state.isCountdownLocked
      ? "Only the host can add media before the party starts. Guest uploads unlock when the countdown ends."
      : "Moments the host shares for everyone to enjoy during the event.";
  }
}

function getGuestPartyViewName() {
  return state.isCountdownLocked ? "Pre-Party View" : "Party View";
}

function showCountdownLockedNotice() {
  const message = "The party has not started yet. Guest uploads unlock when the countdown ends.";
  setNotice(uploadNotice, message, "error");
  setNotice(permissionNotice, message, "error");
}

function formatCountdown(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    ["Days", days],
    ["Hours", hours],
    ["Minutes", minutes],
    ["Seconds", seconds]
  ];

  return parts.map(([label, value]) => `
    <span class="countdown-unit">
      <span class="countdown-value">${String(value).padStart(2, "0")}</span>
      <span class="countdown-label">${label}</span>
    </span>
  `).join("");
}

function parseCountdownStart(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function getSupportedVideoMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

function getSupportedAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg"
  ];

  return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
}

async function acceptFile(file) {
  const baseMimeType = getBaseMimeType(file.type);
  const extension = getFileExtension(file.name);
  const isPhoto = baseMimeType.startsWith("image/");
  const isAudio = baseMimeType.startsWith("audio/") || (state.mode === "audio" && AUDIO_EXTENSIONS.includes(extension));
  const isVideo = !isAudio && (baseMimeType.startsWith("video/") || VIDEO_EXTENSIONS.includes(extension));

  if (!isPhoto && !isVideo && !isAudio) {
    setNotice(permissionNotice, "Please choose a photo, standard phone video, or voice memo file.", "error");
    return;
  }

  if (isPhoto && file.size > MAX_PHOTO_BYTES) {
    setNotice(permissionNotice, "Photos must be 8 MB or smaller.", "error");
    return;
  }

  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    setNotice(permissionNotice, "Videos must be 50 MB or smaller.", "error");
    return;
  }

  if (isAudio && file.size > MAX_AUDIO_BYTES) {
    setNotice(permissionNotice, "Voice memos must be 20 MB or smaller.", "error");
    return;
  }

  if (isVideo) {
    const duration = await readMediaDuration(file, "video");
    if (duration > MAX_VIDEO_SECONDS + 0.5) {
      setNotice(permissionNotice, "That video is longer than 30 seconds. Please trim it or record a shorter message.", "error");
      return;
    }
    state.durationSeconds = Math.round(duration);
    state.thumbnailFile = await createVideoThumbnailFile(file, `wallflower-video-thumbnail-${Date.now()}.jpg`);
  }

  if (isAudio) {
    const duration = await readMediaDuration(file, "audio");
    if (duration > MAX_AUDIO_SECONDS + 0.5) {
      setNotice(permissionNotice, "That voice memo is longer than 60 seconds. Please trim it or record a shorter memo.", "error");
      return;
    }
    state.durationSeconds = Math.round(duration);
  }

  state.mediaFile = file;
  state.mediaBlob = file;
  state.mediaType = isPhoto ? "photo" : (isAudio ? "audio" : "video");
  if (!isVideo) state.thumbnailFile = null;
  stopStream();
  renderPreview();
}

function getBaseMimeType(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

function getFileExtension(filename) {
  const clean = String(filename || "").split("?")[0].split("#")[0];
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : "";
}

function readMediaDuration(file, mediaType) {
  return new Promise((resolve) => {
    const element = document.createElement(mediaType === "audio" ? "audio" : "video");
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(element.src);
      resolve(element.duration || 0);
    };
    element.onerror = () => {
      URL.revokeObjectURL(element.src);
      resolve(0);
    };
    element.src = URL.createObjectURL(file);
  });
}

function renderPreview() {
  const frame = qs("#previewFrame");
  revokePreviewUrl();
  const url = URL.createObjectURL(state.mediaBlob);
  state.previewUrl = url;
  frame.innerHTML = "";

  if (state.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "Preview of your photo";
    frame.append(image);
  } else if (state.mediaType === "audio") {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.controls = true;
    frame.append(audio);
  } else {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    frame.append(video);
  }

  renderSendSummary();
  showView("review");
}

function renderSendSummary() {
  const summary = qs("#sendSummary");
  if (!summary) return;

  const title = summary.querySelector("strong");
  const detail = summary.querySelector("span:last-child");
  const duration = state.durationSeconds ? ` It is ${formatTimer(state.durationSeconds)} long.` : "";

  if (title) title.textContent = getSendSummaryTitle(state.mediaType);
  if (detail) detail.textContent = `${getSendSummaryDetail(state.mediaType)}${duration}`;
}

async function submitMoment(event) {
  event.preventDefault();

  if (isCountdownLocked()) {
    showCountdownLockedNotice();
    return;
  }

  if (!state.mediaFile) {
    setNotice(uploadNotice, "Please capture or choose a photo, video, or voice memo first.", "error");
    return;
  }

  if (!qs("#consent").checked) {
    setNotice(uploadNotice, "Please confirm the private sharing consent before sending.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("media", state.mediaFile);
  formData.append("mediaType", state.mediaType);
  formData.append("guestName", qs("#guestName").value.trim());
  formData.append("guestNote", qs("#guestNote").value.trim());
  formData.append("consent", "true");
  formData.append("durationSeconds", String(state.durationSeconds || 0));
  formData.append("uploadToken", state.uploadToken);
  if (state.mediaType === "video" && state.thumbnailFile) {
    formData.append("thumbnail", state.thumbnailFile);
  }

  qs("#submitButton").disabled = true;
  progressTrack.hidden = false;
  progressBar.style.width = "0%";
  progressTrack.setAttribute("aria-valuenow", "0");
  setNotice(uploadNotice, "Sending your moment. Please keep this page open.", "");

  try {
    await uploadWithProgress(`/events/${encodeURIComponent(state.event.id)}/submissions`, formData);
    qs("#submissionForm").reset();
    showView("success");
    showGuestCelebration();
  } catch (error) {
    setNotice(uploadNotice, error.message || "Upload failed. Please try again.", "error");
  } finally {
    qs("#submitButton").disabled = isCountdownLocked();
  }
}

function uploadWithProgress(path, formData) {
  if (state.isLocalDemo) {
    return new Promise((resolve) => {
      progressBar.style.width = "100%";
      progressTrack.setAttribute("aria-valuenow", "100");
      setNotice(uploadNotice, "Local demo upload complete. No media was saved.", "success");
      window.setTimeout(() => resolve({ ok: true, demo: true }), 350);
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase}${path}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = 120000;

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = `${percent}%`;
      progressTrack.setAttribute("aria-valuenow", String(percent));
      setNotice(uploadNotice, `Uploading ${percent}%. Please keep this page open.`);
    });

    xhr.addEventListener("load", () => {
      const payload = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        progressBar.style.width = "100%";
        progressTrack.setAttribute("aria-valuenow", "100");
        setNotice(uploadNotice, "Upload complete.", "success");
        resolve(payload);
      } else {
        reject(new Error(payload.message || "Upload failed."));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error while uploading.")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out. Try again on a stronger connection.")));
    xhr.send(formData);
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function resetFlow() {
  stopStream();
  stopTimer();
  state.mode = "";
  state.facingMode = "environment";
  cameraStage.classList.remove("is-audio");
  cameraPreview.hidden = false;
  if (voiceMemoCue) voiceMemoCue.hidden = true;
  state.mediaBlob = null;
  state.mediaFile = null;
  state.thumbnailFile = null;
  state.mediaType = "";
  state.durationSeconds = 0;
  revokePreviewUrl();
  qs("#submissionForm").reset();
  qs("#resetFlowButton").hidden = true;
  showView("welcome");
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  cameraPreview.srcObject = null;
  updateSwitchCameraButton(true);
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.hidden = key !== name;
  });
  updateGuestFlow(name);
  window.requestAnimationFrame(() => {
    const activeView = views[name];
    const heading = activeView && activeView.querySelector("h1");
    if (!heading) return;
    try {
      heading.focus({ preventScroll: true });
    } catch {
      heading.focus();
    }
  });
}

function updateGuestFlow(viewName) {
  const stepMap = {
    welcome: "choose",
    capture: "capture",
    review: "review",
    success: "review"
  };
  const activeStep = stepMap[viewName] || "";
  const flowCard = qs("#guestFlowCard");
  if (flowCard) flowCard.hidden = !activeStep;

  qsa("[data-guest-step]").forEach((step) => {
    const isActive = step.dataset.guestStep === activeStep;
    const isDone = (
      activeStep === "capture" && step.dataset.guestStep === "choose"
    ) || (
      activeStep === "review" && step.dataset.guestStep !== "review"
    );
    step.classList.toggle("is-active", isActive);
    step.classList.toggle("is-done", isDone);
  });
}

function showError(message) {
  qs("#errorMessage").textContent = message;
  qs("#hostPostsView").hidden = true;
  showView("error");
}

function revokePreviewUrl() {
  if (!state.previewUrl) return;
  URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = "";
}

function updateSwitchCameraButton(disabled = false) {
  if (!switchCameraButton) return;
  const isRecording = state.recorder && state.recorder.state === "recording";
  switchCameraButton.hidden = state.mode === "audio" || !state.mode || qs("#captureView").hidden || !state.stream || isRecording;
  switchCameraButton.disabled = disabled || isRecording;
  switchCameraButton.textContent = `Use ${state.facingMode === "user" ? "back" : "front"} camera`;
  switchCameraButton.setAttribute("aria-label", `Switch to ${state.facingMode === "user" ? "back" : "front"} camera`);
}

function cameraLabel(facingMode) {
  return facingMode === "user" ? "front" : "back";
}

function getCaptureTitle(mode) {
  if (mode === "photo") return "Photo";
  if (mode === "audio") return "Voice Memo";
  return "Video";
}

function getCaptureHelp(mode) {
  if (mode === "photo") return "Take or upload a photo.";
  if (mode === "audio") return "Record or upload up to 60 seconds.";
  return "Record or upload up to 30 seconds.";
}

function getSendSummaryTitle(mediaType) {
  if (mediaType === "photo") return "Photo ready.";
  if (mediaType === "audio") return "Voice memo ready.";
  return "Video ready.";
}

function getSendSummaryDetail(mediaType) {
  if (mediaType === "photo") return "Add a name or note if you want.";
  if (mediaType === "audio") return "Add a name or note if you want.";
  return "Add a name or note if you want.";
}

function showGuestCelebration() {
  const celebration = qs("#guestCelebration");
  if (!celebration) return;
  celebration.classList.remove("is-celebrating");
  void celebration.offsetWidth;
  celebration.classList.add("is-celebrating");
}

function getAcceptTypes(mode) {
  if (mode === "photo") return "image/*";
  if (mode === "audio") return "audio/*,.m4a,.mp3,.wav,.ogg,.oga,.opus,.aac,.webm,.weba";
  return "video/*,.mp4,.mov,.m4v,.webm,.3gp,.3gpp,.3g2";
}

function getOpeningNotice(mode) {
  if (mode === "photo") return "Opening your camera. You can still upload from your phone if the prompt does not appear.";
  if (mode === "audio") return "Opening your microphone. You can still upload a voice memo from your phone instead.";
  return "Opening your camera and microphone. You can still upload a short phone video instead.";
}

function getReadyNotice(mode) {
  if (mode === "photo") return "Camera ready. Tap Switch camera to flip views.";
  if (mode === "audio") return "Microphone ready. Tap Start voice memo when you are ready.";
  return "Camera ready. Tap Switch camera before recording if you want the other camera.";
}

function getMaxDurationSeconds(mediaType) {
  return mediaType === "audio" ? MAX_AUDIO_SECONDS : MAX_VIDEO_SECONDS;
}

function getRecorderExtension(mimeType, mediaType) {
  const baseMimeType = getBaseMimeType(mimeType);
  const map = {
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };

  return map[baseMimeType] || (mediaType === "audio" ? "webm" : "webm");
}

function getMediaTypeLabel(mediaType) {
  if (mediaType === "audio") return "Voice memo";
  if (mediaType === "video") return "Video";
  return "Photo";
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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

function getLocalDemoGuestPayload(tagCode) {
  if (!isLocalHost()) return null;
  const demo = getLocalDemoParty(tagCode);
  if (!demo) return null;
  return {
    isLocalDemo: true,
    event: demo.event,
    uploadToken: "demo-upload-token",
    hostPosts: demo.hostPosts
  };
}

function getLocalDemoParty(id) {
  const started = id === "demo-live";
  const empty = id === "demo-empty";
  const preParty = id === "demo-pre-party";
  if (!started && !empty && !preParty) return null;

  const start = new Date(Date.now() + (preParty ? 18 * 60 * 1000 : -8 * 60 * 1000));
  const eventDate = toLocalDate(start);
  return {
    event: {
      id,
      name: preParty ? "Demo Pre-Party" : (empty ? "Demo Empty Party" : "Demo Live Party"),
      eventDate,
      eventStartAt: start.toISOString(),
      countdownEnabled: !empty,
      countdownMessage: "Party starts in"
    },
    hostPosts: empty ? [] : [
      localDemoHostPost({
        id: `${id}-host-photo`,
        mediaType: "photo",
        title: preParty ? "The room is almost ready" : "Welcome to the party",
        caption: preParty ? "Host-only warmup media shows here before guests can upload." : "Guest uploads are unlocked in this demo.",
        capturedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
      }),
      localDemoHostPost({
        id: `${id}-host-audio`,
        mediaType: "photo",
        title: "Second host warmup",
        caption: "Multiple host posts make the local feed easier to inspect.",
        capturedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString()
      })
    ]
  };
}

function localDemoHostPost(overrides = {}) {
  return {
    id: "demo-host-post",
    eventId: "demo",
    source: "host",
    mediaType: "photo",
    title: "Host post",
    caption: "",
    mediaUrl: "../assets/williamson-wallflowers-logo.png?demo=1",
    thumbnailUrl: "",
    durationSeconds: 0,
    capturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function toLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
