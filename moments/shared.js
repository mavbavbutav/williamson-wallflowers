const API_OVERRIDE_KEY = "wallflowerMomentsApi";

export function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("api");

  if (explicit) {
    window.localStorage.setItem(API_OVERRIDE_KEY, explicit.replace(/\/$/, ""));
    return explicit.replace(/\/$/, "");
  }

  const saved = window.localStorage.getItem(API_OVERRIDE_KEY);
  if (saved) return saved;

  if (["localhost", "127.0.0.1", ""].includes(window.location.hostname)) {
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
  const params = new URLSearchParams(window.location.search);
  const token = params.get("adminToken") || window.localStorage.getItem("wallflowerMomentsAdminToken") || "";
  if (token) window.localStorage.setItem("wallflowerMomentsAdminToken", token);
  return token;
}

export function setAdminToken(token) {
  window.localStorage.setItem("wallflowerMomentsAdminToken", token);
}

export function clearAdminToken() {
  window.localStorage.removeItem("wallflowerMomentsAdminToken");
}

export function buildGuestUrl(tagCode) {
  return `${window.location.origin}/moments/?t=${encodeURIComponent(tagCode)}`;
}

export function buildHostUrl(eventId, token) {
  return `${window.location.origin}/moments/host/?event=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`;
}
