const SESSION_KEY = "supermarket-storefront-session";

export function readSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
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
    throw new Error(payload?.message || payload || `Request failed (${response.status})`);
  }
  return payload;
}

export function assetUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

export function formatMoney(value) {
  const amount = Number.parseFloat(
    String(value ?? "").replace(/\s*TND\s*$/i, "")
  );
  return Number.isFinite(amount) ? `${amount.toFixed(3)} TND` : "Price unavailable";
}

export function quantityNumber(quantity) {
  const value = Number.parseFloat(String(quantity || "0").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}
