import { apiBase, formatDate, getParam, qs, qsa, requestJson, setNotice } from "./shared.js?v=20260525-1";

const MAX_VIDEO_SECONDS = 30;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const state = {
  tagCode: getParam("t"),
  event: null,
  mode: "",
  stream: null,
  recorder: null,
  chunks: [],
  mediaBlob: null,
  mediaFile: null,
  mediaType: "",
  durationSeconds: 0,
  recordStartedAt: 0,
  timerId: 0
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

init();

async function init() {
  bindEvents();

  if (!state.tagCode) {
    showError("This link is missing its tag code. Please scan the Wallflower Moments tag again.");
    return;
  }

  try {
    const payload = await requestJson(`/tags/${encodeURIComponent(state.tagCode)}`);
    state.event = payload.event;
    qs("#eventTitle").textContent = `${state.event.name}`;
    qs("#eventDetails").textContent = `${formatDate(state.event.eventDate)}. Add a photo or a short video message for the host.`;
    showView("welcome");
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
  qs("#fileFallbackButton").addEventListener("click", () => fileInput.click());
  qs("#photoCaptureButton").addEventListener("click", capturePhoto);
  qs("#videoRecordButton").addEventListener("click", startRecording);
  qs("#videoStopButton").addEventListener("click", stopRecording);
  qs("#retakeButton").addEventListener("click", () => chooseMode(state.mode));
  qs("#addAnotherButton").addEventListener("click", resetFlow);
  qs("#submissionForm").addEventListener("submit", submitMoment);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    await acceptFile(file);
  });
}

async function chooseMode(mode) {
  state.mode = mode;
  state.mediaType = mode;
  state.mediaBlob = null;
  state.mediaFile = null;
  state.durationSeconds = 0;
  setNotice(permissionNotice, "");
  setNotice(uploadNotice, "");
  progressTrack.hidden = true;
  progressBar.style.width = "0%";
  qs("#resetFlowButton").hidden = false;
  qs("#captureTitle").textContent = mode === "photo" ? "Take a photo." : "Record a message.";
  qs("#captureHelp").textContent = mode === "photo"
    ? "Use the camera button or upload a photo from your phone."
    : "Record up to 30 seconds or upload a short video from your phone.";
  fileInput.accept = mode === "photo" ? "image/*" : "video/*,.mp4,.mov,.m4v,.webm,.3gp,.3gpp,.3g2";
  fileInput.capture = mode === "photo" ? "environment" : "user";
  qs("#photoCaptureButton").hidden = mode !== "photo";
  qs("#videoRecordButton").hidden = mode !== "video";
  qs("#videoStopButton").hidden = true;
  qs("#recordTimer").hidden = true;
  showView("capture");
  await startCamera(mode);
}

async function startCamera(mode) {
  stopStream();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setNotice(permissionNotice, "Camera capture is not available in this browser. Use upload from phone instead.", "error");
    return;
  }

  try {
    const constraints = mode === "photo"
      ? { video: { facingMode: { ideal: "environment" } }, audio: false }
      : { video: { facingMode: { ideal: "user" } }, audio: true };

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraPreview.srcObject = state.stream;
  } catch (error) {
    setNotice(permissionNotice, "Camera permission was not available. You can still upload a file from your phone.", "error");
  }
}

function capturePhoto() {
  if (!state.stream) {
    fileInput.click();
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
    fileInput.click();
    return;
  }

  const mimeType = getSupportedVideoMimeType();
  state.chunks = [];
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
  state.recordStartedAt = Date.now();

  state.recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) state.chunks.push(event.data);
  });

  state.recorder.addEventListener("stop", () => {
    const type = state.recorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(state.chunks, { type });
    state.durationSeconds = Math.min(MAX_VIDEO_SECONDS, Math.round((Date.now() - state.recordStartedAt) / 1000));
    state.mediaBlob = blob;
    state.mediaFile = new File([blob], `wallflower-message-${Date.now()}.${type.includes("mp4") ? "mp4" : "webm"}`, { type });
    state.mediaType = "video";
    stopTimer();
    stopStream();
    renderPreview();
  });

  state.recorder.start();
  qs("#videoRecordButton").hidden = true;
  qs("#videoStopButton").hidden = false;
  qs("#recordTimer").hidden = false;
  startTimer();
  window.setTimeout(() => {
    if (state.recorder && state.recorder.state === "recording") stopRecording();
  }, MAX_VIDEO_SECONDS * 1000);
}

function stopRecording() {
  if (state.recorder && state.recorder.state === "recording") {
    state.recorder.stop();
  }
}

function startTimer() {
  stopTimer();
  const timer = qs("#recordTimer");
  state.timerId = window.setInterval(() => {
    const elapsed = Math.min(MAX_VIDEO_SECONDS, Math.floor((Date.now() - state.recordStartedAt) / 1000));
    timer.textContent = `00:${String(elapsed).padStart(2, "0")}`;
  }, 250);
}

function stopTimer() {
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = 0;
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

async function acceptFile(file) {
  const baseMimeType = getBaseMimeType(file.type);
  const extension = getFileExtension(file.name);
  const isPhoto = baseMimeType.startsWith("image/");
  const isVideo = baseMimeType.startsWith("video/") || ["mp4", "mov", "m4v", "webm", "3gp", "3gpp", "3g2"].includes(extension);

  if (!isPhoto && !isVideo) {
    setNotice(permissionNotice, "Please choose a photo or standard phone video file.", "error");
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

  if (isVideo) {
    const duration = await readVideoDuration(file);
    if (duration > MAX_VIDEO_SECONDS + 0.5) {
      setNotice(permissionNotice, "Videos must be 30 seconds or shorter.", "error");
      return;
    }
    state.durationSeconds = Math.round(duration);
  }

  state.mediaFile = file;
  state.mediaBlob = file;
  state.mediaType = isPhoto ? "photo" : "video";
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

function readVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration || 0);
    };
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  });
}

function renderPreview() {
  const frame = qs("#previewFrame");
  const url = URL.createObjectURL(state.mediaBlob);
  frame.innerHTML = "";

  if (state.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "Preview of your photo";
    frame.append(image);
  } else {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    frame.append(video);
  }

  showView("review");
}

async function submitMoment(event) {
  event.preventDefault();

  if (!state.mediaFile) {
    setNotice(uploadNotice, "Please capture or choose a photo or video first.", "error");
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

  qs("#submitButton").disabled = true;
  progressTrack.hidden = false;
  setNotice(uploadNotice, "Sending your moment...", "");

  try {
    await uploadWithProgress(`/events/${encodeURIComponent(state.event.id)}/submissions`, formData);
    qs("#submissionForm").reset();
    showView("success");
  } catch (error) {
    setNotice(uploadNotice, error.message || "Upload failed. Please try again.", "error");
  } finally {
    qs("#submitButton").disabled = false;
  }
}

function uploadWithProgress(path, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase}${path}`);
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      progressBar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
    });

    xhr.addEventListener("load", () => {
      const payload = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        progressBar.style.width = "100%";
        resolve(payload);
      } else {
        reject(new Error(payload.message || "Upload failed."));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error while uploading.")));
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
  state.mediaBlob = null;
  state.mediaFile = null;
  state.mediaType = "";
  state.durationSeconds = 0;
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
}

function showView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.hidden = key !== name;
  });
}

function showError(message) {
  qs("#errorMessage").textContent = message;
  showView("error");
}
