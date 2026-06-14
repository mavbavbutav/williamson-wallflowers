import { buildGuestUrl, copyText, formatBytes, formatDate, formatDateTime, getHostToken, getParam, isLocalHost, qs, qsa, requestJson, setNotice } from "../shared.js?v=20260605-host-token-local-1";
import { createVideoThumbnailFile } from "../video-thumbnails.js?v=20260601-video-thumbs-1";

const MAX_VIDEO_SECONDS = 30;
const MAX_AUDIO_SECONDS = 60;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "3gp", "3gpp", "3g2"];
const AUDIO_EXTENSIONS = ["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba", "webm"];

const eventId = getParam("event");
const focusSubmissionId = getParam("submission");
const token = getHostToken(eventId);
let currentStatus = "pending";
let currentView = "submissions";
let submissions = [];
let eventRecord = null;
let timeCapsule = null;
let capsuleItems = [];
let spatialLayout = null;
let spatialClusters = [];
let spatialPlacements = [];
let lastFocusedElement = null;
let localDemoHostState = null;
let pendingFocusSubmissionId = focusSubmissionId;
let focusedSubmissionId = focusSubmissionId;
const hostPostState = {
  mediaFile: null,
  thumbnailFile: null,
  mediaType: "",
  durationSeconds: 0,
  previewUrl: "",
  thumbnailPreviewUrl: "",
  isPreparing: false
};
let countdownInterval = 0;

init();

function init() {
  qs("#submissionStatusFilter").addEventListener("change", (event) => {
    currentStatus = event.target.value;
    render();
  });
  qs("#countdownForm").addEventListener("submit", saveCountdownSettings);
  qs("#countdownEnabled").addEventListener("change", applyCountdownStartDefault);
  bindDirtySaveButton(qs("#countdownForm"), "input, select, textarea", "button[type='submit']");
  qs("#partyViewSettingsForm").addEventListener("submit", savePartyViewSettings);
  bindDirtySaveButton(qs("#partyViewSettingsForm"), "input, select, textarea", "button[type='submit']");

  qsa("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      render();
    });
  });

  qs("#refreshButton").addEventListener("click", loadGallery);
  qs("#copyGuestLinkButton").addEventListener("click", copyGuestLink);
  qs("#openGuestLinkButton").addEventListener("click", openGuestLink);
  qs("#saveCapsuleButton").addEventListener("click", () => saveCapsule());
  qs("#publishCapsuleButton").addEventListener("click", () => saveCapsule("published"));
  qs("#unpublishCapsuleButton").addEventListener("click", () => saveCapsule("draft"));
  qs("#copyCapsuleLinkButton").addEventListener("click", copyCapsuleLink);
  qs("#openCapsuleLinkButton").addEventListener("click", () => {
    const url = qs("#capsuleShareUrl").value;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });
  qs("#generateSpatialLayoutButton")?.addEventListener("click", generateSpatialLayout);
  qs("#refreshSpatialLayoutButton")?.addEventListener("click", () => loadSpatialLayoutDraft().then(renderCapsule));
  qs("#publishSpatialLayoutButton")?.addEventListener("click", publishSpatialLayout);
  qsa("[data-host-post-mode]").forEach((button) => {
    button.addEventListener("click", () => chooseHostPostMode(button.dataset.hostPostMode));
  });
  qs("#hostPostFileInput").addEventListener("change", () => {
    const fileInput = qs("#hostPostFileInput");
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    acceptHostPostFile(file).catch(() => {
      hostPostState.isPreparing = false;
      setHostPostSubmitPending(false);
      setNotice(qs("#hostPostNotice"), "Could not prepare that file. Try choosing it again.", "error");
    });
  });
  qs("#hostPostForm").addEventListener("submit", createHostPost);
  qs("#clearHostPostButton").addEventListener("click", clearHostPostComposer);
  qs("#regenerateGroupHeroButton").addEventListener("click", regenerateGroupHero);
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
    applyPartyViewDefaults();
    updateCountdownState();
    qs("#eventMeta").textContent = getHostEventMetaCopy();

    if (eventRecord.timeCapsule?.enabled) {
      qs("#workspaceToolbar").hidden = false;
      await loadCapsule({ silent: true });
    } else {
      qs("#workspaceToolbar").hidden = true;
      currentView = "submissions";
      timeCapsule = null;
      capsuleItems = [];
      spatialLayout = null;
      spatialClusters = [];
      spatialPlacements = [];
    }

    applySubmissionDeepLink();
    render();
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not load this host gallery.", "error");
  }
}

function getHostEventMetaCopy() {
  const dateText = formatDate(eventRecord.eventDate);
  const destinations = [];
  if (eventRecord.autoApprovePartyViewEnabled) destinations.push("Party View");
  if (eventRecord.autoApproveTimeCapsuleEnabled) destinations.push("Time Capsule");
  if (destinations.length === 1) return `${dateText}. New guest moments auto-approve to ${destinations[0]}.`;
  if (destinations.length > 1) return `${dateText}. New guest moments auto-approve to ${destinations[0]} and ${destinations[1]}.`;
  return `${dateText}. Pending guest moments stay private until approved.`;
}

