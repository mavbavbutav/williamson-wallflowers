const API_OVERRIDE_KEY = "wallflowerMomentsApi";
const ADMIN_TOKEN_KEY = "wallflowerMomentsAdminToken";
const HOST_TOKEN_KEY_PREFIX = "wallflowerMomentsHostToken:";

function isLocalHost() {
  return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

export function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("api");

  if (explicit && isLocalHost()) {
    window.sessionStorage.setItem(API_OVERRIDE_KEY, explicit.replace(/\/$/, ""));
    return explicit.replace(/\/$/, "");
  }

  if (!isLocalHost()) {
    window.localStorage.removeItem(API_OVERRIDE_KEY);
    window.sessionStorage.removeItem(API_OVERRIDE_KEY);
  }

  const saved = isLocalHost() ? window.sessionStorage.getItem(API_OVERRIDE_KEY) : "";
  if (saved) return saved;

  if (isLocalHost()) {
    return "http://localhost:8787/moments-api";
  }

  return "https://williamson-wallflowers-inquiry.johnmartinferguson.workers.dev/moments-api";
}

export const apiBase = getApiBase();

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name) || "";
}

export function getHostToken(eventId) {
  const key = `${HOST_TOKEN_KEY_PREFIX}${eventId || "unknown"}`;
  return readUrlSecret("token", key);
}

export function formatDate(value) {
  if (!value) return "Date not set";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export async function requestJson(path, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs || 8000);

  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(fetchOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(fetchOptions.headers || {})
      }
    });

    const contentType = response.headers.get("Content-Type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : { message: await response.text() };

    if (!response.ok) {
      const message = payload.message || "Request failed.";
      throw new Error(message);
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function setNotice(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.className = `notice${type ? ` is-${type}` : ""}`;
  element.hidden = !message;
}

export function copyText(value, button) {
  if (!value) return;

  navigator.clipboard.writeText(value).then(() => {
    if (!button) return;
    const original = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1200);
  });
}

export function getAdminToken() {
  const legacyToken = window.localStorage.getItem(ADMIN_TOKEN_KEY);
  if (legacyToken) {
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, legacyToken);
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  }

  return readUrlSecret("adminToken", ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function clearAdminToken() {
  window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function buildGuestUrl(tagCode) {
  return `${window.location.origin}/moments/?t=${encodeURIComponent(tagCode)}`;
}

export function buildHostUrl(eventId, token) {
  return `${window.location.origin}/moments/host/?event=${encodeURIComponent(eventId)}#token=${encodeURIComponent(token)}`;
}

export function buildCapsuleUrl(eventId, token) {
  return `${window.location.origin}/moments/capsule/?event=${encodeURIComponent(eventId)}#token=${encodeURIComponent(token)}`;
}

function readUrlSecret(name, storageKey) {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fromHash = hash.get(name) || "";
  const fromQuery = query.get(name) || "";
  const saved = window.sessionStorage.getItem(storageKey) || "";
  const value = fromHash || fromQuery || saved;

  if (value) window.sessionStorage.setItem(storageKey, value);

  if (fromHash || fromQuery) {
    query.delete(name);
    hash.delete(name);

    const nextUrl = new URL(window.location.href);
    nextUrl.search = query.toString();
    nextUrl.hash = hash.toString();
    window.history.replaceState(null, "", nextUrl.toString());
  }

  return value;
}
