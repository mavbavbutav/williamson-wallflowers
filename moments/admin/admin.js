import {
  buildGuestUrl,
  buildHostUrl,
  clearAdminToken,
  copyText,
  formatDate,
  formatDateTime,
  getAdminToken,
  getPublishedCapsuleShareUrl,
  qs,
  requestJson,
  setAdminToken,
  setNotice
} from "../shared.js?v=20260531-3";

let adminToken = getAdminToken();
let events = [];
let tags = [];
let wallDevices = [];
let mediaAuditEventId = "";
let mediaAudit = null;

init();

function init() {
  qs("#authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    adminToken = qs("#adminToken").value.trim();
    setAdminToken(adminToken);
    loadAdmin();
  });

  qs("#refreshButton").addEventListener("click", loadAdmin);
  qs("#cleanupButton").addEventListener("click", runCleanup);
  qs("#signOutButton").addEventListener("click", signOut);
  qs("#eventForm").addEventListener("submit", createEvent);
  qs("#eventEditForm").addEventListener("submit", updateSelectedEventDetails);
  qs("#editEventSelect").addEventListener("change", () => populateEventEditForm(qs("#editEventSelect").value));
  qs("#mediaAuditEventSelect").addEventListener("change", () => loadMediaAudit(qs("#mediaAuditEventSelect").value));
  qs("#mediaAuditRefreshButton").addEventListener("click", () => loadMediaAudit(qs("#mediaAuditEventSelect").value));
  qs("#mediaAuditBackfillButton").addEventListener("click", () => runMediaAuditBackfill(false));
  qs("#mediaAuditAiBackfillButton").addEventListener("click", () => runMediaAuditBackfill(true));
  qs("#mediaAuditFaceBoxesToggle").addEventListener("change", renderMediaAudit);
  qs("#tagForm").addEventListener("submit", createTag);
  qs("#assignTagForm").addEventListener("submit", assignTag);
  qs("#wallDeviceForm").addEventListener("submit", createWallDevice);
  qs("#generateTagCodeButton").addEventListener("click", generateTagCode);
  qs("#copyBridgeConfigButton").addEventListener("click", () => copyText(qs("#bridgeConfigText").textContent, qs("#copyBridgeConfigButton")));
  bindScrollActions();

  if (adminToken) {
    qs("#adminToken").value = adminToken;
    loadAdmin();
  }
}

async function loadAdmin() {
  try {
    setNotice(qs("#authNotice"), "");
    setNotice(qs("#adminNotice"), "");
    const payload = await adminRequest("/admin/overview");
    events = payload.events || [];
    tags = payload.tags || [];
    wallDevices = payload.wallDevices || [];
    const shouldFocusTitle = qs("#adminApp").hidden;
    qs("#authPanel").hidden = true;
    qs("#adminApp").hidden = false;
    renderStats(payload.stats || {});
    renderAttention();
    renderGuide();
    renderAssignTagForm();
    renderEvents();
    renderEventEditForm();
    renderTags();
    renderWallDeviceForm();
    renderWallDevices();
    renderMediaAuditForm();
    await loadMediaAudit(mediaAuditEventId || qs("#mediaAuditEventSelect").value, { quiet: true });
    if (shouldFocusTitle) focusElement(qs("#adminTitle"));
  } catch (error) {
    qs("#authPanel").hidden = false;
    qs("#adminApp").hidden = true;
    setNotice(qs("#authNotice"), error.message || "Could not open admin.", "error");
  }
}

async function createEvent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  const body = Object.fromEntries(formData.entries());
  const eventName = body.name || "Event";

  try {
    setButtonBusy(submitButton, true, "Creating event...");
    const result = await adminRequest("/admin/events", {
      method: "POST",
      body: JSON.stringify(body)
    });
    form.reset();
    await loadAdmin();
    showAdminNotice(`Event "${result.event?.name || eventName}" was created. Next: assign an NTAG to this event, then copy that tag's guest link into NFC Tools.`, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not create event.", "error");
  } finally {
    setButtonBusy(submitButton, false);
  }
}

