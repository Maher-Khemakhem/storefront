import { DEFAULT_LOCALE, formatMoney as formatSharedMoney, quantityNumber } from "./shared/format.js";

const SESSION_KEY = "supermarket-storefront-session";

/** Numbers and dates are French (Tunisia): 0,000 TND, 12 nov. 2026. */
export const LOCALE = DEFAULT_LOCALE;

export function readSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be blocked (private mode, policies); the session still works for this tab.
  }
  return session;
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing persisted, nothing to clear.
  }
}

export async function apiRequest(path, { method = "GET", body, token } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const error = new Error(payload?.message || (typeof payload === "string" && payload) || `La requête a échoué (${response.status})`);
    error.status = response.status;
    error.path = path;
    throw error;
  }
  return payload;
}

export function assetUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

export function formatMoney(value) {
  return formatSharedMoney(value, { locale: LOCALE, fallback: "Prix indisponible" });
}

export { quantityNumber };
