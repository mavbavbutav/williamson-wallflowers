import { copyText, formatBytes, formatDate, formatDateTime, getHostToken, getParam, qs, qsa, requestJson, setNotice } from "../shared.js?v=20260531-1";

const eventId = getParam("event");
const token = getHostToken(eventId);
let currentStatus = "pending";
let currentView = "submissions";
let submissions = [];
let eventRecord = null;
let timeCapsule = null;
let capsuleItems = [];
let lastFocusedElement = null;

init();

function init() {
  qsa("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      currentStatus = button.dataset.status;
      render();
    });
  });

  qsa("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      render();
    });
  });

  qs("#refreshButton").addEventListener("click", loadGallery);
  qs("#saveCapsuleButton").addEventListener("click", () => saveCapsule());
  qs("#publishCapsuleButton").addEventListener("click", () => saveCapsule("published"));
  qs("#unpublishCapsuleButton").addEventListener("click", () => saveCapsule("draft"));
  qs("#copyCapsuleLinkButton").addEventListener("click", () => copyText(qs("#capsuleShareUrl").value, qs("#copyCapsuleLinkButton")));
  qs("#openCapsuleLinkButton").addEventListener("click", () => {
    const url = qs("#capsuleShareUrl").value;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });
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

    if (eventRecord.timeCapsule?.enabled) {
      qs("#workspaceToolbar").hidden = false;
      await loadCapsule({ silent: true });
    } else {
      qs("#workspaceToolbar").hidden = true;
      currentView = "submissions";
      timeCapsule = null;
      capsuleItems = [];
    }

    render();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not load this host gallery.", "error");
  }
}

