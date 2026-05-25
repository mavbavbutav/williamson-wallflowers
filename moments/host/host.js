import { formatBytes, formatDate, formatDateTime, getHostToken, getParam, qs, qsa, requestJson, setNotice } from "../shared.js?v=20260525-3";

const eventId = getParam("event");
const token = getHostToken(eventId);
let currentStatus = "pending";
let submissions = [];
let eventRecord = null;

init();

function init() {
  qsa("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      currentStatus = button.dataset.status;
      qsa("[data-status]").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      render();
    });
  });

  qs("#refreshButton").addEventListener("click", loadGallery);
  qs("#modalClose").addEventListener("click", closeMediaModal);
  qs("#mediaModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMediaModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !qs("#mediaModal").hidden) closeMediaModal();
  });

  if (!eventId || !token) {
    setNotice(qs("#hostNotice"), "This host link is missing its event or access token.", "error");
    return;
  }

  loadGallery();
}

async function loadGallery() {
  try {
    setNotice(qs("#hostNotice"), "");
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/submissions`);
    eventRecord = payload.event;
    submissions = payload.submissions || [];
    qs("#eventName").textContent = eventRecord.name;
    qs("#eventMeta").textContent = `${formatDate(eventRecord.eventDate)}. Pending guest moments stay private until approved.`;
    render();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not load this host gallery.", "error");
  }
}

function render() {
  const grid = qs("#mediaGrid");
  const visible = submissions.filter((item) => item.status === currentStatus);
  grid.innerHTML = "";
  qs("#countLabel").textContent = `${visible.length} ${visible.length === 1 ? "submission" : "submissions"}`;
  qs("#emptyState").hidden = visible.length > 0;

  visible.forEach((submission) => {
    grid.append(renderCard(submission));
  });
}

function renderCard(submission) {
  const card = document.createElement("article");
  card.className = "media-card";

  const mediaUrl = `${submission.mediaUrl}&disposition=inline`;
  const downloadUrl = `${submission.downloadUrl}&disposition=attachment`;
  const thumb = document.createElement("div");
  thumb.className = `media-thumb is-${submission.mediaType}`;

  if (submission.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = submission.guestName ? `Photo from ${submission.guestName}` : "Guest photo";
    thumb.append(image);
  } else {
    const video = document.createElement("video");
    video.src = mediaUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth && video.videoHeight) {
        thumb.style.setProperty("--media-aspect-ratio", `${video.videoWidth} / ${video.videoHeight}`);
      }
    });
    thumb.append(video);
  }

  const body = document.createElement("div");
  body.className = "media-body";
  body.innerHTML = `
    <div class="button-row">
      <span class="status-pill is-${submission.status}">${submission.status}</span>
      <span class="status-pill">${submission.mediaType}</span>
    </div>
    <strong>${escapeHtml(submission.guestName || "Anonymous guest")}</strong>
    <p class="muted">${escapeHtml(submission.guestNote || "No note added.")}</p>
    <div class="media-meta">
      <span>${formatDateTime(submission.createdAt)}</span>
      <span>${formatBytes(submission.size)}</span>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(actionButton("View", "", () => openMediaModal(submission, mediaUrl)));

  if (submission.status !== "approved") {
    actions.append(actionButton("Approve", "is-success", () => updateSubmission(submission.id, "approved")));
  }

  if (submission.status !== "rejected") {
    actions.append(actionButton("Deny", "is-danger", () => updateSubmission(submission.id, "rejected")));
  }

  const download = document.createElement("a");
  download.className = "small-button";
  download.href = downloadUrl;
  download.textContent = "Download";
  download.download = "";
  actions.append(download);
  actions.append(actionButton("Delete", "is-danger", () => deleteSubmission(submission.id)));
  body.append(actions);

  card.append(body, thumb);
  return card;
}

function openMediaModal(submission, mediaUrl) {
  const modal = qs("#mediaModal");
  const stage = qs("#modalStage");
  const title = qs("#modalTitle");

  stage.innerHTML = "";
  title.textContent = `${submission.mediaType === "video" ? "Video" : "Photo"} from ${submission.guestName || "anonymous guest"}`;

  if (submission.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = submission.guestName ? `Photo from ${submission.guestName}` : "Guest photo";
    stage.append(image);
  } else {
    const video = document.createElement("video");
    video.src = mediaUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    stage.append(video);
  }

  document.body.classList.add("modal-open");
  modal.hidden = false;
  qs("#modalClose").focus();
}

function closeMediaModal() {
  const modal = qs("#mediaModal");
  const stage = qs("#modalStage");

  qsa("video", stage).forEach((video) => video.pause());
  stage.innerHTML = "";
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function actionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-button ${className || ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function updateSubmission(submissionId, status) {
  try {
    await hostRequest(`/host/submissions/${encodeURIComponent(submissionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadGallery();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not update submission.", "error");
  }
}

async function deleteSubmission(submissionId) {
  if (!window.confirm("Delete this submission from the host gallery?")) return;

  try {
    await hostRequest(`/host/submissions/${encodeURIComponent(submissionId)}`, {
      method: "DELETE"
    });
    await loadGallery();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not delete submission.", "error");
  }
}

function hostRequest(path, options = {}) {
  return requestJson(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
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