async function loadCapsule({ silent = false } = {}) {
  if (!eventRecord?.timeCapsule?.enabled) return;

  try {
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/time-capsule`);
    timeCapsule = payload.timeCapsule || null;
    capsuleItems = payload.items || [];
    await loadSpatialLayoutDraft({ silent: true });
    if (!silent) setNotice(qs("#capsuleNotice"), "Time Capsule refreshed.", "success");
  } catch (error) {
    if (!silent) setNotice(qs("#capsuleNotice"), error.message || "Could not load the Time Capsule.", "error");
  }
}

async function loadSpatialLayoutDraft({ silent = false } = {}) {
  if (!eventRecord?.timeCapsule?.enabled) return;
  try {
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/spatial-layouts/draft`);
    spatialLayout = payload.spatialLayout || null;
    spatialClusters = payload.spatialClusters || [];
    spatialPlacements = payload.spatialPlacements || [];
    if (!silent) setNotice(qs("#capsuleNotice"), "3D walk draft refreshed.", "success");
  } catch (error) {
    spatialLayout = null;
    spatialClusters = [];
    spatialPlacements = [];
    if (!silent) setNotice(qs("#capsuleNotice"), error.message || "Could not load the 3D walk draft.", "error");
  }
}

function render() {
  renderHostPulse();
  renderGuestLink();
  renderWorkspaceTabs();
  renderSubmissions();
  renderGroupHeroHostPanel();
  renderHostPosts();
  renderCapsule();
  renderShare();
  focusLinkedSubmission();
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

function renderGuestLink() {
  const card = qs("#guestLinkCard");
  if (!eventRecord) {
    card.hidden = true;
    return;
  }

  const guestLink = getGuestLink();
  const hasGuestLink = Boolean(guestLink);
  card.hidden = false;
  card.classList.toggle("is-live", hasGuestLink);
  qs("#guestLinkStatusPill").textContent = hasGuestLink ? "Ready" : "Needs tag";
  qs("#guestLinkStatusPill").className = `status-pill${hasGuestLink ? " is-approved" : ""}`;
  qs("#guestLinkTitle").textContent = hasGuestLink ? "Guest upload link" : "Guest link needs an event tag";
  qs("#guestLinkHint").textContent = hasGuestLink
    ? "Send this link to guests before the event. It opens the same guest view as the NFC or QR tag."
    : "Assign an active reusable tag to this event, then the guest upload link will appear here.";
  qs("#guestShareUrl").value = guestLink?.url || "";
  qs("#guestShareUrl").placeholder = hasGuestLink ? "" : "No active tag is assigned to this event yet.";
  qs("#guestLinkTagLabel").textContent = hasGuestLink
    ? `${guestLink.label || "Guest tag"} · ${guestLink.publicCode}`
    : "No active event tag assigned.";
  qs("#copyGuestLinkButton").disabled = !hasGuestLink;
  qs("#openGuestLinkButton").disabled = !hasGuestLink;
}

function getGuestLink() {
  const link = eventRecord?.guestLink;
  if (!link?.publicCode && !link?.url) return null;

  return {
    ...link,
    url: link.url || buildGuestUrl(link.publicCode)
  };
}

function setHostStat(name, value) {
  const element = qs(`[data-host-stat="${name}"]`);
  if (element) element.textContent = String(value);
}

function renderWorkspaceTabs() {
  const capsuleEnabled = Boolean(eventRecord?.timeCapsule?.enabled);
  const counts = getSubmissionCounts();
  if (currentView === "share") currentView = "capsule";

  const workspaceCounts = {
    submissions: counts.pending || submissions.length || 0,
    "host-posts": getPartyViewItems().length,
    capsule: capsuleItems.length
  };
  updateHostPartyViewLanguage();

  qs("#submissionsPanel").hidden = currentView !== "submissions";
  qs("#hostPostsPanel").hidden = !capsuleEnabled || currentView !== "host-posts";
  qs("#capsulePanel").hidden = !capsuleEnabled || currentView !== "capsule";

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
  updateSubmissionFilter();
  qs("#countLabel").textContent = `${visible.length} ${visible.length === 1 ? "submission" : "submissions"}`;
  qs("#emptyState").textContent = getEmptyMessage(currentStatus);
  qs("#emptyState").hidden = visible.length > 0;

  visible.forEach((submission) => {
    grid.append(renderSubmissionCard(submission));
  });
}

function applySubmissionDeepLink() {
  if (!pendingFocusSubmissionId) return;

  currentView = "submissions";
  const target = submissions.find((submission) => submission.id === pendingFocusSubmissionId);

  if (!target) {
    focusedSubmissionId = "";
    pendingFocusSubmissionId = "";
    setNotice(qs("#hostNotice"), "That submission is no longer available in this host gallery.", "error");
    return;
  }

  currentStatus = target.status || "pending";
  focusedSubmissionId = target.id;
}

function focusLinkedSubmission() {
  if (!pendingFocusSubmissionId || currentView !== "submissions") return;

  const submissionId = pendingFocusSubmissionId;
  const card = qs(`[data-submission-id="${cssEscape(submissionId)}"]`);
  if (!card) return;

  pendingFocusSubmissionId = "";
  window.requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.focus({ preventScroll: true });
  });
}

function applyCountdownDefaults() {
  if (!eventRecord) return;
  qs("#eventStartAt").value = eventRecord.eventStartAt
    ? toDatetimeLocal(eventRecord.eventStartAt)
    : (eventRecord.countdownEnabled ? getEventDateMidnightLocalValue() : "");
  qs("#countdownMessage").value = eventRecord.countdownMessage || "";
  qs("#countdownEnabled").checked = !!eventRecord.countdownEnabled;
  qs("#guestUploadsBeforeCountdownEnabled").checked = !!eventRecord.guestUploadsBeforeCountdownEnabled;
  resetDirtySaveButton(qs("#countdownForm"));
}

