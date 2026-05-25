import {
  buildGuestUrl,
  buildHostUrl,
  clearAdminToken,
  copyText,
  formatDate,
  getAdminToken,
  qs,
  requestJson,
  setAdminToken,
  setNotice
} from "../shared.js?v=20260525-3";

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
  qs("#generateTagCodeButton").addEventListener("click", generateTagCode);

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
    renderGuide();
    renderTags();
    renderEvents();
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
          <span class="muted link-preview">${escapeHtml(guestUrl)}</span>
        </td>
        <td>
          <div class="row-actions">
            <button class="small-button" type="button" data-save-tag>Save</button>
            <button class="small-button" type="button" data-copy="${encodeURIComponent(guestUrl)}">Copy guest link</button>
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

function renderEvents() {
  qs("#eventsCountLabel").textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;

  const rows = events.map((event) => {
    const hostUrl = buildHostUrl(event.id, event.hostToken);
    const statusButton = event.status === "active" ? "Deactivate" : "Activate";
    const nextStatus = event.status === "active" ? "inactive" : "active";

    return `
      <tr data-event-id="${event.id}">
        <td>
          <strong>${escapeHtml(event.name)}</strong><br />
          <span class="muted">${formatDate(event.eventDate)} | expires ${formatDate(event.retentionExpiresAt?.slice(0, 10))}</span>
        </td>
        <td><span class="muted link-preview">${escapeHtml(hostUrl)}</span></td>
        <td>
          <span class="status-pill is-pending">${event.pendingCount || 0} pending</span>
          <span class="status-pill is-approved">${event.approvedCount || 0} approved</span>
        </td>
        <td><span class="status-pill">${event.status}</span></td>
        <td>
          <div class="row-actions">
            <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
            <button class="small-button is-danger" type="button" data-rotate-host>Rotate host link</button>
            <button class="small-button" type="button" data-copy="${encodeURIComponent(hostUrl)}">Copy host link</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const cards = events.map((event) => renderEventCard(event)).join("");

  qs("#eventsTable").innerHTML = rows || `<tr><td colspan="5">No events created yet.</td></tr>`;
  qs("#eventsCards").innerHTML = cards || `<div class="empty-state">No events created yet.</div>`;
  bindEventActions();
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

  qsaWithin("#eventsTable, #eventsCards", "[data-rotate-host]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Rotate this host link? The previous host link will stop working.")) return;
      const row = button.closest("[data-event-id]");
      await updateEvent(row.dataset.eventId, { rotateHostToken: true });
    });
  });
}

async function updateTag(tagId, body) {
  try {
    await adminRequest(`/admin/tags/${encodeURIComponent(tagId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadAdmin();
    setNotice(qs("#adminNotice"), "Tag updated.", "success");
  } catch (error) {
    setNotice(qs("#adminNotice"), error.message || "Could not update tag.", "error");
  }
}

async function updateEvent(eventId, body) {
  try {
    await adminRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    await loadAdmin();
    setNotice(qs("#adminNotice"), "Event updated.", "success");
  } catch (error) {
    setNotice(qs("#adminNotice"), error.message || "Could not update event.", "error");
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
      <p class="link-preview">${escapeHtml(guestUrl)}</p>
      <div class="row-actions">
        <button class="small-button" type="button" data-save-tag>Save</button>
        <button class="small-button" type="button" data-copy="${encodeURIComponent(guestUrl)}">Copy guest link</button>
      </div>
    </article>
  `;
}

function renderEventCard(event) {
  const hostUrl = buildHostUrl(event.id, event.hostToken);
  const statusButton = event.status === "active" ? "Deactivate" : "Activate";
  const nextStatus = event.status === "active" ? "inactive" : "active";

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
      </div>
      <p class="link-preview">${escapeHtml(hostUrl)}</p>
      <div class="row-actions">
        <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
        <button class="small-button is-danger" type="button" data-rotate-host>Rotate host link</button>
        <button class="small-button" type="button" data-copy="${encodeURIComponent(hostUrl)}">Copy host link</button>
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