async function createTag(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  const body = Object.fromEntries(formData.entries());
  const tagLabel = body.label || "NTAG";

  try {
    setButtonBusy(submitButton, true, "Registering tag...");
    const result = await adminRequest("/admin/tags", {
      method: "POST",
      body: JSON.stringify(body)
    });
    form.reset();
    await loadAdmin();
    showAdminNotice(`Tag "${result.tag?.label || tagLabel}" was registered. Next: assign it to an event, click Save, then copy its guest link into NFC Tools.`, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not register tag.", "error");
  } finally {
    setButtonBusy(submitButton, false);
  }
}

async function assignTag(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  const tagId = formData.get("tagId");
  const activeEventId = formData.get("eventId");

  if (!tagId || !activeEventId) {
    showAdminNotice("Choose a tag and an event before assigning.", "error");
    return;
  }

  const tag = tags.find((item) => item.id === tagId);
  const targetEvent = events.find((item) => item.id === activeEventId);

  try {
    setButtonBusy(submitButton, true, "Assigning tag...");
    await updateTag(
      tagId,
      { status: "active", activeEventId },
      `Tag "${tag?.label || "NTAG"}" was assigned to "${targetEvent?.name || "the event"}". Copy the guest link from Reusable tags when you are ready to write the NTAG.`
    );
  } catch (error) {
    showAdminNotice(error.message || "Could not assign tag.", "error");
  } finally {
    setButtonBusy(submitButton, false);
  }
}

async function createWallDevice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  const body = Object.fromEntries(formData.entries());

  try {
    setButtonBusy(submitButton, true, "Registering device...");
    const result = await adminRequest("/admin/wall-devices", {
      method: "POST",
      body: JSON.stringify(body)
    });
    form.reset();
    qs("#scanPresetId").value = "2";
    qs("#submissionPresetId").value = "3";
    qs("#manualPresetId").value = "4";
    qs("#deviceBrightness").value = "180";
    await loadAdmin();
    showBridgeConfig(result.bridgeConfig);
    showAdminNotice(`Wall device "${result.wallDevice?.name || body.name || "Butterfly Wall"}" was registered. Copy the bridge config before leaving this page.`, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not register wall device.", "error");
  } finally {
    setButtonBusy(submitButton, false);
  }
}

function showAdminNotice(message, type = "") {
  const notice = qs("#adminNotice");
  setNotice(notice, message, type);
  if (!notice.hidden) {
    notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function setButtonBusy(button, isBusy, label = "Working...") {
  if (!button) return;

  if (isBusy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return;
  }

  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
  delete button.dataset.originalLabel;
}

function renderStats(stats) {
  const values = [
    ["Events", stats.events || 0, "events"],
    ["Tags", stats.tags || 0, "tags"],
    ["Lights", stats.wallDevices || 0, "lights"],
    ["Light queue", stats.pendingLightTriggers || 0, "pending"],
    ["Pending", stats.pending || 0, "pending"],
    ["Approved", stats.approved || 0, "approved"]
  ];

  qs("#statsGrid").innerHTML = values.map(([label, value, key]) => `
    <div class="stat is-${key}">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderAttention() {
  const items = buildAttentionItems();
  qs("#attentionCountLabel").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  qs("#attentionList").innerHTML = items.length ? items.map(renderAttentionItem).join("") : `
    <div class="empty-state attention-empty">
      <strong>Nothing needs immediate attention.</strong>
      <span>Events, tags, and private links are ready for normal setup work.</span>
    </div>
  `;
  bindAttentionActions();
}

function buildAttentionItems() {
  const assignedActiveEventIds = new Set(tags.filter((tag) => tag.status === "active" && tag.activeEventId).map((tag) => tag.activeEventId));
  const items = [];

  events.forEach((event) => {
    const hostUrl = buildHostUrl(event.id, event.hostToken);
    if (Number(event.pendingCount || 0) > 0) {
      items.push({
        tone: "pending",
        title: `${event.pendingCount} pending ${Number(event.pendingCount) === 1 ? "moment" : "moments"}`,
        body: `${event.name} has guest submissions waiting for host review.`,
        actions: [
          { label: "Open host", url: hostUrl },
          { label: "Copy host link", copy: hostUrl }
        ]
      });
    }

    if (event.status === "active" && !assignedActiveEventIds.has(event.id)) {
      items.push({
        tone: "setup",
        title: "Missing active tag",
        body: `${event.name} does not have an active NTAG assigned.`,
        actions: [
          { label: "Assign tag", scrollTarget: "#assignTagForm" }
        ]
      });
    }

    if (event.timeCapsuleEnabled && event.timeCapsuleStatus !== "published") {
      items.push({
        tone: "capsule",
        title: "Capsule draft",
        body: `${event.name} has Time Capsule enabled but not published.`,
        actions: [
          { label: "Open host", url: hostUrl },
          { label: "Copy host link", copy: hostUrl }
        ]
      });
    }
  });

  tags.filter((tag) => tag.status === "active" && !tag.activeEventId).forEach((tag) => {
    items.push({
      tone: "setup",
      title: "Unassigned active tag",
      body: `${tag.label} is active but not assigned to an event.`,
      actions: [
        { label: "Assign tag", scrollTarget: "#assignTagForm" }
      ]
    });
  });

  return items.slice(0, 6);
}

function renderAttentionItem(item) {
  return `
    <article class="attention-item is-${escapeAttribute(item.tone)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.body)}</p>
      </div>
      <div class="row-actions">
        ${item.actions.map(renderAttentionAction).join("")}
      </div>
    </article>
  `;
}

function renderAttentionAction(action) {
  if (action.url) {
    return `<button class="small-button" type="button" data-open="${encodeURIComponent(action.url)}">${escapeHtml(action.label)}</button>`;
  }
  if (action.copy) {
    return `<button class="small-button" type="button" data-copy="${encodeURIComponent(action.copy)}">${escapeHtml(action.label)}</button>`;
  }
  return `<button class="small-button" type="button" data-scroll-target="${escapeAttribute(action.scrollTarget)}">${escapeHtml(action.label)}</button>`;
}

function renderTags() {
  qs("#tagsCountLabel").textContent = `${tags.length} ${tags.length === 1 ? "tag" : "tags"}`;

  const rows = tags.map((tag) => {
    const assignedOptions = buildEventOptions(tag.activeEventId);
    const guestUrl = buildGuestUrl(tag.publicCode);

    return `
      <tr data-tag-id="${tag.id}">
        <td>
          <strong>${escapeHtml(tag.label)}</strong><br />
          <span class="muted">${escapeHtml(tag.publicCode)}</span>
        </td>
        <td>
          <select data-tag-status>
            <option value="active"${tag.status === "active" ? " selected" : ""}>Active</option>
            <option value="inactive"${tag.status === "inactive" ? " selected" : ""}>Inactive</option>
          </select>
        </td>
        <td><select data-tag-event>${assignedOptions}</select></td>
        <td>
          ${renderLinkActions([
            { label: "Guest scan", summary: "Guest upload link", copyLabel: "Copy guest link", openLabel: "Open guest", url: guestUrl }
          ])}
        </td>
        <td>
          <div class="row-actions">
            <button class="small-button" type="button" data-save-tag>Save</button>
            <button class="small-button is-danger" type="button" data-delete-tag data-tag-label="${escapeAttribute(tag.label)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const cards = tags.map((tag) => renderTagCard(tag)).join("");

  qs("#tagsTable").innerHTML = rows || `<tr><td colspan="5">No tags registered yet.</td></tr>`;
  qs("#tagsCards").innerHTML = cards || `<div class="empty-state">No tags registered yet.</div>`;
  bindTagActions();
}

function renderAssignTagForm() {
  const form = qs("#assignTagForm");
  const tagSelect = qs("#assignTagSelect");
  const eventSelect = qs("#assignEventSelect");
  const submitButton = form.querySelector("button[type='submit']");
  const activeEvents = events.filter((event) => event.status === "active");

  tagSelect.innerHTML = tags.length
    ? tags.map((tag) => `<option value="${escapeAttribute(tag.id)}">${escapeHtml(`${tag.label} (${tag.publicCode})`)}</option>`).join("")
    : `<option value="">No tags registered</option>`;

  eventSelect.innerHTML = activeEvents.length
    ? activeEvents.map((event) => `<option value="${escapeAttribute(event.id)}">${escapeHtml(event.name)}</option>`).join("")
    : `<option value="">No active events</option>`;

  const canAssign = tags.length > 0 && activeEvents.length > 0;
  tagSelect.disabled = !canAssign;
  eventSelect.disabled = !canAssign;
  submitButton.disabled = !canAssign;
  qs("#assignTagHelp").textContent = canAssign
    ? "Choose a tag and event, then copy the guest link from Reusable tags when you are ready to write the NTAG."
    : "Create an event and register a tag before assigning.";
}

function renderWallDeviceForm() {
  const select = qs("#wallDeviceEvent");
  if (!select) return;
  select.innerHTML = buildEventOptions("");
}

function renderWallDevices() {
  const countLabel = qs("#devicesCountLabel");
  if (countLabel) {
    countLabel.textContent = `${wallDevices.length} ${wallDevices.length === 1 ? "device" : "devices"}`;
  }

  const rows = wallDevices.map((device) => `
    <tr data-device-id="${escapeAttribute(device.id)}">
      <td>
        <strong>${escapeHtml(device.name)}</strong><br />
        <span class="muted">${escapeHtml(device.eventName || "Unassigned event")}</span>
      </td>
      <td>
        <select data-device-status>
          <option value="active"${device.status === "active" ? " selected" : ""}>Active</option>
          <option value="inactive"${device.status === "inactive" ? " selected" : ""}>Inactive</option>
        </select>
      </td>
      <td>${renderPresetInputs(device)}</td>
      <td>
        <span class="muted">${device.lastSeenAt ? `Last seen ${formatDateTime(device.lastSeenAt)}` : "Bridge not seen yet"}</span><br />
        <span class="status-pill is-pending">${device.pendingTriggerCount || 0} pending</span>
        <span class="status-pill">${device.failedTriggerCount || 0} failed</span>
      </td>
      <td>${renderDeviceActions()}</td>
    </tr>
  `).join("");

  const cards = wallDevices.map(renderWallDeviceCard).join("");

  qs("#devicesTable").innerHTML = rows || `<tr><td colspan="5">No wall devices registered yet.</td></tr>`;
  qs("#devicesCards").innerHTML = cards || `<div class="empty-state">No wall devices registered yet.</div>`;
  bindWallDeviceActions();
}

function renderEvents() {
  qs("#eventsCountLabel").textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;

  const operationalEvents = getOperationalEvents();
  const rows = operationalEvents.map((event) => {
    const hostUrl = buildHostUrl(event.id, event.hostToken);
    const capsuleUrl = getPublishedCapsuleShareUrl(event);
    const statusButton = event.status === "active" ? "Deactivate" : "Activate";
    const nextStatus = event.status === "active" ? "inactive" : "active";
    const capsuleStatus = event.timeCapsuleEnabled ? (event.timeCapsuleStatus || "draft") : "not added";
    const linkActions = buildEventLinkActions(event, hostUrl, capsuleUrl);

    return `
      <tr data-event-id="${event.id}">
        <td>
          <strong>${escapeHtml(event.name)}</strong><br />
          <span class="muted">${formatDate(event.eventDate)} | expires ${formatDate(event.retentionExpiresAt?.slice(0, 10))}</span>
        </td>
        <td>
          ${renderLinkActions(linkActions)}
        </td>
        <td>
          <span class="status-pill is-pending">${event.pendingCount || 0} pending</span>
          <span class="status-pill is-approved">${event.approvedCount || 0} approved</span>
          <span class="status-pill">${escapeHtml(`Capsule ${capsuleStatus}`)}</span>
        </td>
        <td><span class="status-pill">${event.status}</span></td>
        <td>
          <div class="row-actions">
            <button class="small-button" type="button" data-edit-event>Edit details</button>
            <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
            ${renderMoreActions(event)}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const cards = operationalEvents.map((event) => renderEventCard(event)).join("");

  qs("#eventsTable").innerHTML = rows || `<tr><td colspan="5">No events created yet.</td></tr>`;
  qs("#eventsCards").innerHTML = cards || `<div class="empty-state">No events created yet.</div>`;
  bindEventActions();
}

function renderMediaAuditForm() {
  const select = qs("#mediaAuditEventSelect");
  const hasEvents = events.length > 0;
  const nextEventId = events.some((event) => event.id === mediaAuditEventId)
    ? mediaAuditEventId
    : events[0]?.id || "";
  mediaAuditEventId = nextEventId;
  select.innerHTML = hasEvents
    ? events.map((event) => `<option value="${escapeAttribute(event.id)}">${escapeHtml(event.name)}</option>`).join("")
    : `<option value="">No events created</option>`;
  select.value = nextEventId;
  select.disabled = !hasEvents;
  qs("#mediaAuditRefreshButton").disabled = !hasEvents;
  qs("#mediaAuditBackfillButton").disabled = !hasEvents;
  qs("#mediaAuditAiBackfillButton").disabled = !hasEvents;

  if (!hasEvents) {
    mediaAudit = null;
    renderMediaAudit();
  }
}

async function loadMediaAudit(eventId, { quiet = false } = {}) {
  if (!eventId) {
    mediaAudit = null;
    renderMediaAudit();
    return;
  }

  mediaAuditEventId = eventId;
  qs("#mediaAuditStatusLabel").textContent = quiet ? "Loading" : "Refreshing";

  try {
    const result = await adminRequest(`/admin/events/${encodeURIComponent(eventId)}/media-audit`);
    mediaAudit = result.audit || null;
    renderMediaAudit();
  } catch (error) {
    mediaAudit = null;
    renderMediaAudit(error.message || "Could not load media audit.");
    if (!quiet) showAdminNotice(error.message || "Could not load media audit.", "error");
  }
}

async function runMediaAuditBackfill(includeAi) {
  const eventId = qs("#mediaAuditEventSelect").value;
  if (!eventId) {
    showAdminNotice("Choose an event before running media audit.", "error");
    return;
  }

  const button = includeAi ? qs("#mediaAuditAiBackfillButton") : qs("#mediaAuditBackfillButton");
  try {
    setButtonBusy(button, true, includeAi ? "Queuing AI..." : "Queuing audit...");
    const result = await adminRequest(`/admin/events/${encodeURIComponent(eventId)}/media-audit/backfill`, {
      method: "POST",
      body: JSON.stringify({
        limit: 25,
        includeAi,
        retryFailed: includeAi
      })
    });
    showAdminNotice(`${includeAi ? "AI vision audit" : "Media audit"} queued ${result.queued || 0} of ${result.pending || 0} pending items.`, "success");
    await loadMediaAudit(eventId, { quiet: true });
    window.setTimeout(() => loadMediaAudit(eventId, { quiet: true }), 2200);
  } catch (error) {
    showAdminNotice(error.message || "Could not run media audit.", "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function renderMediaAudit(errorMessage = "") {
  const profile = mediaAudit?.profile || {};
  const insights = mediaAudit?.insights || [];
  const pending = Number(mediaAudit?.pending || 0);
  const faceDedupe = mediaAudit?.faceDedupe || {};
  const showFaceBoxes = Boolean(qs("#mediaAuditFaceBoxesToggle")?.checked);

  qs("#mediaAuditPanel")?.classList.toggle("is-showing-face-boxes", showFaceBoxes);

  qs("#mediaAuditStatusLabel").textContent = errorMessage
    ? "Error"
    : profile.status
    ? `${profile.status}${pending ? ` | ${pending} pending` : ""}`
    : "No report";

  qs("#mediaAuditSummary").innerHTML = errorMessage
    ? `<div class="empty-state is-compact"><strong>Report unavailable.</strong><span>${escapeHtml(errorMessage)}</span></div>`
    : `<div class="empty-state is-compact"><strong>${escapeHtml(profile.profileSummary || "No approved visual media has been audited yet.")}</strong><span>${escapeHtml(buildMediaAuditSubtext(profile, pending))}</span></div>`;

  qs("#mediaAuditStats").innerHTML = renderMediaAuditStats(profile, pending);
  qs("#mediaAuditFaceSummary").innerHTML = errorMessage ? "" : renderMediaAuditFaceSummary(faceDedupe);
  qs("#mediaAuditTags").innerHTML = renderMediaAuditTagGroups(profile);
  qs("#mediaAuditInsights").innerHTML = insights.length
    ? insights.map(renderMediaAuditInsightRow).join("")
    : `<tr><td colspan="4">No audited media yet. Run the audit for this event.</td></tr>`;
  qs("#mediaAuditCards").innerHTML = insights.length
    ? insights.map(renderMediaAuditCard).join("")
    : `<div class="empty-state">No audited media yet. Run the audit for this event.</div>`;
}

function buildMediaAuditSubtext(profile, pending) {
  const analyzed = Number(profile.analyzedCount || 0);
  const total = Number(profile.submissionCount || 0);
  const ai = Number(profile.aiAnalyzedCount || 0);
  return `${analyzed}/${total} analyzed, ${ai} AI vision-analyzed, ${pending} pending.`;
}

function renderMediaAuditStats(profile, pending) {
  const values = [
    ["Analyzed", profile.analyzedCount || 0],
    ["Photos", profile.photoCount || 0],
    ["Video stills", profile.videoThumbnailCount || 0],
    ["AI vision", profile.aiAnalyzedCount || 0],
    ["Faces seen", profile.faceCount || 0],
    ["Pending", pending]
  ];
  return values.map(([label, value]) => `
    <div class="media-audit-stat">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join("");
}

function renderMediaAuditFaceSummary(faceDedupe) {
  const values = [
    ["Provider", faceDedupe.provider || "not configured"],
    ["Analyzed", faceDedupe.analyzedSubmissions || 0],
    ["Detected faces", faceDedupe.detectedFaces || 0],
    ["Unique clusters", faceDedupe.uniqueFaceClusters || 0],
    ["Hero selected", faceDedupe.selectedSources || 0],
    ["Skipped dupes", faceDedupe.skippedDuplicateSources || 0]
  ];
  const latest = faceDedupe.latestDecisionAt ? `Last hero decision ${formatDateTime(faceDedupe.latestDecisionAt)}.` : "";

  return `
    <div class="media-audit-face-summary-card">
      <div>
        <strong>AI face dedupe</strong>
        <p class="muted">${escapeHtml(faceDedupe.summary || "No Rekognition face analysis has been stored for this event yet.")} ${escapeHtml(latest)}</p>
      </div>
      <div class="media-audit-face-summary-grid">
        ${values.map(([label, value]) => `
          <span>
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(label)}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMediaAuditTagGroups(profile) {
  const groups = [
    ["Location cues", profile.backgroundCues],
    ["Scene", profile.sceneTags],
    ["Lighting", profile.lightingTags],
    ["Colors", profile.dominantColors],
    ["Composition", profile.compositionTags]
  ];
  return groups.map(([label, tags]) => `
    <div class="media-audit-tag-group">
      <strong>${escapeHtml(label)}</strong>
      <div>${renderAuditPills(tags)}</div>
    </div>
  `).join("");
}

function renderMediaAuditInsightRow(insight) {
  return `
    <tr class="media-audit-row">
      <td>${renderMediaAuditPreview(insight)}</td>
      <td>${renderMediaAuditIdentity(insight)}</td>
      <td>
        <div class="media-audit-detail-grid">
          ${renderMediaAuditDetailBlock("Display", renderAuditPills(buildMediaAuditDisplayFacts(insight), "No dimensions yet", 6))}
          ${renderMediaAuditDetailBlock("EXIF and upload", renderAuditPills(buildMediaAuditExifFacts(insight), "No EXIF or upload metadata", 8))}
          ${renderMediaAuditDetailBlock("AI and people", renderAuditPills(buildMediaAuditVisionFacts(insight), "AI not run", 6))}
          ${renderMediaAuditDetailBlock("Face dedupe", renderAuditPills(buildMediaAuditFaceDedupeFacts(insight), "No Rekognition face data", 8))}
          ${renderMediaAuditDetailBlock("Style tags", renderAuditPills(buildMediaAuditStyleTags(insight), "No style tags yet", 10))}
        </div>
      </td>
      <td>${renderMediaAuditLocation(insight)}</td>
    </tr>
  `;
}

function renderMediaAuditCard(insight) {
  return `
    <article class="admin-mobile-card media-audit-card">
      ${renderMediaAuditPreview(insight)}
      <div class="mobile-card-heading">
        <div>${renderMediaAuditIdentity(insight)}</div>
        <span class="status-pill">${escapeHtml(insight.visionStatus || "not_requested")}</span>
      </div>
      ${renderMediaAuditDetailBlock("Display", renderAuditPills(buildMediaAuditDisplayFacts(insight), "No dimensions yet", 6))}
      ${renderMediaAuditDetailBlock("EXIF and upload", renderAuditPills(buildMediaAuditExifFacts(insight), "No EXIF or upload metadata", 8))}
      ${renderMediaAuditDetailBlock("AI and people", renderAuditPills(buildMediaAuditVisionFacts(insight), "AI not run", 6))}
      ${renderMediaAuditDetailBlock("Face dedupe", renderAuditPills(buildMediaAuditFaceDedupeFacts(insight), "No Rekognition face data", 8))}
      ${renderMediaAuditDetailBlock("Style tags", renderAuditPills(buildMediaAuditStyleTags(insight), "No style tags yet", 10))}
      ${renderMediaAuditDetailBlock("Location cues", renderMediaAuditLocation(insight))}
    </article>
  `;
}

function renderMediaAuditPreview(insight) {
  const title = getMediaAuditTitle(insight);
  const aspect = getMediaAuditAspectRatio(insight);
  const kind = insight.previewKind === "video_thumbnail" ? "Video still" : "Photo";
  const content = insight.previewUrl
    ? `<img src="${escapeAttribute(insight.previewUrl)}" alt="${escapeAttribute(`Preview for ${title}`)}" loading="lazy" decoding="async" />`
    : `<span>No preview</span>`;
  const tag = insight.previewUrl ? "a" : "div";
  const href = insight.previewUrl ? ` href="${escapeAttribute(insight.previewUrl)}" target="_blank" rel="noopener noreferrer"` : "";

  return `
    <${tag} class="media-audit-preview is-${escapeAttribute(insight.orientation || "unknown")}" style="--audit-aspect: ${escapeAttribute(aspect)};"${href}>
      ${content}
      ${renderMediaAuditFaceBoxes(insight)}
      <small>${escapeHtml(kind)}</small>
    </${tag}>
  `;
}

function renderMediaAuditFaceBoxes(insight) {
  const faces = Array.isArray(insight.faces) ? insight.faces.filter((face) => face?.boundingBox) : [];
  if (!faces.length) return "";

  return `
    <span class="media-audit-face-boxes" aria-hidden="true">
      ${faces.map((face) => renderMediaAuditFaceBox(face, insight)).join("")}
    </span>
  `;
}

function renderMediaAuditFaceBox(face, insight) {
  const box = getDisplayFaceBoundingBox(face.boundingBox || {}, insight);
  if (!box) return "";
  const label = face.clusterLabel || face.clusterId || `face ${Number(face.index || 0) + 1}`;
  const faceId = getFaceDisplayId(face);
  const state = face.matched ? "match" : "unique";
  const confidence = Number(face.matchConfidence || face.confidence || 0);
  const confidenceLabel = confidence ? ` ${confidence.toFixed(1)}%` : "";
  const style = [
    `left:${toPercent(box.left)}`,
    `top:${toPercent(box.top)}`,
    `width:${toPercent(box.width)}`,
    `height:${toPercent(box.height)}`
  ].join(";");

  return `
    <span class="media-audit-face-box is-${escapeAttribute(state)}" style="${escapeAttribute(style)}" title="${escapeAttribute(`${state} ${faceId || label}${confidenceLabel}`)}">
      <span>${escapeHtml(`${state === "match" ? "match" : "unique"} ${faceId || shortFaceClusterLabel(label)}`)}</span>
    </span>
  `;
}

function getDisplayFaceBoundingBox(box, insight = {}) {
  const left = Number(box.left);
  const top = Number(box.top);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  return normalizeDisplayFaceBox(left, top, width, height);
}

function normalizeDisplayFaceBox(left, top, width, height) {
  const safeLeft = clampUnit(left);
  const safeTop = clampUnit(top);
  return {
    left: safeLeft,
    top: safeTop,
    width: Math.max(0, Math.min(1 - safeLeft, width)),
    height: Math.max(0, Math.min(1 - safeTop, height))
  };
}

function renderMediaAuditIdentity(insight) {
  const title = getMediaAuditTitle(insight);
  const source = `${insight.source || "guest"} ${insight.mediaType || insight.sourceKind || "media"}`;
  const created = insight.submissionCreatedAt ? `Uploaded ${formatDateTime(insight.submissionCreatedAt)}` : "";
  const byline = insight.guestName ? `By ${insight.guestName}` : source;

  return `
    <div class="media-audit-identity">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(byline)}</span>
      <span class="muted">${escapeHtml(source)}</span>
      ${created ? `<span class="muted">${escapeHtml(created)}</span>` : ""}
      <code>${escapeHtml(insight.submissionId)}</code>
    </div>
  `;
}

function renderMediaAuditDetailBlock(label, body) {
  return `
    <div class="media-audit-detail-block">
      <strong>${escapeHtml(label)}</strong>
      <div>${body}</div>
    </div>
  `;
}

function renderMediaAuditLocation(insight) {
  const cues = buildMediaAuditLocationCues(insight);
  return `
    <div class="media-audit-location">
      ${renderAuditPills(cues, "No AI location/background cues", 8)}
      <p class="muted">GPS city/region require embedded GPS plus reverse geocoding; v1 stores raw EXIF GPS and uploader IP for admin use.</p>
    </div>
  `;
}

function buildMediaAuditDisplayFacts(insight) {
  const dimensions = `${Number(insight.width || 0)}x${Number(insight.height || 0)}`;
  const facts = [
    insight.format || "unknown format",
    dimensions,
    insight.orientation || "unknown orientation"
  ];
  if (insight.displayAspectRatio) facts.push(`aspect ${Number(insight.displayAspectRatio).toFixed(2)}:1`);
  if (Number(insight.qualityScore || 0)) facts.push(`quality ${Math.round(Number(insight.qualityScore) * 100)}%`);
  if (Number(insight.size || 0)) facts.push(formatBytes(insight.size));
  return facts;
}

function buildMediaAuditExifFacts(insight) {
  const facts = [];
  if (insight.exifCaptureTime) facts.push(`captured ${insight.exifCaptureTime}`);
  if (insight.exifCameraMake || insight.exifCameraModel) facts.push([insight.exifCameraMake, insight.exifCameraModel].filter(Boolean).join(" "));
  if (insight.exifLensModel) facts.push(`lens ${insight.exifLensModel}`);
  if (insight.exifSoftware) facts.push(`software ${insight.exifSoftware}`);
  if (insight.exifOrientation) facts.push(`exif orientation ${insight.exifOrientation}`);
  if (insight.exifMetadataVersion) facts.push(`exif v${insight.exifMetadataVersion}`);
  if (insight.reverseGeocodingStatus) facts.push(`geocode ${insight.reverseGeocodingStatus}`);
  if (insight.reverseGeocodingProvider) facts.push(`provider ${insight.reverseGeocodingProvider}`);
  if (insight.uploaderIpAddress) facts.push(`uploader IP ${insight.uploaderIpAddress}`);
  return facts;
}

function buildMediaAuditVisionFacts(insight) {
  const facts = [insight.visionStatus || "not_requested"];
  if (insight.peopleCount !== null && insight.peopleCount !== undefined) facts.push(`${insight.peopleCount} people`);
  if (insight.faceCount !== null && insight.faceCount !== undefined) facts.push(`${insight.faceCount} faces`);
  if (insight.summary) facts.push(insight.summary);
  if (insight.skipReason) facts.push(insight.skipReason);
  return facts;
}

function buildMediaAuditFaceDedupeFacts(insight) {
  const facts = [];
  const analysis = insight.faceAnalysis || {};
  const dedupe = insight.faceDedupe || {};
  const faces = Array.isArray(insight.faces) ? insight.faces : [];
  const matchedFaces = faces.filter((face) => face.matched).length;
  const uniqueFaces = faces.length - matchedFaces;

  if (analysis.status) facts.push(`rekognition ${analysis.status}`);
  if (analysis.faceCount !== undefined && analysis.faceCount !== null) facts.push(`${analysis.faceCount} detected`);
  if (uniqueFaces) facts.push(`${uniqueFaces} unique`);
  if (matchedFaces) facts.push(`${matchedFaces} matched`);
  if (dedupe.decision) facts.push(formatMediaAuditDedupeDecision(dedupe.decision));
  if (dedupe.reason) facts.push(formatMediaAuditDedupeReason(dedupe.reason));
  if (dedupe.duplicateClusterIds?.length) facts.push(`duplicate clusters ${dedupe.duplicateClusterIds.map(getFaceClusterDisplayId).join(", ")}`);
  if (dedupe.newClusterIds?.length) facts.push(`new clusters ${dedupe.newClusterIds.map(getFaceClusterDisplayId).join(", ")}`);
  faces.slice(0, 4).forEach((face) => {
    const confidence = Number(face.matchConfidence || face.confidence || 0);
    facts.push(`${face.matched ? "match" : "unique"} ${getFaceDisplayId(face) || face.clusterLabel || `face ${Number(face.index || 0) + 1}`}${confidence ? ` ${Math.round(confidence)}%` : ""}`);
  });
  if (analysis.errorMessage) facts.push(`face error ${analysis.errorMessage}`);
  return facts;
}

function formatMediaAuditDedupeDecision(value) {
  if (value === "selected") return "selected for hero";
  if (value === "skipped") return "skipped for hero";
  return value;
}

function formatMediaAuditDedupeReason(value) {
  return String(value || "")
    .replace(/-/g, " ")
    .replace(/^duplicate face cluster$/i, "duplicate face cluster");
}

function shortFaceClusterLabel(value) {
  return String(value || "").replace(/^face\s*/i, "").replace(/^face-/, "").slice(0, 6) || "face";
}

function getFaceDisplayId(face) {
  if (face?.faceId) return face.faceId;
  return getFaceClusterDisplayId(face?.clusterId || face?.clusterLabel || "");
}

function getFaceClusterDisplayId(cluster) {
  const short = shortFaceClusterLabel(cluster).replace(/[^A-Za-z0-9]/g, "");
  return short && short !== "face" ? `F-${short}` : "";
}

function toPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.max(0, Math.min(100, number * 100)).toFixed(2)}%`;
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function buildMediaAuditStyleTags(insight) {
  return [
    ...(insight.sceneTags || []),
    ...(insight.lightingTags || []),
    ...(insight.compositionTags || []),
    ...(insight.dominantColors || [])
  ];
}

function buildMediaAuditLocationCues(insight) {
  const cues = [
    ...(insight.backgroundCues || []),
    ...(insight.sceneTags || []).filter((tag) => /lake|outdoor|indoor|room|wall|house|yard|park|venue|floral|birthday|party/i.test(tag))
  ];
  if (insight.exifGpsCity) cues.unshift(`gps city: ${insight.exifGpsCity}`);
  if (insight.exifGpsRegion) cues.unshift(`gps region: ${insight.exifGpsRegion}`);
  if (insight.exifGpsCounty) cues.push(`county: ${insight.exifGpsCounty}`);
  if (insight.exifGpsCountry) cues.push(`country: ${insight.exifGpsCountry}`);
  if (insight.exifGpsPostcode) cues.push(`postcode: ${insight.exifGpsPostcode}`);
  if (insight.exifGpsLatitude !== null && insight.exifGpsLongitude !== null) cues.unshift(`gps ${Number(insight.exifGpsLatitude).toFixed(5)}, ${Number(insight.exifGpsLongitude).toFixed(5)}`);
  if (insight.exifGpsAltitudeMeters !== null) cues.push(`altitude ${Math.round(Number(insight.exifGpsAltitudeMeters))}m`);
  if (insight.exifGpsPrecision) cues.push(`precision ${insight.exifGpsPrecision}`);
  if (insight.exifGpsDisplayName) cues.push(`address: ${insight.exifGpsDisplayName}`);
  if (insight.reverseGeocodingError) cues.push(`geocode error: ${insight.reverseGeocodingError}`);
  if (insight.uploaderIpAddress) cues.push(`uploader IP ${insight.uploaderIpAddress}`);
  if (insight.visibleText) cues.push(`visible text: ${insight.visibleText}`);
  return Array.from(new Set(cues.filter(Boolean)));
}

function getMediaAuditTitle(insight) {
  return insight.originalFilename || insight.guestName || insight.submissionId || "Audited moment";
}

function getMediaAuditAspectRatio(insight) {
  const { width, height } = getMediaAuditDisplayDimensions(insight);
  const ratio = width && height
    ? width / height
    : Number(insight.displayAspectRatio || 0);
  if (Number.isFinite(ratio) && ratio > 0) return String(Math.max(0.45, Math.min(2.4, ratio)).toFixed(4));
  if (insight.orientation === "portrait") return "0.8000";
  if (insight.orientation === "landscape") return "1.3333";
  return "1.0000";
}

function getMediaAuditDisplayDimensions(insight = {}) {
  const width = Number(insight.width || 0);
  const height = Number(insight.height || 0);
  if (!width || !height) return { width: 0, height: 0 };
  if (isExifOrientationSwapped(insight.exifOrientation)) {
    return { width: height, height: width };
  }
  return { width, height };
}

function isExifOrientationSwapped(value) {
  return ["5", "6", "7", "8"].includes(getExifOrientationValue(value));
}

function getExifOrientationValue(value) {
  const orientation = String(value || "").trim();
  return /^[1-8]$/.test(orientation) ? orientation : "1";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAuditPills(tags = [], emptyLabel = "No tags yet", limit = 8) {
  const values = Array.isArray(tags) ? tags.filter(Boolean).slice(0, limit) : [];
  return values.length
    ? values.map((tag) => `<span class="status-pill">${escapeHtml(tag)}</span>`).join("")
    : `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
}

function renderEventEditForm(selectedEventId = qs("#editEventSelect")?.value || "") {
  const form = qs("#eventEditForm");
  const select = qs("#editEventSelect");

  if (!form || !select) return;

  const submitButton = form.querySelector("button[type='submit']");
  if (!submitButton) return;

  select.innerHTML = events.length
    ? events.map((event) => `<option value="${escapeAttribute(event.id)}">${escapeHtml(event.name)}</option>`).join("")
    : `<option value="">No events created</option>`;

  const nextEventId = events.some((event) => event.id === selectedEventId)
    ? selectedEventId
    : events[0]?.id || "";
  select.value = nextEventId;
  populateEventEditForm(nextEventId, { resetDirty: false });

  const hasEvents = events.length > 0;
  Array.from(form.elements).forEach((field) => {
    field.disabled = !hasEvents;
  });
  submitButton.disabled = !hasEvents;
  bindDirtySaveButton(form, "input, select", "button[type='submit']");
  resetDirtySaveButton(form);
}

function populateEventEditForm(eventId, { resetDirty = true } = {}) {
  const form = qs("#eventEditForm");
  if (!form) return;

  const event = events.find((item) => item.id === eventId);
  qs("#editEventName").value = event?.name || "";
  qs("#editEventDate").value = event?.eventDate || "";
  qs("#editHostName").value = event?.hostName || "";
  qs("#editHostEmail").value = event?.hostEmail || "";
  qs("#editTimeCapsuleEnabled").checked = Boolean(event?.timeCapsuleEnabled);

  if (resetDirty) resetDirtySaveButton(form);
}

function selectEventForEdit(eventId) {
  if (!eventId) return;
  renderEventEditForm(eventId);
  scrollToTarget("#eventEditPanel");
}

function getOperationalEvents() {
  return [...events].sort((a, b) => {
    const pendingDiff = Number(b.pendingCount || 0) - Number(a.pendingCount || 0);
    if (pendingDiff) return pendingDiff;
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return String(a.eventDate || "9999-12-31").localeCompare(String(b.eventDate || "9999-12-31"));
  });
}

function buildEventLinkActions(event, hostUrl, capsuleUrl) {
  const actions = [
    {
      label: "Host",
      summary: "Private host dashboard",
      copyLabel: "Copy host link",
      openLabel: "Open host",
      url: hostUrl
    }
  ];

  if (event.timeCapsuleEnabled) {
    actions.push(capsuleUrl
      ? {
        label: "Capsule",
        summary: "Published private share link",
        copyLabel: "Copy capsule link",
        openLabel: "Open capsule",
        url: capsuleUrl
      }
      : {
        label: "Capsule",
        summary: "Draft: publish from the host dashboard to share.",
        noteOnly: true
      });
  }

  return actions;
}

function renderLinkActions(items) {
  return `
    <div class="admin-link-list">
      ${items.map((item) => `
        <div class="admin-link-item link-action-group">
          <div>
            <span class="admin-link-label">${escapeHtml(item.label)}</span>
            <span class="${item.noteOnly ? "admin-link-note" : "admin-link-summary"}">${escapeHtml(item.summary)}</span>
          </div>
          ${item.url ? `
            <div class="row-actions">
              <button class="small-button" type="button" data-copy="${encodeURIComponent(item.url)}">${escapeHtml(item.copyLabel)}</button>
              <button class="small-button" type="button" data-open="${encodeURIComponent(item.url)}">${escapeHtml(item.openLabel)}</button>
            </div>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderMoreActions(event) {
  return `
    <details class="more-actions">
      <summary class="small-button">More actions</summary>
      <div class="more-actions-menu">
        <button class="small-button is-danger" type="button" data-rotate-host>Rotate host link</button>
        <button class="small-button is-danger" type="button" data-delete-event data-event-name="${escapeAttribute(event.name)}">Delete event</button>
      </div>
    </details>
  `;
}

function bindTagActions() {
  qsaWithin("#tagsTable, #tagsCards", "[data-tag-id]").forEach((row) => {
    bindDirtySaveButton(row, "[data-tag-status], [data-tag-event]", "[data-save-tag]");
  });

  qsaWithin("#tagsTable, #tagsCards", "[data-save-tag]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-tag-id]");
      const tagId = row.dataset.tagId;
      const body = {
        status: row.querySelector("[data-tag-status]").value,
        activeEventId: row.querySelector("[data-tag-event]").value || null
      };
      await updateTag(tagId, body);
    });
  });

  qsaWithin("#tagsTable, #tagsCards", "[data-delete-tag]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-tag-id]");
      const tagLabel = button.dataset.tagLabel || "this reusable tag";
      const message = `Delete reusable tag "${tagLabel}"? This removes the NTAG record and guest scan link, but does not delete the event or any guest moments.`;
      if (!window.confirm(message)) return;
      await deleteTag(row.dataset.tagId, tagLabel);
    });
  });

  qsaWithin("#tagsTable, #tagsCards", "[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(decodeURIComponent(button.dataset.copy), button));
  });

  qsaWithin("#tagsTable, #tagsCards", "[data-open]").forEach((button) => {
    button.addEventListener("click", () => openUrl(decodeURIComponent(button.dataset.open)));
  });
}

function bindEventActions() {
  qsaWithin("#eventsTable, #eventsCards", "[data-edit-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("[data-event-id]");
      selectEventForEdit(row?.dataset.eventId || "");
    });
  });

  qsaWithin("#eventsTable, #eventsCards", "[data-event-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-event-id]");
      await updateEvent(row.dataset.eventId, { status: button.dataset.eventStatus });
    });
  });

  qsaWithin("#eventsTable, #eventsCards", "[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(decodeURIComponent(button.dataset.copy), button));
  });

  qsaWithin("#eventsTable, #eventsCards", "[data-open]").forEach((button) => {
    button.addEventListener("click", () => openUrl(decodeURIComponent(button.dataset.open)));
  });

  qsaWithin("#eventsTable, #eventsCards", "[data-rotate-host]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Rotate this host link? The previous host link will stop working.")) return;
      const row = button.closest("[data-event-id]");
      await updateEvent(row.dataset.eventId, { rotateHostToken: true });
    });
  });

  qsaWithin("#eventsTable, #eventsCards", "[data-delete-event]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-event-id]");
      const eventName = button.dataset.eventName || "this event";
      const message = `Permanently delete "${eventName}"? This removes the host link, guest submissions, Time Capsule items, and unassigns any NTAGs. This cannot be undone.`;
      if (!window.confirm(message)) return;
      await deleteEvent(row.dataset.eventId, eventName);
    });
  });
}

function bindAttentionActions() {
  qsaWithin("#attentionPanel", "[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(decodeURIComponent(button.dataset.copy), button));
  });

  qsaWithin("#attentionPanel", "[data-open]").forEach((button) => {
    button.addEventListener("click", () => openUrl(decodeURIComponent(button.dataset.open)));
  });

  qsaWithin("#attentionPanel", "[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => scrollToTarget(button.dataset.scrollTarget));
  });
}

function bindWallDeviceActions() {
  qsaWithin("#devicesTable, #devicesCards", "[data-device-id]").forEach((row) => {
    bindDirtySaveButton(row, "[data-device-status], [data-device-scan-preset], [data-device-submission-preset], [data-device-manual-preset], [data-device-brightness]", "[data-save-device]");
  });

  qsaWithin("#devicesTable, #devicesCards", "[data-save-device]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-device-id]");
      await updateWallDevice(row.dataset.deviceId, getWallDeviceFormValues(row));
    });
  });

  qsaWithin("#devicesTable, #devicesCards", "[data-rotate-bridge]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-device-id]");
      if (!window.confirm("Rotate this bridge token? The laptop bridge must be updated with the new token.")) return;
      await updateWallDevice(row.dataset.deviceId, { rotateBridgeToken: true }, "Bridge token rotated. Copy the new bridge config before leaving this page.");
    });
  });

  qsaWithin("#devicesTable, #devicesCards", "[data-test-trigger]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-device-id]");
      await testWallDevice(row.dataset.deviceId, button.dataset.testTrigger);
    });
  });
}

function bindScrollActions() {
  Array.from(document.querySelectorAll("[data-scroll-target]")).forEach((button) => {
    button.addEventListener("click", () => scrollToTarget(button.dataset.scrollTarget));
  });
}

function scrollToTarget(selector) {
  const target = qs(selector);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  const focusTarget = target.matches("form") ? target.querySelector("input, select, button") : target;
  focusElement(focusTarget);
}

function openUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function updateTag(tagId, body, successMessage = "Tag updated.") {
  try {
    await adminRequest(`/admin/tags/${encodeURIComponent(tagId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadAdmin();
    showAdminNotice(successMessage, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not update tag.", "error");
  }
}

async function deleteTag(tagId, tagLabel) {
  try {
    await adminRequest(`/admin/tags/${encodeURIComponent(tagId)}`, {
      method: "DELETE"
    });
    await loadAdmin();
    showAdminNotice(`Reusable tag "${tagLabel}" was deleted. Event data and guest moments were not changed.`, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not delete reusable tag.", "error");
  }
}

async function updateEvent(eventId, body) {
  try {
    await adminRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadAdmin();
    showAdminNotice("Event updated.", "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not update event.", "error");
  }
}

async function updateSelectedEventDetails(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");

  if (submitButton?.dataset.hasUnsavedChanges !== "true") return;

  const eventId = qs("#editEventSelect").value;
  if (!eventId) {
    showAdminNotice("Choose an event before saving details.", "error");
    return;
  }

  const body = {
    name: qs("#editEventName").value.trim(),
    eventDate: qs("#editEventDate").value,
    hostName: qs("#editHostName").value.trim(),
    hostEmail: qs("#editHostEmail").value.trim(),
    timeCapsuleEnabled: qs("#editTimeCapsuleEnabled").checked
  };

  try {
    setButtonBusy(submitButton, true, "Saving details...");
    await adminRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadAdmin();
    renderEventEditForm(eventId);
    showAdminNotice("Event details updated.", "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not update event details.", "error");
  } finally {
    setButtonBusy(submitButton, false);
    updateDirtySaveButton(form);
  }
}

async function updateWallDevice(deviceId, body, successMessage = "Wall device updated.") {
  try {
    const result = await adminRequest(`/admin/wall-devices/${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadAdmin();
    if (result.bridgeConfig) showBridgeConfig(result.bridgeConfig);
    showAdminNotice(successMessage, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not update wall device.", "error");
  }
}

async function testWallDevice(deviceId, triggerType) {
  try {
    await adminRequest(`/admin/wall-devices/${encodeURIComponent(deviceId)}/triggers`, {
      method: "POST",
      body: JSON.stringify({ triggerType })
    });
    await loadAdmin();
    showAdminNotice("Light test queued. The bridge will pick it up on its next poll.", "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not queue light test.", "error");
  }
}

async function deleteEvent(eventId, eventName) {
  try {
    await adminRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE"
    });
    await loadAdmin();
    showAdminNotice(`Event "${eventName}" was deleted. Any assigned NTAG is now unassigned.`, "success");
  } catch (error) {
    showAdminNotice(error.message || "Could not delete event.", "error");
  }
}

async function runCleanup() {
  try {
    const result = await adminRequest("/admin/retention-cleanup", {
      method: "POST",
      body: JSON.stringify({ limit: 100 })
    });
    await loadAdmin();
    setNotice(qs("#adminNotice"), `Cleanup checked ${result.checked || 0} expired items and purged ${result.purged || 0}.`, "success");
  } catch (error) {
    setNotice(qs("#adminNotice"), error.message || "Could not run cleanup.", "error");
  }
}

function adminRequest(path, options = {}) {
  return requestJson(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Admin-Token": adminToken
    }
  });
}

function generateTagCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes).map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10);
  qs("#tagCode").value = `ww-${code}`;
}

function signOut() {
  clearAdminToken();
  adminToken = "";
  qs("#adminToken").value = "";
  qs("#bridgeConfigPanel").hidden = true;
  qs("#bridgeConfigText").textContent = "";
  qs("#authPanel").hidden = false;
  qs("#adminApp").hidden = true;
}

function renderGuide() {
  const hasEvent = events.length > 0;
  const hasTag = tags.length > 0;
  const hasAssignedTag = tags.some((tag) => tag.activeEventId && tag.status === "active");
  const hasLighting = wallDevices.some((device) => device.status === "active");
  const steps = {
    event: hasEvent,
    tag: hasTag,
    assign: hasAssignedTag,
    share: hasEvent && hasAssignedTag,
    lighting: hasLighting
  };
  const firstOpen = Object.keys(steps).find((key) => !steps[key]);
  qs(".setup-guide").classList.toggle("is-collapsed", !firstOpen);

  Object.entries(steps).forEach(([key, isDone]) => {
    const element = qs(`[data-guide-step="${key}"]`);
    if (!element) return;
    element.classList.toggle("is-done", isDone);
    element.classList.toggle("is-current", key === firstOpen);
  });
}

function renderTagCard(tag) {
  const guestUrl = buildGuestUrl(tag.publicCode);

  return `
    <article class="admin-mobile-card" data-tag-id="${tag.id}">
      <div class="mobile-card-heading">
        <div>
          <strong>${escapeHtml(tag.label)}</strong>
          <span>${escapeHtml(tag.publicCode)}</span>
        </div>
        <span class="status-pill">${escapeHtml(tag.status)}</span>
      </div>
      <div class="field">
        <label>Status</label>
        <select data-tag-status>
          <option value="active"${tag.status === "active" ? " selected" : ""}>Active</option>
          <option value="inactive"${tag.status === "inactive" ? " selected" : ""}>Inactive</option>
        </select>
      </div>
      <div class="field">
        <label>Assigned event</label>
        <select data-tag-event>${buildEventOptions(tag.activeEventId)}</select>
      </div>
      ${renderLinkActions([
        { label: "Guest scan", summary: "Guest upload link", copyLabel: "Copy guest link", openLabel: "Open guest", url: guestUrl }
      ])}
      <div class="row-actions">
        <button class="small-button" type="button" data-save-tag>Save</button>
        <button class="small-button is-danger" type="button" data-delete-tag data-tag-label="${escapeAttribute(tag.label)}">Delete</button>
      </div>
    </article>
  `;
}

function renderEventCard(event) {
  const hostUrl = buildHostUrl(event.id, event.hostToken);
  const capsuleUrl = getPublishedCapsuleShareUrl(event);
  const statusButton = event.status === "active" ? "Deactivate" : "Activate";
  const nextStatus = event.status === "active" ? "inactive" : "active";
  const capsuleStatus = event.timeCapsuleEnabled ? (event.timeCapsuleStatus || "draft") : "not added";

  return `
    <article class="admin-mobile-card" data-event-id="${event.id}">
      <div class="mobile-card-heading">
        <div>
          <strong>${escapeHtml(event.name)}</strong>
          <span>${formatDate(event.eventDate)} | expires ${formatDate(event.retentionExpiresAt?.slice(0, 10))}</span>
        </div>
        <span class="status-pill">${escapeHtml(event.status)}</span>
      </div>
      <div class="button-row">
        <span class="status-pill is-pending">${event.pendingCount || 0} pending</span>
        <span class="status-pill is-approved">${event.approvedCount || 0} approved</span>
        <span class="status-pill">${escapeHtml(`Capsule ${capsuleStatus}`)}</span>
      </div>
      ${renderLinkActions(buildEventLinkActions(event, hostUrl, capsuleUrl))}
      <div class="row-actions">
        <button class="small-button" type="button" data-edit-event>Edit details</button>
        <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
        ${renderMoreActions(event)}
      </div>
    </article>
  `;
}

function renderWallDeviceCard(device) {
  return `
    <article class="admin-mobile-card" data-device-id="${escapeAttribute(device.id)}">
      <div class="mobile-card-heading">
        <div>
          <strong>${escapeHtml(device.name)}</strong>
          <span>${escapeHtml(device.eventName || "Unassigned event")}</span>
        </div>
        <span class="status-pill">${escapeHtml(device.status)}</span>
      </div>
      <div class="field">
        <label>Status</label>
        <select data-device-status>
          <option value="active"${device.status === "active" ? " selected" : ""}>Active</option>
          <option value="inactive"${device.status === "inactive" ? " selected" : ""}>Inactive</option>
        </select>
      </div>
      ${renderPresetInputs(device)}
      <div class="button-row">
        <span class="status-pill is-pending">${device.pendingTriggerCount || 0} pending</span>
        <span class="status-pill">${device.failedTriggerCount || 0} failed</span>
      </div>
      <p class="muted">${device.lastSeenAt ? `Last seen ${formatDateTime(device.lastSeenAt)}` : "Bridge not seen yet"}</p>
      ${renderDeviceActions()}
    </article>
  `;
}

function renderPresetInputs(device) {
  return `
    <div class="preset-grid is-compact">
      <label>Scan
        <input data-device-scan-preset type="number" min="1" max="250" value="${escapeAttribute(device.scanPresetId || 2)}" />
      </label>
      <label>Submission
        <input data-device-submission-preset type="number" min="1" max="250" value="${escapeAttribute(device.submissionPresetId || 3)}" />
      </label>
      <label>Test
        <input data-device-manual-preset type="number" min="1" max="250" value="${escapeAttribute(device.manualPresetId || 4)}" />
      </label>
      <label>Brightness
        <input data-device-brightness type="number" min="1" max="255" value="${escapeAttribute(device.brightness || 180)}" />
      </label>
    </div>
  `;
}

function renderDeviceActions() {
  return `
    <div class="row-actions">
      <button class="small-button" type="button" data-save-device>Save</button>
      <button class="small-button" type="button" data-rotate-bridge>Rotate bridge</button>
      <button class="small-button" type="button" data-test-trigger="tag_scan">Test scan</button>
      <button class="small-button" type="button" data-test-trigger="submission_received">Test submit</button>
      <button class="small-button" type="button" data-test-trigger="manual_test">Celebrate</button>
    </div>
  `;
}

function getWallDeviceFormValues(root) {
  return {
    status: root.querySelector("[data-device-status]").value,
    scanPresetId: root.querySelector("[data-device-scan-preset]").value,
    submissionPresetId: root.querySelector("[data-device-submission-preset]").value,
    manualPresetId: root.querySelector("[data-device-manual-preset]").value,
    brightness: root.querySelector("[data-device-brightness]").value
  };
}

function showBridgeConfig(config) {
  qs("#bridgeConfigPanel").hidden = !config;
  qs("#bridgeConfigText").textContent = config || "";
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
  updateDirtySaveButton(root, fields, button);

  fields.forEach((field) => {
    field.addEventListener("input", () => updateDirtySaveButton(root, fields, button));
    field.addEventListener("change", () => updateDirtySaveButton(root, fields, button));
  });
}

function updateDirtySaveButton(root, fields, button) {
  if (!root) return;

  const fieldSelector = root.dataset.dirtyFieldSelector;
  const buttonSelector = root.dataset.dirtyButtonSelector;
  fields = fields || (fieldSelector ? Array.from(root.querySelectorAll(fieldSelector)) : []);
  button = button || (buttonSelector ? root.querySelector(buttonSelector) : null);
  if (!button) return;

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

function resetDirtySaveButton(root) {
  if (!root?.dataset.dirtyTrackerBound) return;
  const fields = Array.from(root.querySelectorAll(root.dataset.dirtyFieldSelector));
  const button = root.querySelector(root.dataset.dirtyButtonSelector);
  if (!button) return;
  root.dataset.cleanSnapshot = getDirtySnapshot(fields);
  updateDirtySaveButton(root, fields, button);
}

function buildEventOptions(activeEventId) {
  return [
    `<option value="">Unassigned</option>`,
    ...events.map((event) => `<option value="${escapeAttribute(event.id)}"${event.id === activeEventId ? " selected" : ""}>${escapeHtml(event.name)}</option>`)
  ].join("");
}

function qsaWithin(containerSelector, targetSelector) {
  return Array.from(document.querySelectorAll(containerSelector)).flatMap((container) => Array.from(container.querySelectorAll(targetSelector)));
}

function focusElement(element) {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
