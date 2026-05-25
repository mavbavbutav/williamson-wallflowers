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
} from "../shared.js?v=20260525-1";

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
  qs("#signOutButton").addEventListener("click", signOut);
  qs("#eventForm").addEventListener("submit", createEvent);
  qs("#tagForm").addEventListener("submit", createTag);

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
    qs("#authPanel").hidden = true;
    qs("#adminApp").hidden = false;
    renderStats(payload.stats || {});
    renderTags();
    renderEvents();
  } catch (error) {
    qs("#authPanel").hidden = false;
    qs("#adminApp").hidden = true;
    setNotice(qs("#authNotice"), error.message || "Could not open admin.", "error");
  }
}

async function createEvent(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const body = Object.fromEntries(formData.entries());

  try {
    await adminRequest("/admin/events", {
      method: "POST",
      body: JSON.stringify(body)
    });
    event.currentTarget.reset();
    await loadAdmin();
    setNotice(qs("#adminNotice"), "Event created.", "success");
  } catch (error) {
    setNotice(qs("#adminNotice"), error.message || "Could not create event.", "error");
  }
}

async function createTag(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const body = Object.fromEntries(formData.entries());

  try {
    await adminRequest("/admin/tags", {
      method: "POST",
      body: JSON.stringify(body)
    });
    event.currentTarget.reset();
    await loadAdmin();
    setNotice(qs("#adminNotice"), "Tag registered.", "success");
  } catch (error) {
    setNotice(qs("#adminNotice"), error.message || "Could not register tag.", "error");
  }
}

function renderStats(stats) {
  const values = [
    ["Events", stats.events || 0],
    ["Tags", stats.tags || 0],
    ["Pending", stats.pending || 0],
    ["Approved", stats.approved || 0]
  ];

  qs("#statsGrid").innerHTML = values.map(([label, value]) => `
    <div class="stat">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderTags() {
  const rows = tags.map((tag) => {
    const assignedOptions = [
      `<option value="">Unassigned</option>`,
      ...events.map((event) => `<option value="${event.id}"${event.id === tag.activeEventId ? " selected" : ""}>${escapeHtml(event.name)}</option>`)
    ].join("");
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
          <span class="muted">${guestUrl}</span>
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

  qs("#tagsTable").innerHTML = rows || `<tr><td colspan="5">No tags registered yet.</td></tr>`;
  bindTagActions();
}

function renderEvents() {
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
        <td><span class="muted">${hostUrl}</span></td>
        <td>
          <span class="status-pill is-pending">${event.pendingCount || 0} pending</span>
          <span class="status-pill is-approved">${event.approvedCount || 0} approved</span>
        </td>
        <td><span class="status-pill">${event.status}</span></td>
        <td>
          <div class="row-actions">
            <button class="small-button" type="button" data-event-status="${nextStatus}">${statusButton}</button>
            <button class="small-button" type="button" data-copy="${encodeURIComponent(hostUrl)}">Copy host link</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  qs("#eventsTable").innerHTML = rows || `<tr><td colspan="5">No events created yet.</td></tr>`;
  bindEventActions();
}

function bindTagActions() {
  qs("#tagsTable").querySelectorAll("[data-save-tag]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const tagId = row.dataset.tagId;
      const body = {
        status: row.querySelector("[data-tag-status]").value,
        activeEventId: row.querySelector("[data-tag-event]").value || null
      };
      await updateTag(tagId, body);
    });
  });

  qs("#tagsTable").querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(decodeURIComponent(button.dataset.copy), button));
  });
}

function bindEventActions() {
  qs("#eventsTable").querySelectorAll("[data-event-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      await updateEvent(row.dataset.eventId, { status: button.dataset.eventStatus });
    });
  });

  qs("#eventsTable").querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(decodeURIComponent(button.dataset.copy), button));
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

function adminRequest(path, options = {}) {
  return requestJson(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Admin-Token": adminToken
    }
  });
}

function signOut() {
  clearAdminToken();
  adminToken = "";
  qs("#adminToken").value = "";
  qs("#authPanel").hidden = false;
  qs("#adminApp").hidden = true;
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
