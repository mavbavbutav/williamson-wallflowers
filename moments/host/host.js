import { copyText, formatBytes, formatDate, formatDateTime, getHostToken, getParam, qs, qsa, requestJson, setNotice } from "../shared.js?v=20260531-1";
import { createVideoThumbnailFile } from "../video-thumbnails.js?v=20260601-video-thumbs-1";

const MAX_VIDEO_SECONDS = 30;
const MAX_AUDIO_SECONDS = 60;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "3gp", "3gpp", "3g2"];
const AUDIO_EXTENSIONS = ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "webm"];

const eventId = getParam("event");
const token = getHostToken(eventId);
let currentStatus = "pending";
let currentView = "submissions";
let submissions = [];
let eventRecord = null;
let timeCapsule = null;
let capsuleItems = [];
let lastFocusedElement = null;
const hostPostState = {
  mediaFile: null,
  thumbnailFile: null,
  mediaType: "",
  durationSeconds: 0,
  previewUrl: ""
};
let countdownInterval = 0;

init();

function init() {
  qsa("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      currentStatus = button.dataset.status;
      render();
    });
  });
  qs("#countdownForm").addEventListener("submit", saveCountdownSettings);
  bindDirtySaveButton(qs("#countdownForm"), "input, select, textarea", "button[type='submit']");

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
  qs("#copyCapsuleLinkButton").addEventListener("click", copyCapsuleLink);
  qs("#openCapsuleLinkButton").addEventListener("click", () => {
    const url = qs("#capsuleShareUrl").value;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });
  qsa("[data-host-post-mode]").forEach((button) => {
    button.addEventListener("click", () => chooseHostPostMode(button.dataset.hostPostMode));
  });
  qs("#hostPostFileInput").addEventListener("change", async () => {
    const file = qs("#hostPostFileInput").files && qs("#hostPostFileInput").files[0];
    if (!file) return;
    await acceptHostPostFile(file);
    qs("#hostPostFileInput").value = "";
  });
  qs("#hostPostForm").addEventListener("submit", createHostPost);
  qs("#clearHostPostButton").addEventListener("click", clearHostPostComposer);
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
    applyCountdownDefaults();
    updateCountdownState();
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
  renderHostPulse();
  renderWorkspaceTabs();
  renderSubmissions();
  renderHostPosts();
  renderCapsule();
  renderShare();
}

function renderHostPulse() {
  const pulse = qs("#hostPulse");
  if (!eventRecord) {
    pulse.hidden = true;
    return;
  }

  const counts = getSubmissionCounts();
  const pending = counts.pending || 0;
  const approved = counts.approved || 0;
  const capsuleCount = capsuleItems.length;
  const voiceCount = submissions.filter((item) => item.mediaType === "audio").length;
  const hasCapsule = Boolean(eventRecord.timeCapsule?.enabled);

  pulse.hidden = false;
  qs("#hostPulseTitle").textContent = approved
    ? `${approved} ${approved === 1 ? "memory" : "memories"} saved so far.`
    : "Guest moments are warming up.";
  qs("#hostPulseSubtitle").textContent = pending
    ? `${pending} waiting for your yes. Pending moments stay private until approved.`
    : approved
      ? "You are caught up. New memories will land here first."
      : "Share the guest QR and watch this gallery come alive.";
  qs("#hostPulseKicker").textContent = hasCapsule
    ? (timeCapsule?.status === "published" ? "Time Capsule is live" : "Time Capsule draft")
    : "Private host gallery";

  setHostStat("pending", pending);
  setHostStat("approved", approved);
  setHostStat("capsule", hasCapsule ? capsuleCount : "Off");
  setHostStat("voice", voiceCount);
}

function setHostStat(name, value) {
  const element = qs(`[data-host-stat="${name}"]`);
  if (element) element.textContent = String(value);
}

