import { copyText, formatBytes, formatDate, formatDateTime, getHostToken, getParam, qs, qsa, requestJson, setNotice } from "../shared.js?v=20260531-1";

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
  mediaType: "",
  durationSeconds: 0,
  previewUrl: ""
};

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
  qs("#submissionsPanel").hidden = currentView !== "submissions";
  qs("#hostPostsPanel").hidden = !capsuleEnabled || currentView !== "host-posts";
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
      <span class="status-pill">${escapeHtml(getMediaTypeLabel(submission.mediaType))}</span>
      ${submission.source === "host" ? `<span class="status-pill">Host Post</span>` : ""}
    </div>
    <strong>${escapeHtml(submission.guestName || "Anonymous guest")}</strong>
    <p class="muted">${escapeHtml(submission.guestNote || "No note added.")}</p>
    <div class="media-meta">
      <span>${formatDateTime(submission.createdAt)}</span>
      <span>${formatBytes(submission.size)}</span>
      ${submission.mediaType === "audio" && submission.durationSeconds ? `<span>${formatDuration(submission.durationSeconds)}</span>` : ""}
    </div>
  `;

  if (shouldShowApproveCapsuleOption(submission)) {
    body.append(renderApproveCapsuleOption(submission.id));
  }

  const actions = document.createElement("div");
  actions.className = "row-actions card-actions";

  if (submission.status !== "approved") {
    actions.append(actionButton("Approve", "is-success is-featured", () => approveSubmission(submission)));
  }

  actions.append(actionButton("View", "is-primary", () => openMediaModal(submission, mediaUrl)));

  if (eventRecord?.timeCapsule?.enabled && submission.status === "approved" && !isInCapsule(submission.id)) {
    actions.append(actionButton("Add to Capsule", "is-success", () => addSubmissionToCapsule(submission)));
  }

  actions.append(renderCardMoreActions(submission, downloadUrl));
  body.append(actions);

  card.append(thumb, body);
  return card;
}

function renderCardMoreActions(submission, downloadUrl) {
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

  if (submission.status !== "rejected") {
    menu.append(actionButton("Deny", "is-danger", () => updateSubmission(submission.id, "rejected")));
  }

  menu.append(actionButton("Delete", "is-danger", () => deleteSubmission(submission.id)));
  details.append(menu);
  return details;
}

function renderApproveCapsuleOption(submissionId) {
  const label = document.createElement("label");
  label.className = "checkbox-row approve-capsule-option";
  label.innerHTML = `
    <input type="checkbox" data-approve-capsule="${escapeAttribute(submissionId)}" />
    <span>Add to Time Capsule when approved</span>
  `;
  return label;
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

  const posts = getHostPostItems();
  const grid = qs("#hostPostsGrid");
  grid.innerHTML = "";
  qs("#hostPostCount").textContent = `${posts.length} ${posts.length === 1 ? "host post" : "host posts"}`;
  qs("#hostPostsEmpty").hidden = posts.length > 0;

  posts.forEach((item) => {
    grid.append(renderHostPostCard(item));
  });
}

function renderHostPostCard(item) {
  const card = document.createElement("article");
  card.className = "media-card host-post-card";

  const mediaUrl = `${item.mediaUrl}&disposition=inline`;
  const thumb = renderThumb(item, mediaUrl);
  const body = document.createElement("div");
  body.className = "media-body";
  body.innerHTML = `
    <div class="button-row">
      <span class="status-pill">Host Post</span>
      <span class="status-pill">${escapeHtml(getMediaTypeLabel(item.mediaType))}</span>
    </div>
    <strong>${escapeHtml(item.title || "Host Post")}</strong>
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
  actions.append(actionButton("Edit in Capsule", "is-success", () => {
    currentView = "capsule";
    render();
  }));
  body.append(actions);

  card.append(thumb, body);
  return card;
}

function getHostPostItems() {
  return capsuleItems
    .filter((item) => item.source === "host" || item.chapter === "Host Posts")
    .slice()
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

async function approveSubmission(submission) {
  const addToCapsule = shouldAddToCapsuleOnApprove(submission.id);
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

function shouldShowApproveCapsuleOption(submission) {
  return Boolean(
    eventRecord?.timeCapsule?.enabled &&
    submission.status !== "approved" &&
    !isInCapsule(submission.id)
  );
}

function shouldAddToCapsuleOnApprove(submissionId) {
  return Boolean(qs(`[data-approve-capsule="${cssEscape(submissionId)}"]`)?.checked);
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
