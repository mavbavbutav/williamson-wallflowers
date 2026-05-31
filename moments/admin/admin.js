import {
  buildGuestUrl,
  buildHostUrl,
  clearAdminToken,
  copyText,
  formatDate,
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
  qs("#tagForm").addEventListener("submit", createTag);
  qs("#assignTagForm").addEventListener("submit", assignTag);
  qs("#generateTagCodeButton").addEventListener("click", generateTagCode);
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
    const shouldFocusTitle = qs("#adminApp").hidden;
    qs("#authPanel").hidden = true;
    qs("#adminApp").hidden = false;
    renderStats(payload.stats || {});
    renderAttention();
    renderGuide();
    renderAssignTagForm();
    renderEvents();
    renderTags();
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
            <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
            ${renderMoreActions()}
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

function renderMoreActions() {
  return `
    <details class="more-actions">
      <summary class="small-button">More actions</summary>
      <div class="more-actions-menu">
        <button class="small-button is-danger" type="button" data-rotate-host>Rotate host link</button>
      </div>
    </details>
  `;
}

function bindTagActions() {
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

  qsaWithin("#tagsTable, #tagsCards", "[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(decodeURIComponent(button.dataset.copy), button));
  });

  qsaWithin("#tagsTable, #tagsCards", "[data-open]").forEach((button) => {
    button.addEventListener("click", () => openUrl(decodeURIComponent(button.dataset.open)));
  });
}

function bindEventActions() {
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
  qs("#authPanel").hidden = false;
  qs("#adminApp").hidden = true;
}

function renderGuide() {
  const hasEvent = events.length > 0;
  const hasTag = tags.length > 0;
  const hasAssignedTag = tags.some((tag) => tag.activeEventId && tag.status === "active");
  const steps = {
    event: hasEvent,
    tag: hasTag,
    assign: hasAssignedTag,
    share: hasEvent && hasAssignedTag
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
        <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
        ${renderMoreActions()}
      </div>
    </article>
  `;
}

function buildEventOptions(activeEventId) {
  return [
    `<option value="">Unassigned</option>`,
    ...events.map((event) => `<option value="${event.id}"${event.id === activeEventId ? " selected" : ""}>${escapeHtml(event.name)}</option>`)
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
  return String(value || "").replace(/[&<>"']/g, (char) => ({
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