function applyPartyViewDefaults() {
  if (!eventRecord) return;
  qs("#partyViewSwipeEnabled").checked = !!eventRecord.partyViewSwipeEnabled;
  qs("#autoApprovePartyViewEnabled").checked = !!eventRecord.autoApprovePartyViewEnabled;
  qs("#autoApproveTimeCapsuleEnabled").checked = !!eventRecord.autoApproveTimeCapsuleEnabled;
  qs("#autoApproveTimeCapsuleEnabled").disabled = !eventRecord.timeCapsule?.enabled;
  resetDirtySaveButton(qs("#partyViewSettingsForm"));
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

function getEventDateMidnightLocalValue() {
  const eventDate = String(eventRecord?.eventDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? `${eventDate}T00:00` : "";
}

function applyCountdownStartDefault() {
  const startInput = qs("#eventStartAt");
  if (!qs("#countdownEnabled").checked || startInput.value) return;

  const defaultStart = getEventDateMidnightLocalValue();
  if (!defaultStart) return;

  startInput.value = defaultStart;
  updateDirtySaveButton(qs("#countdownForm"));
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
  card.dataset.submissionId = submission.id;
  card.tabIndex = -1;
  if (submission.id === focusedSubmissionId) {
    card.classList.add("is-focused-submission");
  }

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
    const approvalOptions = renderApprovalOptions(submission, inCapsule, inPartyView);
    if (approvalOptions) actions.append(approvalOptions);
    actions.append(actionButton("Approve", "is-success is-featured", () => approveSubmission(submission, getApprovalOptions(actions))));
  } else if (eventRecord?.timeCapsule?.enabled && !inCapsule) {
    actions.append(actionButton("Add to Time Capsule", "is-success is-featured", () => addSubmissionToCapsule(submission)));
  } else if (inCapsule) {
    const saved = document.createElement("span");
    saved.className = "decision-status";
    saved.textContent = "Already in Time Capsule";
    actions.append(saved);
  }

  if (submission.status === "approved" && submission.source !== "host") {
    const partyViewLabel = getHostPartyViewLabel();
    actions.append(actionButton(
      inPartyView ? `Hide from ${partyViewLabel}` : `Show in ${partyViewLabel}`,
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

function renderApprovalOptions(submission, inCapsule, inPartyView) {
  const group = document.createElement("div");
  group.className = "approval-options";
  group.setAttribute("aria-label", "Approval options");

  if (submission.source !== "host" && !inPartyView) {
    group.append(renderApprovalOption("party", getHostPartyViewLabel(), "Guest view"));
  }

  if (eventRecord?.timeCapsule?.enabled && !inCapsule) {
    group.append(renderApprovalOption("capsule", "Time Capsule", "Keepsake"));
  }

  return group.children.length ? group : null;
}

function renderApprovalOption(name, label, detail) {
  const option = document.createElement("label");
  option.className = "approval-option";
  option.innerHTML = `
    <input type="checkbox" data-approval-option="${name}" />
    <span>
      <strong>${escapeHtml(label)}</strong>
      <em>${escapeHtml(detail)}</em>
    </span>
  `;
  return option;
}

function getApprovalOptions(root) {
  return {
    addToCapsule: Boolean(root.querySelector('[data-approval-option="capsule"]')?.checked),
    showInPartyView: Boolean(root.querySelector('[data-approval-option="party"]')?.checked)
  };
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
  renderSpatialLayoutReview();
}

function renderSpatialLayoutReview() {
  const panel = qs("#spatialLayoutPanel");
  if (!panel) return;

  const hasDraft = Boolean(spatialLayout);
  const modeLabel = hasDraft
    ? String(spatialLayout.layoutMode || spatialLayout.layout_mode || "draft").replace(/_/g, " ")
    : "Not generated";
  qs("#spatialLayoutStatusPill").textContent = modeLabel;
  qs("#spatialLayoutStatusPill").className = `status-pill${hasDraft ? " is-approved" : ""}`;
  qs("#spatialLayoutHint").textContent = hasDraft
    ? "Review the generated adaptive clusters, then publish the 3D walk when it feels right."
    : "Generate an adaptive spatial walk from this Time Capsule's visible moments.";
  qs("#publishSpatialLayoutButton").disabled = !hasDraft;
  qs("#spatialLayoutEmpty").hidden = spatialClusters.length > 0;

  const list = qs("#spatialClusterList");
  list.innerHTML = "";
  spatialClusters.forEach((cluster) => list.append(renderSpatialClusterCard(cluster)));
}

function renderSpatialClusterCard(cluster) {
  const card = document.createElement("article");
  card.className = "spatial-cluster-card";
  const count = spatialPlacements.filter((placement) => placement.clusterId === cluster.id || placement.cluster_id === cluster.id).length;
  card.innerHTML = `
    <label>
      Cluster label
      <input data-spatial-cluster-label="${escapeAttribute(cluster.id)}" value="${escapeAttribute(cluster.label)}" />
    </label>
    <p class="muted">${escapeHtml(cluster.summary || "Arranged from the available moment data.")}</p>
    <div class="row-actions">
      <span class="status-pill">${count} ${count === 1 ? "moment" : "moments"}</span>
      <span class="status-pill">${Math.round(Number(cluster.confidenceScore ?? cluster.confidence_score ?? 0) * 100)}% confidence</span>
      <button class="small-button" type="button" data-save-spatial-cluster="${escapeAttribute(cluster.id)}">Save label</button>
    </div>
  `;
  card.querySelector("[data-save-spatial-cluster]")?.addEventListener("click", () => saveSpatialCluster(cluster.id, card));
  return card;
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

function renderGroupHeroHostPanel() {
  const card = qs("#groupHeroHostCard");
  if (!card || !eventRecord) return;

  const hero = eventRecord.groupHero || { status: "empty", participantCount: 0 };
  const status = hero.status || "empty";
  const isWorking = status === "queued" || status === "generating";
  const isReady = status === "ready" && hero.imageUrl;
  const pill = qs("#groupHeroStatusPill");
  const preview = qs("#groupHeroHostPreview");
  const meta = qs("#groupHeroHostMeta");
  const button = qs("#regenerateGroupHeroButton");

  pill.textContent = getGroupHeroStatusLabel(status);
  pill.className = `status-pill${status === "ready" ? " is-approved" : ""}${status === "failed" ? " is-rejected" : ""}`;
  button.disabled = isWorking;

  if (isReady) {
    preview.innerHTML = `<img src="${escapeHtml(hero.imageUrl)}" alt="AI cartoon group hero preview" />`;
  } else if (isWorking) {
    preview.innerHTML = `<span class="muted">Group artwork is refreshing.</span>`;
  } else if (status === "failed") {
    preview.innerHTML = `<span class="muted">Group artwork could not be generated. Try regenerating after reviewing the approved photos.</span>`;
  } else {
    preview.innerHTML = `<span class="muted">Approve AI-consented guest photos to start the group artwork.</span>`;
  }

  meta.textContent = getGroupHeroHostMeta(hero);
}

function getGroupHeroStatusLabel(status) {
  if (status === "ready") return "Ready";
  if (status === "queued") return "Queued";
  if (status === "generating") return "Generating";
  if (status === "failed") return "Needs retry";
  return "Not started";
}

function getGroupHeroHostMeta(hero) {
  const count = Number(hero?.participantCount || 0);
  const updatedAt = hero?.updatedAt ? ` Updated ${formatDateTime(hero.updatedAt)}.` : "";
  if (count === 1) return `1 approved photo is included.${updatedAt}`;
  if (count > 1) return `${count} approved photos are included.${updatedAt}`;
  return `No approved photos in the artwork yet.${updatedAt}`;
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
  hostPostState.durationSeconds = 0;
  hostPostState.isPreparing = mediaType !== "photo";
  renderHostPostPreview();

  if (mediaType === "photo") {
    setNotice(qs("#hostPostNotice"), `${getMediaTypeLabel(mediaType)} ready to post.`, "success");
    return;
  }

  setHostPostSubmitPending(true);
  setNotice(qs("#hostPostNotice"), `Checking ${getMediaTypeLabel(mediaType).toLowerCase()} length...`);

  const durationSeconds = Math.round(await readMediaDuration(file, mediaType));
  if (!isCurrentHostPostFile(file, mediaType)) return;

  hostPostState.durationSeconds = durationSeconds;
  hostPostState.isPreparing = false;
  setHostPostSubmitPending(false);

  if (mediaType === "video" && hostPostState.durationSeconds > MAX_VIDEO_SECONDS + 1) {
    hostPostState.mediaFile = null;
    hostPostState.thumbnailFile = null;
    hostPostState.durationSeconds = 0;
    setNotice(qs("#hostPostNotice"), "Host videos must be 30 seconds or shorter.", "error");
    renderHostPostPreview();
    return;
  }

  if (mediaType === "audio" && hostPostState.durationSeconds > MAX_AUDIO_SECONDS + 1) {
    hostPostState.mediaFile = null;
    hostPostState.durationSeconds = 0;
    setNotice(qs("#hostPostNotice"), "Host voice memos must be 60 seconds or shorter.", "error");
    renderHostPostPreview();
    return;
  }

  setNotice(qs("#hostPostNotice"), `${getMediaTypeLabel(mediaType)} ready to post.`, "success");

  if (mediaType === "video") {
    const thumbnailFile = await createVideoThumbnailFile(file, `wallflower-host-video-thumbnail-${Date.now()}.jpg`);
    if (!isCurrentHostPostFile(file, mediaType) || !thumbnailFile) return;
    hostPostState.thumbnailFile = thumbnailFile;
    renderHostPostPreview();
  }
}

function renderHostPostPreview() {
  const frame = qs("#hostPostPreview");
  revokeHostPostPreviewUrl();
  resetMediaFrameAspect(frame);
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
    bindMediaFrameAspect(frame, image);
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
    video.preload = "metadata";
    if (hostPostState.thumbnailFile) {
      const posterUrl = URL.createObjectURL(hostPostState.thumbnailFile);
      hostPostState.thumbnailPreviewUrl = posterUrl;
      video.poster = posterUrl;
    }
    frame.append(video);
    bindMediaFrameAspect(frame, video);
  }
}

async function createHostPost(event) {
  event.preventDefault();

  if (hostPostState.isPreparing) {
    setNotice(qs("#hostPostNotice"), "Give this file a moment to finish getting ready.", "error");
    return;
  }

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
  setNotice(qs("#hostPostNotice"), `Posting to the ${getHostPartyViewLabel()}...`);

  try {
    await hostRequest(`/host/events/${encodeURIComponent(eventId)}/posts`, {
      method: "POST",
      body: formData,
      timeoutMs: 120000
    });
    clearHostPostComposer();
    currentView = "host-posts";
    await loadGallery();
    showHostCelebration(`Host Post is live in the ${getHostPartyViewLabel()} and saved to the Time Capsule.`, qs("#hostPostNotice"));
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
  hostPostState.isPreparing = false;
  setHostPostSubmitPending(false);
  revokeHostPostPreviewUrl();
  qs("#hostPostForm").reset();
  renderHostPostPreview();
  setNotice(qs("#hostPostNotice"), "");
}

function revokeHostPostPreviewUrl() {
  if (hostPostState.previewUrl) {
    URL.revokeObjectURL(hostPostState.previewUrl);
    hostPostState.previewUrl = "";
  }
  if (hostPostState.thumbnailPreviewUrl) {
    URL.revokeObjectURL(hostPostState.thumbnailPreviewUrl);
    hostPostState.thumbnailPreviewUrl = "";
  }
}

function isCurrentHostPostFile(file, mediaType) {
  return hostPostState.mediaFile === file && hostPostState.mediaType === mediaType;
}

function setHostPostSubmitPending(isPending) {
  const button = qs("#createHostPostButton");
  if (!button) return;
  button.disabled = Boolean(isPending);
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

function readMediaDuration(file, mediaType, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (mediaType === "photo") {
      resolve(0);
      return;
    }

    const element = document.createElement(mediaType === "audio" ? "audio" : "video");
    const objectUrl = URL.createObjectURL(file);
    let timeoutId = 0;
    let settled = false;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      element.onloadedmetadata = null;
      element.onerror = null;
      URL.revokeObjectURL(objectUrl);
      element.removeAttribute("src");
      if (typeof element.load === "function") element.load();
      resolve(duration || 0);
    };

    element.preload = "metadata";
    element.onloadedmetadata = () => finish(element.duration);
    element.onerror = () => finish(0);
    timeoutId = window.setTimeout(() => finish(0), timeoutMs);
    element.src = objectUrl;
    if (typeof element.load === "function") element.load();
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
    bindMediaFrameAspect(thumb, image);
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
    bindMediaFrameAspect(thumb, video);
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

async function generateSpatialLayout() {
  try {
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/spatial-layouts/generate`, { method: "POST", body: JSON.stringify({}) });
    spatialLayout = payload.spatialLayout || null;
    spatialClusters = payload.spatialClusters || [];
    spatialPlacements = payload.spatialPlacements || [];
    renderCapsule();
    showHostCelebration("3D walk draft generated.", qs("#capsuleNotice"));
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not generate the 3D walk.", "error");
  }
}

async function publishSpatialLayout() {
  if (!spatialLayout?.id) return;
  try {
    const payload = await hostRequest(`/host/spatial-layouts/${encodeURIComponent(spatialLayout.id)}/publish`, { method: "POST", body: JSON.stringify({}) });
    spatialLayout = payload.spatialLayout || spatialLayout;
    spatialClusters = payload.spatialClusters || spatialClusters;
    spatialPlacements = payload.spatialPlacements || spatialPlacements;
    renderCapsule();
    showHostCelebration("3D walk published.", qs("#capsuleNotice"));
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not publish the 3D walk.", "error");
  }
}

async function saveSpatialCluster(clusterId, card) {
  if (!spatialLayout?.id) return;
  const label = card.querySelector(`[data-spatial-cluster-label="${cssEscape(clusterId)}"]`)?.value || "";
  try {
    const payload = await hostRequest(`/host/spatial-layouts/${encodeURIComponent(spatialLayout.id)}/clusters/${encodeURIComponent(clusterId)}`, {
      method: "PATCH",
      body: JSON.stringify({ label })
    });
    spatialClusters = payload.spatialClusters || spatialClusters.map((cluster) => (
      cluster.id === clusterId ? { ...cluster, label } : cluster
    ));
    renderCapsule();
    setNotice(qs("#capsuleNotice"), "3D walk cluster saved.", "success");
  } catch (error) {
    setNotice(qs("#capsuleNotice"), error.message || "Could not save the cluster.", "error");
  }
}

async function setSubmissionPartyView(submission, visible, { reload = true, celebrate = true, notify = true, throwOnError = false } = {}) {
  try {
    await hostRequest(`/host/submissions/${encodeURIComponent(submission.id)}/party-view`, {
      method: "PATCH",
      body: JSON.stringify({ visible })
    });
    if (reload) await loadGallery();
    if (celebrate) showHostCelebration(visible ? `Moment is now visible in the guest ${getHostPartyViewLabel()}.` : `Moment hidden from the guest ${getHostPartyViewLabel()}.`);
  } catch (error) {
    if (notify) setNotice(qs("#hostNotice"), error.message || "Could not update the guest Party View.", "error");
    if (throwOnError) throw error;
  }
}

async function regenerateGroupHero() {
  const button = qs("#regenerateGroupHeroButton");
  button.disabled = true;
  setNotice(qs("#groupHeroNotice"), "Refreshing group artwork.", "");

  try {
    const result = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/group-hero/regenerate`, {
      method: "POST"
    });
    eventRecord = {
      ...eventRecord,
      groupHero: result.groupHero || eventRecord.groupHero
    };
    setNotice(qs("#groupHeroNotice"), "Group artwork refresh started.", "success");
    render();
  } catch (error) {
    setNotice(qs("#groupHeroNotice"), error.message || "Could not refresh group artwork.", "error");
  } finally {
    renderGroupHeroHostPanel();
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

function copyGuestLink() {
  const guestLink = getGuestLink();
  if (!guestLink?.url) return;
  copyText(guestLink.url, qs("#copyGuestLinkButton"));
  showHostCelebration("Guest upload link copied.");
}

function openGuestLink() {
  const guestLink = getGuestLink();
  if (guestLink?.url) window.open(guestLink.url, "_blank", "noopener,noreferrer");
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

function bindMediaFrameAspect(frame, media) {
  if (!frame || !media) return;

  const apply = () => {
    const width = media.videoWidth || media.naturalWidth || 0;
    const height = media.videoHeight || media.naturalHeight || 0;
    if (!width || !height) return;
    const aspect = width / height;

    frame.style.setProperty("--media-aspect", `${width} / ${height}`);
    frame.classList.add("has-media-aspect");
    frame.classList.toggle("is-media-portrait", aspect < 0.92);
    frame.classList.toggle("is-media-landscape", aspect > 1.08);
    frame.classList.toggle("is-media-square", aspect >= 0.92 && aspect <= 1.08);
  };

  if (media.tagName === "VIDEO") {
    media.addEventListener("loadedmetadata", apply, { once: true });
  } else if (media.complete) {
    apply();
  } else {
    media.addEventListener("load", apply, { once: true });
  }
}

function resetMediaFrameAspect(frame) {
  if (!frame) return;
  frame.style.removeProperty("--media-aspect");
  frame.classList.remove("has-media-aspect", "is-media-portrait", "is-media-landscape", "is-media-square");
}

async function saveCountdownSettings(event) {
  event.preventDefault();
  const formElement = qs("#countdownForm");
  const submitButton = qs("#countdownForm").querySelector("button[type='submit']");

  applyCountdownStartDefault();

  if (submitButton?.dataset.hasUnsavedChanges !== "true") return;

  const form = {
    eventStartAt: datetimeLocalToIso(qs("#eventStartAt").value),
    countdownMessage: qs("#countdownMessage").value.trim(),
    countdownEnabled: qs("#countdownEnabled").checked,
    guestUploadsBeforeCountdownEnabled: qs("#guestUploadsBeforeCountdownEnabled").checked
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

async function savePartyViewSettings(event) {
  event.preventDefault();
  const formElement = qs("#partyViewSettingsForm");
  const submitButton = formElement.querySelector("button[type='submit']");

  if (submitButton?.dataset.hasUnsavedChanges !== "true") return;

  const form = {
    partyViewSwipeEnabled: qs("#partyViewSwipeEnabled").checked,
    autoApprovePartyViewEnabled: qs("#autoApprovePartyViewEnabled").checked,
    autoApproveTimeCapsuleEnabled: qs("#autoApproveTimeCapsuleEnabled").checked
  };

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalLabel = submitButton.textContent;
      submitButton.textContent = "Saving...";
    }

    setNotice(qs("#partyViewSettingsNotice"), "", "");
    const payload = await hostRequest(`/host/events/${encodeURIComponent(eventId)}/party-view-settings`, {
      method: "PATCH",
      body: JSON.stringify(form)
    });

    if (payload?.event) {
      eventRecord = payload.event;
    } else {
      eventRecord = { ...eventRecord, ...form };
    }
    applyPartyViewDefaults();
    resetDirtySaveButton(formElement);
    setNotice(qs("#partyViewSettingsNotice"), "Party View settings updated.", "success");
  } catch (error) {
    setNotice(qs("#partyViewSettingsNotice"), error.message || "Could not update Party View settings.", "error");
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

function isHostPrePartyView() {
  if (!eventRecord?.countdownEnabled || !eventRecord.eventStartAt) return false;
  const target = new Date(eventRecord.eventStartAt);
  return !Number.isNaN(target.getTime()) && target.getTime() > Date.now();
}

function getHostPartyViewLabel() {
  return isHostPrePartyView() ? "Pre-Party View" : "Party View";
}

function updateHostPartyViewLanguage() {
  const preParty = isHostPrePartyView();
  const title = getHostPartyViewLabel();
  const tabLabel = qs("#hostPostsTabLabel");
  const panelTitle = qs("#hostPostsPanelTitle");
  const panelCopy = qs("#hostPostsPanelCopy");
  const panelPill = qs("#hostPostsPanelPill");
  const feedTitle = qs("#hostPostsFeedTitle");
  const feedCopy = qs("#hostPostsFeedCopy");
  const createButton = qs("#createHostPostButton");

  if (tabLabel) tabLabel.textContent = title;
  if (panelTitle) panelTitle.textContent = preParty ? "Build the Pre-Party View" : "Post as Host";
  if (panelCopy) {
    panelCopy.textContent = preParty
      ? "Add host-only warmup moments guests can see before uploads unlock. Guest media buttons stay locked until the countdown ends."
      : "Add party updates that guests can see right away. These are approved and added to the Time Capsule automatically.";
  }
  if (panelPill) panelPill.textContent = preParty ? "Host-only before start" : "Live to guests";
  if (feedTitle) feedTitle.textContent = title;
  if (feedCopy) {
    feedCopy.textContent = preParty
      ? "What guests can see before the party starts."
      : "What guests can see from the QR link.";
  }
  if (createButton) createButton.textContent = preParty ? "Post to Pre-Party View" : "Post to Party View";
}

async function approveSubmission(submission, { addToCapsule = false, showInPartyView = false } = {}) {
  let capsuleAddFailed = false;
  let partyViewAddFailed = false;

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

    if (showInPartyView && submission.source !== "host" && !(submission.guestVisible || submission.guestVisibleAt)) {
      try {
        await setSubmissionPartyView({ ...submission, status: "approved" }, true, { reload: false, celebrate: false, notify: false, throwOnError: true });
      } catch {
        partyViewAddFailed = true;
      }
    }

    await loadGallery();
    const message = getApprovalMessage({
      addToCapsule,
      showInPartyView,
      capsuleAddFailed,
      partyViewAddFailed
    });
    if (capsuleAddFailed || partyViewAddFailed) {
      setNotice(qs("#hostNotice"), message, "error");
    } else {
      showHostCelebration(message);
    }
  } catch (error) {
    setNotice(qs("#hostNotice"), error.message || "Could not approve this submission.", "error");
  }
}

function getApprovalMessage({ addToCapsule, showInPartyView, capsuleAddFailed, partyViewAddFailed }) {
  const partyLabel = getHostPartyViewLabel();
  const failed = [];
  if (partyViewAddFailed) failed.push(partyLabel);
  if (capsuleAddFailed) failed.push("Time Capsule");

  if (failed.length) {
    return `Submission approved, but could not add it to ${formatJoinedList(failed)}.`;
  }

  if (showInPartyView && addToCapsule) {
    return `Submission approved and added to ${partyLabel} and the Time Capsule.`;
  }

  if (showInPartyView) {
    return `Submission approved and added to ${partyLabel}.`;
  }

  if (addToCapsule) {
    return "Submission approved and added to the Time Capsule.";
  }

  return "Submission approved. Another memory is saved.";
}

function formatJoinedList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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
  const localDemoPayload = getLocalDemoHostPayload(path, options);
  if (localDemoPayload) return Promise.resolve(localDemoPayload);

  return requestJson(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

function updateSubmissionFilter() {
  const counts = getSubmissionCounts();
  const labels = {
    pending: "Needs approval",
    approved: "Approved",
    rejected: "Rejected"
  };

  const filter = qs("#submissionStatusFilter");
  filter.value = currentStatus;

  qsa("#submissionStatusFilter option").forEach((option) => {
    option.textContent = `${labels[option.value] || option.value} (${counts[option.value] || 0})`;
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

function getLocalDemoHostPayload(path, options = {}) {
  if (!isLocalHost() || !eventId.startsWith("demo-") || token !== "demo-host") return null;
  localDemoHostState = localDemoHostState || createLocalDemoHostState(eventId);

  if (path.endsWith("/submissions")) {
    return {
      event: localDemoHostState.event,
      submissions: localDemoHostState.submissions
    };
  }

  if (path.endsWith("/time-capsule") && (!options.method || options.method === "GET")) {
    return {
      timeCapsule: localDemoHostState.timeCapsule,
      items: localDemoHostState.items
    };
  }

  if (path.endsWith("/spatial-layouts/draft") && (!options.method || options.method === "GET")) {
    return getLocalDemoSpatialPayload();
  }

  if (path.endsWith("/spatial-layouts/generate") && options.method === "POST") {
    createLocalDemoSpatialDraft();
    return getLocalDemoSpatialPayload();
  }

  if (/\/spatial-layouts\/[^/]+\/publish$/.test(path) && options.method === "POST") {
    if (!localDemoHostState.spatialLayout) createLocalDemoSpatialDraft();
    localDemoHostState.spatialLayout = {
      ...localDemoHostState.spatialLayout,
      status: "published",
      publishedAt: new Date().toISOString()
    };
    return getLocalDemoSpatialPayload();
  }

  const spatialClusterMatch = path.match(/\/spatial-layouts\/[^/]+\/clusters\/([^/]+)$/);
  if (spatialClusterMatch && options.method === "PATCH") {
    const form = JSON.parse(options.body || "{}");
    const clusterId = decodeURIComponent(spatialClusterMatch[1]);
    localDemoHostState.spatialClusters = (localDemoHostState.spatialClusters || []).map((cluster) => (
      cluster.id === clusterId ? { ...cluster, label: form.label ?? cluster.label } : cluster
    ));
    return getLocalDemoSpatialPayload();
  }

  if (path.endsWith("/countdown") && options.method === "PATCH") {
    const form = JSON.parse(options.body || "{}");
    localDemoHostState.event = {
      ...localDemoHostState.event,
      eventStartAt: form.eventStartAt,
      countdownMessage: form.countdownMessage,
      countdownEnabled: form.countdownEnabled,
      guestUploadsBeforeCountdownEnabled: form.guestUploadsBeforeCountdownEnabled
    };
    return { event: localDemoHostState.event };
  }

  if (path.endsWith("/party-view-settings") && options.method === "PATCH") {
    const form = JSON.parse(options.body || "{}");
    localDemoHostState.event = {
      ...localDemoHostState.event,
      partyViewSwipeEnabled: form.partyViewSwipeEnabled,
      autoApprovePartyViewEnabled: form.autoApprovePartyViewEnabled,
      autoApproveTimeCapsuleEnabled: form.autoApproveTimeCapsuleEnabled
    };
    return { event: localDemoHostState.event };
  }

  if (path.endsWith("/group-hero/regenerate") && options.method === "POST") {
    localDemoHostState.event = {
      ...localDemoHostState.event,
      groupHero: {
        status: "queued",
        imageUrl: "",
        participantCount: 1,
        updatedAt: new Date().toISOString()
      }
    };
    return { groupHero: localDemoHostState.event.groupHero };
  }

  if (path.endsWith("/posts") && options.method === "POST") {
    const item = createLocalDemoHostItem({
      id: `demo-host-${Date.now()}`,
      title: "Local host post",
      caption: "This local demo post is not saved after refresh.",
      capturedAt: new Date().toISOString()
    });
    localDemoHostState.items.unshift(item);
    return { submission: item, item };
  }

  return { ok: true };
}

function createLocalDemoHostState(id) {
  const started = id === "demo-live";
  const empty = id === "demo-empty";
  const start = new Date(Date.now() + (id === "demo-pre-party" ? 18 * 60 * 1000 : -8 * 60 * 1000));
  const eventDate = toLocalDate(start);
  const event = {
    id,
    name: id === "demo-pre-party" ? "Demo Pre-Party" : (empty ? "Demo Empty Party" : "Demo Live Party"),
    eventDate,
    eventStartAt: start.toISOString(),
    countdownEnabled: !empty,
    countdownMessage: "Party starts in",
    guestUploadsBeforeCountdownEnabled: false,
    partyViewSwipeEnabled: started,
    autoApprovePartyViewEnabled: false,
    autoApproveTimeCapsuleEnabled: false,
    guestLink: {
      label: "Demo guest link",
      publicCode: id,
      url: buildGuestUrl(id)
    },
    timeCapsule: {
      enabled: true,
      status: "draft"
    },
    groupHero: {
      status: started ? "generating" : "empty",
      imageUrl: "",
      participantCount: started ? 1 : 0,
      updatedAt: started ? new Date(Date.now() - 3 * 60 * 1000).toISOString() : ""
    }
  };
  const submissions = empty ? [] : [
    createLocalDemoSubmission({
      id: `${id}-pending-photo`,
      guestName: "Pending Guest",
      status: "pending",
      guestNote: "This is waiting for host approval."
    }),
    createLocalDemoSubmission({
      id: `${id}-approved-video`,
      guestName: "Approved Guest",
      mediaType: "photo",
      status: "approved",
      guestVisible: true,
      guestVisibleAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      guestNote: "This approved guest moment is visible in Party View."
    })
  ];
  const items = empty ? [] : [
    createLocalDemoHostItem({
      id: `${id}-host-photo`,
      title: started ? "Live party host post" : "Pre-party host post",
      caption: started ? "Guests can upload now." : "Only the host can post before the countdown ends."
    })
  ];

  return {
    event,
    submissions,
    timeCapsule: { status: "draft", shareToken: "demo-capsule-token" },
    items,
    spatialLayout: null,
    spatialClusters: [],
    spatialPlacements: []
  };
}

function getLocalDemoSpatialPayload() {
  return {
    spatialLayout: localDemoHostState.spatialLayout || null,
    spatialClusters: localDemoHostState.spatialClusters || [],
    spatialPlacements: localDemoHostState.spatialPlacements || []
  };
}

function createLocalDemoSpatialDraft() {
  const now = new Date().toISOString();
  const clusterId = `${eventId}-spatial-cluster`;
  localDemoHostState.spatialLayout = {
    id: `${eventId}-spatial-layout`,
    eventId,
    status: "draft",
    generationStatus: "ready",
    layoutMode: "visual_cluster",
    confidenceScore: 0.82,
    createdAt: now,
    updatedAt: now
  };
  localDemoHostState.spatialClusters = [{
    id: clusterId,
    layoutId: localDemoHostState.spatialLayout.id,
    label: "Story path",
    summary: "A simple adaptive walk through visible Time Capsule moments.",
    routeOrder: 1,
    confidenceScore: 0.76,
    createdAt: now,
    updatedAt: now
  }];
  localDemoHostState.spatialPlacements = (localDemoHostState.items || []).map((item, index) => ({
    id: `${eventId}-spatial-placement-${index + 1}`,
    layoutId: localDemoHostState.spatialLayout.id,
    clusterId,
    itemId: item.id,
    routeOrder: index + 1,
    createdAt: now,
    updatedAt: now
  }));
}

function createLocalDemoSubmission(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "demo-submission",
    eventId,
    guestName: "Guest",
    guestNote: "",
    status: "pending",
    source: "guest",
    mediaType: "photo",
    size: 153600,
    durationSeconds: 0,
    mediaUrl: "../../assets/williamson-wallflowers-logo.png?demo=1",
    downloadUrl: "../../assets/williamson-wallflowers-logo.png?demo=1",
    thumbnailUrl: "",
    createdAt: now,
    capturedAt: now,
    ...overrides
  };
}

function createLocalDemoHostItem(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "demo-host-item",
    eventId,
    submissionId: "",
    source: "host",
    chapter: "Host Posts",
    title: "Host post",
    caption: "",
    mediaType: "photo",
    size: 153600,
    durationSeconds: 0,
    mediaUrl: "../../assets/williamson-wallflowers-logo.png?demo=1",
    downloadUrl: "../../assets/williamson-wallflowers-logo.png?demo=1",
    thumbnailUrl: "",
    createdAt: now,
    capturedAt: now,
    ...overrides
  };
}

function toLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
