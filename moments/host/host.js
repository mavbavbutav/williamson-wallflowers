import { formatBytes, formatDate, formatDateTime, getParam, qs, qsa, requestJson, setNotice } from "../shared.js?v=20260525-2";

const eventId = getParam("event");
const token = getParam("token");
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

  if (!eventId || !token) {
    setNotice(qs("#hostNotice"), "This host link is missing its event or access token.", "error");
    return;
  }

  loadGallery();
}

async function loadGallery() {
  try {
    setNotice(qs("#hostNotice"), "");
    const payload = await requestJson(`/host/events/${encodeURIComponent(eventId)}/submissions?token=${encodeURIComponent(token)}`);
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
  thumb.className = "media-thumb";

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

  if (submission.status !== "approved") {
    actions.append(actionButton("Approve", "is-success", () => updateSubmission(submission.id, "approved")));
  }

  if (submission.status !== "rejected") {
    actions.append(actionButton("Reject", "is-danger", () => updateSubmission(submission.id, "rejected")));
  }

  const download = document.createElement("a");
  download.className = "small-button";
  download.href = downloadUrl;
  download.textContent = "Download";
  download.download = "";
  actions.append(download);
  actions.append(actionButton("Delete", "is-danger", () => deleteSubmission(submission.id)));
  body.append(actions);

  card.append(thumb, body);
  return card;
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
    await requestJson(`/host/submissions/${encodeURIComponent(submissionId)}?token=${encodeURIComponent(token)}`, {
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
    await requestJson(`/host/submissions/${encodeURIComponent(submissionId)}?token=${encodeURIComponent(token)}`, {
      method: "DELETE"
    });
    await loadGallery();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not delete submission.", "error");
  }
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