async function loadCapsule({ silent = false } = {}) {
  if (!eventRecord?.timeCapsule?.enabled) return;

  try {
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/time-capsule`);
    timeCapsule = payload.timeCapsule || null;
    capsuleItems = payload.items || [];
    if (!silent) setNotice(qs("#capsuleNotice"), "Time Capsule refreshed.", "success");
  } catch (error) {
    if (!silent) setNotice(qs("#capsuleNotice"), error.message || "Could not load the Time Capsule.", "error");
  }
}

function render() {
  renderWorkspaceTabs();
  renderSubmissions();
  renderCapsule();
  renderShare();
}

function renderWorkspaceTabs() {
  const capsuleEnabled = Boolean(eventRecord?.timeCapsule?.enabled);
  qs("#submissionsPanel").hidden = currentView !== "submissions";
  qs("#capsulePanel").hidden = !capsuleEnabled || currentView !== "capsule";
  qs("#sharePanel").hidden = !capsuleEnabled || currentView !== "share";

  qsa("[data-view]").forEach((tab) => {
    const isActive = tab.dataset.view === currentView;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });
}

function renderSubmissions() {
  const grid = qs("#mediaGrid");
  const visible = submissions.filter((item) => item.status === currentStatus);
  grid.innerHTML = "";
  updateSubmissionTabs();
  qs("#countLabel").textContent = `${visible.length} ${visible.length === 1 ? "submission" : "submissions"}`;
  qs("#emptyState").textContent = getEmptyMessage(currentStatus);
  qs("#emptyState").hidden = visible.length > 0;

  visible.forEach((submission) => {
    grid.append(renderSubmissionCard(submission));
  });
}

function renderSubmissionCard(submission) {
  const card = document.createElement("article");
  card.className = "media-card";

  const mediaUrl = `${submission.mediaUrl}&disposition=inline`;
  const downloadUrl = `${submission.downloadUrl}&disposition=attachment`;
  const thumb = renderThumb(submission, mediaUrl);

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
  actions.append(actionButton("View", "is-primary", () => openMediaModal(submission, mediaUrl)));

  if (submission.status !== "approved") {
    actions.append(actionButton("Approve", "is-success", () => updateSubmission(submission.id, "approved")));
  }

  if (submission.status !== "rejected") {
    actions.append(actionButton("Deny", "is-danger", () => updateSubmission(submission.id, "rejected")));
  }

  if (eventRecord?.timeCapsule?.enabled && submission.status === "approved" && !isInCapsule(submission.id)) {
    actions.append(actionButton("Add to Capsule", "", () => addSubmissionToCapsule(submission)));
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

function renderCapsule() {
  if (!eventRecord?.timeCapsule?.enabled) return;

  qs("#capsuleTitle").value = timeCapsule?.title || eventRecord.timeCapsule.title || `${eventRecord.name} Time Capsule`;
  qs("#capsuleStatus").textContent = timeCapsule?.status === "published"
    ? `Published ${formatDateTime(timeCapsule.publishedAt)}.`
    : "Draft keepsake timeline.";
  qs("#capsuleStatusPill").textContent = timeCapsule?.status || "draft";
  qs("#capsuleStatusPill").className = `status-pill${timeCapsule?.status === "published" ? " is-approved" : ""}`;

  const grid = qs("#capsuleGrid");
  grid.innerHTML = "";
  qs("#capsuleEmpty").hidden = capsuleItems.length > 0;

  capsuleItems.forEach((item) => {
    grid.append(renderCapsuleCard(item));
  });
}

function renderCapsuleCard(item) {
  const card = document.createElement("article");
  card.className = "media-card capsule-item";
  card.dataset.itemId = item.id;

  const mediaUrl = `${item.mediaUrl}&disposition=inline`;
  const thumb = renderThumb(item, mediaUrl);
  const body = document.createElement("div");
  body.className = "media-body capsule-item-form";
  body.innerHTML = `
    <label>
      Title
      <input data-capsule-field="title" value="${escapeAttribute(item.title)}" />
    </label>
    <label>
      Chapter
      <input data-capsule-field="chapter" value="${escapeAttribute(item.chapter)}" />
    </label>
    <label>
      Caption
      <textarea data-capsule-field="caption" rows="3">${escapeHtml(item.caption)}</textarea>
    </label>
    <div class="form-grid">
      <label>
        Captured time
        <input data-capsule-field="capturedAt" value="${escapeAttribute(item.capturedAt || "")}" />
      </label>
      <label>
        Location
        <input data-capsule-field="location" value="${escapeAttribute(item.location || "")}" />
      </label>
    </div>
    <div class="form-grid">
      <label>
        Sort
        <input data-capsule-field="sortOrder" type="number" value="${Number(item.sortOrder || 0)}" />
      </label>
      <label class="checkbox-row capsule-visible">
        <input data-capsule-field="isVisible" type="checkbox"${item.isVisible ? " checked" : ""} />
        <span>Visible in shared capsule</span>
      </label>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(actionButton("View", "is-primary", () => openMediaModal(item, mediaUrl)));
  actions.append(actionButton("Save", "is-success", () => saveCapsuleItem(item.id)));
  actions.append(actionButton("Remove", "is-danger", () => removeCapsuleItem(item.id)));
  body.append(actions);

  card.append(thumb, body);
  return card;
}

function renderShare() {
  if (!eventRecord?.timeCapsule?.enabled) return;

  const shareUrl = timeCapsule?.shareUrl || eventRecord.timeCapsule.shareUrl || "";
  const isPublished = timeCapsule?.status === "published";
  qs("#capsuleShareUrl").value = isPublished ? shareUrl : "";
  qs("#copyCapsuleLinkButton").disabled = !isPublished || !shareUrl;
  qs("#openCapsuleLinkButton").disabled = !isPublished || !shareUrl;
}

function renderThumb(item, mediaUrl) {
  const thumb = document.createElement("div");
  thumb.className = `media-thumb is-${item.mediaType}`;

  if (item.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = item.guestName ? `Photo from ${item.guestName}` : "Guest photo";
    thumb.append(image);
  } else {
    const video = document.createElement("video");
    video.src = mediaUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    thumb.append(video);
  }

  return thumb;
}

async function addSubmissionToCapsule(submission) {
  try {
    const result = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/time-capsule/items`, {
      method: "POST",
      body: JSON.stringify({
        submissionId: submission.id,
        title: submission.guestName ? `Moment from ${submission.guestName}` : "Guest moment",
        caption: submission.guestNote || "",
        chapter: "Guest moments"
      })
    });
    capsuleItems = [...capsuleItems, result.item].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    currentView = "capsule";
    setNotice(qs("#capsuleNotice"), "Moment added to the Time Capsule.", "success");
    render();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not add this moment to the Time Capsule.", "error");
  }
}

async function saveCapsule(status = "") {
  try {
    const body = { title: qs("#capsuleTitle").value.trim() };
    if (status) body.status = status;
    const result = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/time-capsule`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    timeCapsule = result.timeCapsule;
    setNotice(qs("#capsuleNotice"), status === "published" ? "Time Capsule published." : "Time Capsule saved.", "success");
    render();
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not save the Time Capsule.", "error");
  }
}

async function saveCapsuleItem(itemId) {
  const card = qs(`[data-item-id="${cssEscape(itemId)}"]`);
  if (!card) return;

  const body = {};
  qsa("[data-capsule-field]", card).forEach((field) => {
    body[field.dataset.capsuleField] = field.type === "checkbox" ? field.checked : field.value;
  });

  try {
    const result = await hostRequest(`/host/time-capsule/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    capsuleItems = capsuleItems.map((item) => item.id === itemId ? result.item : item);
    setNotice(qs("#capsuleNotice"), "Capsule moment saved.", "success");
    render();
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not save this capsule moment.", "error");
  }
}

async function removeCapsuleItem(itemId) {
  if (!window.confirm("Remove this moment from the Time Capsule? The original host gallery submission stays available.")) return;

  try {
    await hostRequest(`/host/time-capsule/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    capsuleItems = capsuleItems.filter((item) => item.id !== itemId);
    setNotice(qs("#capsuleNotice"), "Moment removed from the Time Capsule.", "success");
    render();
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not remove this capsule moment.", "error");
  }
}

function openMediaModal(submission, mediaUrl) {
  const modal = qs("#mediaModal");
  const stage = qs("#modalStage");
  const title = qs("#modalTitle");
  const download = qs("#modalDownload");

  lastFocusedElement = document.activeElement;
  stage.innerHTML = "";
  title.textContent = `${submission.mediaType === "video" ? "Video" : "Photo"} from ${submission.guestName || "anonymous guest"}`;
  download.href = `${submission.downloadUrl}&disposition=attachment`;
  download.download = "";

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
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
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

function updateSubmissionTabs() {
  const counts = submissions.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { pending: 0, approved: 0, rejected: 0 });

  qsa("[data-status]").forEach((tab) => {
    const isActive = tab.dataset.status === currentStatus;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  qsa("[data-count]").forEach((count) => {
    count.textContent = counts[count.dataset.count] || 0;
  });
}

function isInCapsule(submissionId) {
  return capsuleItems.some((item) => item.submissionId === submissionId);
}

function getEmptyMessage(status) {
  const messages = {
    pending: "No pending submissions. New guest moments will appear here first.",
    approved: "No approved submissions yet. Approve pending moments to build the host gallery and Time Capsule.",
    rejected: "No rejected submissions. Anything denied will stay here unless it is deleted."
  };
  return messages[status] || "No submissions in this view yet.";
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