function renderWorkspaceTabs() {
  const capsuleEnabled = Boolean(eventRecord?.timeCapsule?.enabled);
  const counts = getSubmissionCounts();
  const workspaceCounts = {
    submissions: counts.pending || submissions.length || 0,
    "host-posts": getPartyViewItems().length,
    capsule: capsuleItems.length,
    share: timeCapsule?.status === "published" ? "Live" : "Draft"
  };

  qs("#submissionsPanel").hidden = currentView !== "submissions";
  qs("#hostPostsPanel").hidden = !capsuleEnabled || currentView !== "host-posts";
  qs("#capsulePanel").hidden = !capsuleEnabled || currentView !== "capsule";
  qs("#sharePanel").hidden = !capsuleEnabled || currentView !== "share";

  qsa("[data-view]").forEach((tab) => {
    const isActive = tab.dataset.view === currentView;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  qsa("[data-workspace-count]").forEach((count) => {
    count.textContent = String(workspaceCounts[count.dataset.workspaceCount] ?? 0);
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

function applyCountdownDefaults() {
  if (!eventRecord) return;
  qs("#eventStartAt").value = toDatetimeLocal(eventRecord.eventStartAt || "");
  qs("#countdownMessage").value = eventRecord.countdownMessage || "";
  qs("#countdownEnabled").checked = !!eventRecord.countdownEnabled;
  resetDirtySaveButton(qs("#countdownForm"));
}

function updateCountdownState() {
  const preview = qs("#countdownPreview");
  const stateBadge = qs("#countdownState");
  const eventStartAt = eventRecord ? parseCountdownStart(eventRecord.eventStartAt) : null;
  const isEnabled = !!(eventRecord && eventRecord.countdownEnabled);

  stopCountdownInterval();

  if (!preview || !stateBadge) return;

  if (!isEnabled || !eventStartAt) {
    preview.hidden = true;
    stateBadge.textContent = "Off";
    stateBadge.className = "status-pill";
    return;
  }

  stateBadge.textContent = "Live";
  stateBadge.className = "status-pill is-pending";
  preview.hidden = false;

  const render = () => {
    const remaining = eventStartAt - Date.now();

    if (remaining <= 0) {
      preview.textContent = "Party is underway. Guests can share now.";
      return;
    }

    const parts = formatCountdownParts(remaining);
    preview.textContent = `${eventRecord.countdownMessage || "Party starts in"} ${parts}`;
  };

  render();
  countdownInterval = window.setInterval(render, 1000);
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offsetAdjusted = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return offsetAdjusted.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return raw;

  const [, year, month, day, hour, minute, second = "0"] = match;
  const localDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  return Number.isNaN(localDate.getTime()) ? raw : localDate.toISOString();
}

function parseCountdownStart(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function stopCountdownInterval() {
  if (countdownInterval) {
    window.clearInterval(countdownInterval);
    countdownInterval = 0;
  }
}

function formatCountdownParts(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const chunks = [];
  if (days > 0) chunks.push(`${days}d`);
  chunks.push(`${String(hours).padStart(2, "0")}h`);
  chunks.push(`${String(minutes).padStart(2, "0")}m`);
  chunks.push(`${String(seconds).padStart(2, "0")}s`);

  return chunks.join(" ");
}

function renderSubmissionCard(submission) {
  const card = document.createElement("article");
  card.className = `media-card is-status-${submission.status} is-media-${submission.mediaType}`;

  const mediaUrl = `${submission.mediaUrl}&disposition=inline`;
  const downloadUrl = `${submission.downloadUrl}&disposition=attachment`;
  const thumb = renderThumb(submission, mediaUrl);
  const inCapsule = isInCapsule(submission.id);
  const inPartyView = Boolean(submission.guestVisible || submission.guestVisibleAt);

  const body = document.createElement("div");
  body.className = "media-body";
  body.innerHTML = `
    <div class="button-row card-status-row">
      <span class="status-pill is-${submission.status}">${submission.status}</span>
      <span class="status-pill">${escapeHtml(getMediaTypeLabel(submission.mediaType))}</span>
      ${submission.source === "host" ? `<span class="status-pill">Host Post</span>` : ""}
      ${inCapsule ? `<span class="status-pill is-approved">In Time Capsule</span>` : ""}
      ${inPartyView ? `<span class="status-pill is-approved">In Guest View</span>` : ""}
    </div>
    <strong>${escapeHtml(submission.guestName || "Anonymous guest")}</strong>
    <p class="muted">${escapeHtml(submission.guestNote || "No note added.")}</p>
    <div class="media-meta">
      <span>${formatDateTime(submission.createdAt)}</span>
      <span>${formatBytes(submission.size)}</span>
      ${submission.mediaType === "audio" && submission.durationSeconds ? `<span>${formatDuration(submission.durationSeconds)}</span>` : ""}
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "host-decision-actions";

  if (submission.status !== "approved") {
    actions.append(actionButton("Approve", "is-success is-featured", () => approveSubmission(submission)));
    if (eventRecord?.timeCapsule?.enabled && !inCapsule) {
      actions.append(actionButton("Approve + Time Capsule", "is-primary is-featured", () => approveSubmission(submission, { addToCapsule: true })));
    }
  } else if (eventRecord?.timeCapsule?.enabled && !inCapsule) {
    actions.append(actionButton("Add to Time Capsule", "is-success is-featured", () => addSubmissionToCapsule(submission)));
  } else if (inCapsule) {
    const saved = document.createElement("span");
    saved.className = "decision-status";
    saved.textContent = "Already in Time Capsule";
    actions.append(saved);
  }

  if (submission.status === "approved" && submission.source !== "host") {
    actions.append(actionButton(
      inPartyView ? "Hide from Guest View" : "Show in Guest View",
      inPartyView ? "" : "is-primary is-featured",
      () => setSubmissionPartyView(submission, !inPartyView)
    ));
  }

  if (submission.status !== "rejected") {
    actions.append(actionButton("Reject", "is-danger", () => updateSubmission(submission.id, "rejected")));
  }

  actions.append(renderCardMoreActions(submission, downloadUrl, submission, mediaUrl));
  body.append(actions);

  card.append(thumb, body);
  return card;
}

function renderCardMoreActions(submission, downloadUrl, mediaItem = submission, mediaUrl = "") {
  const details = document.createElement("details");
  details.className = "card-more-actions";

  const summary = document.createElement("summary");
  summary.className = "small-button";
  summary.textContent = "More";
  details.append(summary);

  const menu = document.createElement("div");
  menu.className = "card-more-menu";

  const download = document.createElement("a");
  download.className = "small-button";
  download.href = downloadUrl;
  download.textContent = "Download";
  download.download = "";
  menu.append(download);

  menu.append(actionButton("View larger", "is-primary", () => openMediaModal(mediaItem, mediaUrl || `${submission.mediaUrl}&disposition=inline`)));

  menu.append(actionButton("Delete", "is-danger", () => deleteSubmission(submission.id)));
  details.append(menu);
  return details;
}

function renderCapsule() {
  if (!eventRecord?.timeCapsule?.enabled) return;

  qs("#capsuleTitle").value = timeCapsule?.title || eventRecord.timeCapsule.title || `${eventRecord.name} Time Capsule`;
  bindDirtySaveButton(qs(".capsule-settings"), "#capsuleTitle", "#saveCapsuleButton");
  resetDirtySaveButton(qs(".capsule-settings"));
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
  card.className = `media-card capsule-item is-media-${item.mediaType}`;
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
  const saveButton = actionButton("Save", "is-success", () => saveCapsuleItem(item.id));
  saveButton.dataset.saveCapsuleItem = "true";
  actions.append(saveButton);
  actions.append(actionButton("Remove", "is-danger", () => removeCapsuleItem(item.id)));
  body.append(actions);

  card.append(thumb, body);
  bindDirtySaveButton(card, "[data-capsule-field]", "[data-save-capsule-item]");
  return card;
}

function renderShare() {
  if (!eventRecord?.timeCapsule?.enabled) return;

  const shareUrl = timeCapsule?.shareUrl || eventRecord.timeCapsule.shareUrl || "";
  const isPublished = timeCapsule?.status === "published";
  qs("#shareCard").classList.toggle("is-live", isPublished);
  qs("#shareStatusPill").textContent = isPublished ? "Live" : "Draft";
  qs("#shareStatusPill").className = `status-pill${isPublished ? " is-approved" : ""}`;
  qs("#shareTitle").textContent = isPublished ? "Your Time Capsule is ready to share" : "Private Time Capsule link";
  qs("#shareHint").textContent = isPublished
    ? "Copy the private keepsake link and send it to the people who should relive the day."
    : "Publish the capsule when the story feels ready, then the private link appears here.";
  qs("#capsuleShareUrl").value = isPublished ? shareUrl : "";
  qs("#copyCapsuleLinkButton").disabled = !isPublished || !shareUrl;
  qs("#openCapsuleLinkButton").disabled = !isPublished || !shareUrl;
}

function renderHostPosts() {
  if (!eventRecord?.timeCapsule?.enabled) return;

  const posts = getPartyViewItems();
  const grid = qs("#hostPostsGrid");
  grid.innerHTML = "";
  qs("#hostPostCount").textContent = `${posts.length} ${posts.length === 1 ? "party moment" : "party moments"}`;
  qs("#hostPostsEmpty").hidden = posts.length > 0;

  posts.forEach((item) => {
    grid.append(renderHostPostCard(item));
  });
}

function renderHostPostCard(item) {
  const card = document.createElement("article");
  card.className = `media-card host-post-card is-status-approved is-media-${item.mediaType}`;

  const mediaUrl = `${item.mediaUrl}&disposition=inline`;
  const thumb = renderThumb(item, mediaUrl);
  const body = document.createElement("div");
  body.className = "media-body";
  body.innerHTML = `
    <div class="button-row">
      <span class="status-pill">${item.source === "host" ? "Host Post" : "Guest Moment"}</span>
      <span class="status-pill">${escapeHtml(getMediaTypeLabel(item.mediaType))}</span>
    </div>
    <strong>${escapeHtml(item.title || (item.source === "host" ? "Host Post" : "Guest moment"))}</strong>
    <p class="muted">${escapeHtml(item.caption || item.guestNote || "No caption added.")}</p>
    <div class="media-meta">
      <span>${formatDateTime(item.capturedAt || item.createdAt)}</span>
      <span>${formatBytes(item.size)}</span>
      ${item.mediaType === "audio" && item.durationSeconds ? `<span>${formatDuration(item.durationSeconds)}</span>` : ""}
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "row-actions card-actions";
  actions.append(actionButton("View", "is-primary", () => openMediaModal(item, mediaUrl)));
  if (item.source === "host" || item.chapter === "Host Posts") {
    actions.append(actionButton("Edit in Capsule", "is-success", () => {
      currentView = "capsule";
      render();
    }));
  } else if (item.submissionId) {
    actions.append(actionButton("Hide from Guest View", "", () => setSubmissionPartyView({ id: item.submissionId }, false)));
  }
  body.append(actions);

  card.append(thumb, body);
  return card;
}

function getPartyViewItems() {
  const hostPosts = capsuleItems
    .filter((item) => item.source === "host" || item.chapter === "Host Posts")
    .map((item) => ({ ...item, source: item.source || "host" }));

  const guestMoments = submissions
    .filter((item) => item.status === "approved" && item.source !== "host" && (item.guestVisible || item.guestVisibleAt))
    .map((submission) => ({
      id: `party-${submission.id}`,
      eventId: submission.eventId,
      submissionId: submission.id,
      title: submission.guestName ? `Moment from ${submission.guestName}` : "Guest moment",
      caption: submission.guestNote || "",
      chapter: "Guest moments",
      capturedAt: submission.createdAt,
      location: "",
      sortOrder: 0,
      isVisible: true,
      mediaType: submission.mediaType,
      source: submission.source || "guest",
      mimeType: submission.mimeType,
      size: submission.size,
      durationSeconds: submission.durationSeconds,
      guestName: submission.guestName,
      guestNote: submission.guestNote,
      mediaUrl: submission.mediaUrl,
      downloadUrl: submission.downloadUrl,
      thumbnailUrl: submission.thumbnailUrl,
      thumbnailUploadUrl: submission.thumbnailUploadUrl,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    }));

  return [...hostPosts, ...guestMoments]
    .sort((a, b) => new Date(b.capturedAt || b.createdAt || 0) - new Date(a.capturedAt || a.createdAt || 0));
}

function chooseHostPostMode(mode) {
  const fileInput = qs("#hostPostFileInput");
  hostPostState.mediaType = mode;
  fileInput.accept = getHostPostAcceptTypes(mode);
  fileInput.removeAttribute("capture");
  fileInput.click();
}

async function acceptHostPostFile(file) {
  const mediaType = inferHostPostMediaType(file);

  if (!mediaType) {
    setNotice(qs("#hostPostNotice"), "Choose a photo, video, or voice memo file.", "error");
    return;
  }

  hostPostState.mediaFile = file;
  hostPostState.thumbnailFile = null;
  hostPostState.mediaType = mediaType;
  hostPostState.durationSeconds = mediaType === "photo" ? 0 : Math.round(await readMediaDuration(file, mediaType));

  if (mediaType === "video" && hostPostState.durationSeconds > MAX_VIDEO_SECONDS + 1) {
    hostPostState.mediaFile = null;
    setNotice(qs("#hostPostNotice"), "Host videos must be 30 seconds or shorter.", "error");
    renderHostPostPreview();
    return;
  }

  if (mediaType === "audio" && hostPostState.durationSeconds > MAX_AUDIO_SECONDS + 1) {
    hostPostState.mediaFile = null;
    setNotice(qs("#hostPostNotice"), "Host voice memos must be 60 seconds or shorter.", "error");
    renderHostPostPreview();
    return;
  }

  if (mediaType === "video") {
    hostPostState.thumbnailFile = await createVideoThumbnailFile(file, `wallflower-host-video-thumbnail-${Date.now()}.jpg`);
  }

  renderHostPostPreview();
  setNotice(qs("#hostPostNotice"), `${getMediaTypeLabel(mediaType)} ready to post.`, "success");
}

function renderHostPostPreview() {
  const frame = qs("#hostPostPreview");
  revokeHostPostPreviewUrl();
  frame.innerHTML = "";

  if (!hostPostState.mediaFile) {
    frame.innerHTML = `<span class="muted">Choose a photo, video, or voice memo to preview it here.</span>`;
    return;
  }

  const url = URL.createObjectURL(hostPostState.mediaFile);
  hostPostState.previewUrl = url;

  if (hostPostState.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "Host post preview";
    frame.append(image);
  } else if (hostPostState.mediaType === "audio") {
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
}

async function createHostPost(event) {
  event.preventDefault();

  if (!hostPostState.mediaFile) {
    setNotice(qs("#hostPostNotice"), "Choose a photo, video, or voice memo before posting.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("media", hostPostState.mediaFile);
  formData.append("mediaType", hostPostState.mediaType);
  formData.append("durationSeconds", String(hostPostState.durationSeconds || 0));
  formData.append("title", qs("#hostPostTitle").value.trim() || "Host Post");
  formData.append("caption", qs("#hostPostCaption").value.trim());
  if (hostPostState.mediaType === "video" && hostPostState.thumbnailFile) {
    formData.append("thumbnail", hostPostState.thumbnailFile);
  }

  qs("#createHostPostButton").disabled = true;
  setNotice(qs("#hostPostNotice"), "Posting to the guest view...");

  try {
    await hostRequest(`/host/events/${encodeURIComponent(eventId)}/posts`, {
      method: "POST",
      body: formData,
      timeoutMs: 120000
    });
    clearHostPostComposer();
    currentView = "host-posts";
    await loadGallery();
    showHostCelebration("Host Post is live for guests and saved to the Time Capsule.", qs("#hostPostNotice"));
  } catch (error) {
    setNotice(qs("#hostPostNotice"), error.message || "Could not create this Host Post.", "error");
  } finally {
    qs("#createHostPostButton").disabled = false;
  }
}

function clearHostPostComposer() {
  hostPostState.mediaFile = null;
  hostPostState.thumbnailFile = null;
  hostPostState.mediaType = "";
  hostPostState.durationSeconds = 0;
  revokeHostPostPreviewUrl();
  qs("#hostPostForm").reset();
  renderHostPostPreview();
  setNotice(qs("#hostPostNotice"), "");
}

function revokeHostPostPreviewUrl() {
  if (!hostPostState.previewUrl) return;
  URL.revokeObjectURL(hostPostState.previewUrl);
  hostPostState.previewUrl = "";
}

function inferHostPostMediaType(file) {
  const baseMimeType = getBaseMimeType(file.type);
  const extension = getFileExtension(file.name);

  if (baseMimeType.startsWith("image/")) return "photo";
  if (baseMimeType.startsWith("audio/") || AUDIO_EXTENSIONS.includes(extension)) return "audio";
  if (baseMimeType.startsWith("video/") || VIDEO_EXTENSIONS.includes(extension)) return "video";
  return "";
}

function getHostPostAcceptTypes(mode) {
  if (mode === "photo") return "image/*";
  if (mode === "audio") return "audio/*,.m4a,.mp3,.wav,.ogg,.oga,.opus,.aac,.webm,.weba";
  return "video/*,.mp4,.mov,.m4v,.webm,.3gp,.3gpp,.3g2";
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
    if (mediaType === "photo") {
      resolve(0);
      return;
    }

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

function renderThumb(item, mediaUrl) {
  const thumb = document.createElement("div");
  thumb.className = `media-thumb is-${item.mediaType}`;

  if (item.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = item.guestName ? `Photo from ${item.guestName}` : "Guest photo";
    thumb.append(image);
  } else if (item.mediaType === "audio") {
    renderVoiceMemoThumb(thumb, item, mediaUrl);
  } else {
    const video = document.createElement("video");
    video.src = mediaUrl;
    if (item.thumbnailUrl) video.poster = item.thumbnailUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    thumb.append(video);
  }

  return thumb;
}

function renderVoiceMemoThumb(thumb, item, mediaUrl) {
  const panel = document.createElement("div");
  panel.className = "voice-memo-panel";
  panel.setAttribute("aria-label", "Voice memo audio");

  const header = document.createElement("div");
  header.className = "voice-memo-header";

  const copy = document.createElement("div");
  copy.className = "voice-memo-copy";

  const kicker = document.createElement("span");
  kicker.className = "voice-memo-kicker";
  kicker.textContent = "Audio only";

  const title = document.createElement("strong");
  title.textContent = "Voice Memo";

  const detail = document.createElement("span");
  detail.className = "voice-memo-detail";
  detail.textContent = item.durationSeconds ? formatDuration(item.durationSeconds) : "Tap play to listen";

  copy.append(kicker, title, detail);
  header.append(copy);

  const waveform = document.createElement("div");
  waveform.className = "voice-waveform";
  waveform.setAttribute("aria-hidden", "true");
  [34, 62, 48, 78, 42, 90, 56, 70, 38, 82, 50, 66].forEach((height) => {
    const bar = document.createElement("span");
    bar.style.setProperty("--bar-height", `${height}%`);
    waveform.append(bar);
  });

  const audio = document.createElement("audio");
  audio.src = mediaUrl;
  audio.controls = true;
  audio.preload = "metadata";

  panel.append(header, waveform, audio);
  thumb.append(panel);
}

async function addSubmissionToCapsule(submission) {
  try {
    const result = await createCapsuleItem(submission);
    capsuleItems = [...capsuleItems, result.item].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    currentView = "capsule";
    showHostCelebration("Moment added to the Time Capsule.", qs("#capsuleNotice"));
    render();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not add this moment to the Time Capsule.", "error");
  }
}

function createCapsuleItem(submission) {
  return hostRequest(`/host/events/${encodeURIComponent(eventId)}/time-capsule/items`, {
    method: "POST",
    body: JSON.stringify({
      submissionId: submission.id,
      title: submission.guestName ? `Moment from ${submission.guestName}` : "Guest moment",
      caption: submission.guestNote || "",
      chapter: "Guest moments"
    })
  });
}

async function setSubmissionPartyView(submission, visible) {
  try {
    await hostRequest(`/host/submissions/${encodeURIComponent(submission.id)}/party-view`, {
      method: "PATCH",
      body: JSON.stringify({ visible })
    });
    await loadGallery();
    showHostCelebration(visible ? "Moment is now visible in the guest Party View." : "Moment hidden from the guest Party View.");
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not update the guest Party View.", "error");
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
    if (status === "published") {
      showHostCelebration("Time Capsule published. Your private keepsake link is ready.", qs("#capsuleNotice"));
    } else {
      setNotice(qs("#capsuleNotice"), "Time Capsule saved.", "success");
    }
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
    showHostCelebration("Capsule moment saved.", qs("#capsuleNotice"));
    render();
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not save this capsule moment.", "error");
  }
}

function copyCapsuleLink() {
  copyText(qs("#capsuleShareUrl").value, qs("#copyCapsuleLinkButton"));
  showHostCelebration("Private Time Capsule link copied.");
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
  title.textContent = `${getMediaTypeLabel(submission.mediaType)} from ${submission.guestName || "anonymous guest"}`;
  download.href = `${submission.downloadUrl}&disposition=attachment`;
  download.download = "";

  if (submission.mediaType === "photo") {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = submission.guestName ? `Photo from ${submission.guestName}` : "Guest photo";
    stage.append(image);
  } else if (submission.mediaType === "audio") {
    const audio = document.createElement("audio");
    audio.src = mediaUrl;
    audio.controls = true;
    audio.preload = "metadata";
    stage.append(audio);
  } else {
    const video = document.createElement("video");
    video.src = mediaUrl;
    if (submission.thumbnailUrl) video.poster = submission.thumbnailUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    stage.append(video);
  }

  document.body.classList.add("modal-open");
  modal.hidden = false;
  qs("#modalClose").focus();
}

async function saveCountdownSettings(event) {
  event.preventDefault();
  const formElement = qs("#countdownForm");
  const submitButton = qs("#countdownForm").querySelector("button[type='submit']");

  if (submitButton?.dataset.hasUnsavedChanges !== "true") return;

  const form = {
    eventStartAt: datetimeLocalToIso(qs("#eventStartAt").value),
    countdownMessage: qs("#countdownMessage").value.trim(),
    countdownEnabled: qs("#countdownEnabled").checked
  };

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalLabel = submitButton.textContent;
      submitButton.textContent = "Saving...";
    }

    setNotice(qs("#hostNotice"), "", "");
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/countdown`, {
      method: "PATCH",
      body: JSON.stringify(form)
    });

    if (payload?.event) {
      eventRecord = payload.event;
    } else {
      await loadGallery();
    }
    applyCountdownDefaults();
    updateCountdownState();
    resetDirtySaveButton(formElement);
    setNotice(qs("#hostNotice"), "Countdown settings updated.", "success");
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not update countdown settings.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      updateDirtySaveButton(formElement);
    }
  }
}

function closeMediaModal() {
  const modal = qs("#mediaModal");
  const stage = qs("#modalStage");

  qsa("video, audio", stage).forEach((media) => media.pause());
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

async function approveSubmission(submission, { addToCapsule = false } = {}) {
  let capsuleAddFailed = false;

  try {
    await hostRequest(`/host/submissions/${encodeURIComponent(submission.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" })
    });

    if (addToCapsule && eventRecord?.timeCapsule?.enabled && !isInCapsule(submission.id)) {
      try {
        await createCapsuleItem({ ...submission, status: "approved" });
      } catch {
        capsuleAddFailed = true;
      }
    }

    await loadGallery();
    const message = capsuleAddFailed
      ? "Submission approved, but could not add it to the Time Capsule. Add it later from the Approved tab."
      : addToCapsule
        ? "Submission approved and added to the Time Capsule."
        : "Submission approved. Another memory is saved.";
    if (capsuleAddFailed) {
      setNotice(qs("#hostNotice"), message, "error");
    } else {
      showHostCelebration(message);
    }
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not approve this submission.", "error");
  }
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
  const counts = getSubmissionCounts();

  qsa("[data-status]").forEach((tab) => {
    const isActive = tab.dataset.status === currentStatus;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  qsa("[data-count]").forEach((count) => {
    count.textContent = counts[count.dataset.count] || 0;
  });
}

function getSubmissionCounts() {
  return submissions.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { pending: 0, approved: 0, rejected: 0 });
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

function showHostCelebration(message, notice = qs("#hostNotice")) {
  setNotice(notice, message, "success");

  const burst = document.createElement("div");
  burst.className = "host-celebration";
  burst.setAttribute("aria-hidden", "true");
  [0, 1, 2, 3, 4, 5].forEach((index) => {
    const petal = document.createElement("span");
    petal.style.setProperty("--petal-index", String(index));
    burst.append(petal);
  });
  document.body.append(burst);
  window.setTimeout(() => burst.remove(), 1200);
}

function bindDirtySaveButton(root, fieldSelector, buttonSelector) {
  if (!root || root.dataset.dirtyTrackerBound === "true") return;

  const button = root.querySelector(buttonSelector);
  const fields = Array.from(root.querySelectorAll(fieldSelector));
  if (!button || fields.length === 0) return;

  root.dataset.dirtyTrackerBound = "true";
  root.dataset.dirtyFieldSelector = fieldSelector;
  root.dataset.dirtyButtonSelector = buttonSelector;
  button.dataset.cleanLabel = button.dataset.cleanLabel || button.textContent.trim();
  button.dataset.dirtyLabel = button.dataset.dirtyLabel || "Save changes";
  root.dataset.cleanSnapshot = getDirtySnapshot(fields);
  updateDirtySaveButton(root);

  fields.forEach((field) => {
    field.addEventListener("input", () => updateDirtySaveButton(root));
    field.addEventListener("change", () => updateDirtySaveButton(root));
  });
}

function resetDirtySaveButton(root) {
  if (!root?.dataset.dirtyTrackerBound) return;
  const fields = Array.from(root.querySelectorAll(root.dataset.dirtyFieldSelector));
  root.dataset.cleanSnapshot = getDirtySnapshot(fields);
  updateDirtySaveButton(root);
}

function updateDirtySaveButton(root) {
  if (!root?.dataset.dirtyTrackerBound) return;
  const fields = Array.from(root.querySelectorAll(root.dataset.dirtyFieldSelector));
  const button = root.querySelector(root.dataset.dirtyButtonSelector);
  if (!button || button.disabled) return;

  const isDirty = getDirtySnapshot(fields) !== root.dataset.cleanSnapshot;
  button.classList.toggle("is-dirty", isDirty);
  button.hidden = !isDirty;
  button.dataset.hasUnsavedChanges = String(isDirty);
  button.textContent = isDirty ? button.dataset.dirtyLabel : button.dataset.cleanLabel;
}

function getDirtySnapshot(fields) {
  return JSON.stringify(fields.map((field) => {
    if (field.type === "checkbox") return field.checked;
    return field.value;
  }));
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
