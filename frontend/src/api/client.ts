const API = "/api/v1";

const ACCESS_EXPIRES_KEY = "oc_access_expires_at";
/** Refresh access token this many ms before expiry. */
const REFRESH_SKEW_MS = 60_000;
/** Floor interval so we never spin on very short TTLs. */
const MIN_REFRESH_DELAY_MS = 5_000;

export type ApiError = {
  error: string | { fieldErrors?: Record<string, string[]> };
  message?: string;
  hint?: string;
  detail?: string;
  details?: { fieldErrors?: Record<string, string[]> };
};

export type PortalUser = {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_at?: string;
  user: PortalUser;
};

type RefreshResponse = {
  access_token: string;
  expires_in: number;
  refresh_expires_at?: string;
  user: PortalUser;
};

type RefreshOutcome = "ok" | "unauthorized" | "transient";

function formatApiError(body: ApiError, fallback: string): string {
  if (body.message) return body.message;
  if (typeof body.error === "string") {
    const parts = [body.error];
    if (body.hint) parts.push(body.hint);
    if (body.detail) parts.push(body.detail);
    return parts.join(" — ");
  }
  const fields = body.details?.fieldErrors ?? body.error?.fieldErrors;
  if (fields) {
    const msgs = Object.entries(fields).flatMap(([k, v]) => (v ?? []).map((m) => `${k}: ${m}`));
    if (msgs.length) return msgs.join("; ");
  }
  return fallback;
}

export function getAccessToken(): string | null {
  return localStorage.getItem("oc_access_token");
}

export function getRefreshToken(): string | null {
  return localStorage.getItem("oc_refresh_token");
}

export function getStoredUser(): PortalUser | null {
  const raw = localStorage.getItem("oc_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalUser;
  } catch {
    localStorage.removeItem("oc_user");
    return null;
  }
}

/** Decode JWT `exp` (seconds) without verifying signature — used only for refresh scheduling. */
function readJwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function getAccessExpiresAt(): number | null {
  const raw = localStorage.getItem(ACCESS_EXPIRES_KEY);
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const token = getAccessToken();
  return token ? readJwtExpMs(token) : null;
}

function setAccessExpiresAt(expiresInSec?: number, accessToken?: string): void {
  if (typeof expiresInSec === "number" && expiresInSec > 0) {
    localStorage.setItem(ACCESS_EXPIRES_KEY, String(Date.now() + expiresInSec * 1000));
    return;
  }
  const fromJwt = accessToken ? readJwtExpMs(accessToken) : null;
  if (fromJwt) {
    localStorage.setItem(ACCESS_EXPIRES_KEY, String(fromJwt));
  }
}

export function persistSession(data: {
  access_token: string;
  user: PortalUser;
  refresh_token?: string;
  expires_in?: number;
}): void {
  localStorage.setItem("oc_access_token", data.access_token);
  localStorage.setItem("oc_user", JSON.stringify(data.user));
  if (data.refresh_token) {
    localStorage.setItem("oc_refresh_token", data.refresh_token);
  }
  setAccessExpiresAt(data.expires_in, data.access_token);
  scheduleProactiveRefresh();
}

export function clearSession(): void {
  stopProactiveRefresh();
  localStorage.removeItem("oc_access_token");
  localStorage.removeItem("oc_refresh_token");
  localStorage.removeItem("oc_user");
  localStorage.removeItem(ACCESS_EXPIRES_KEY);
}

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHooked = false;

function stopProactiveRefresh(): void {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

function ensureVisibilityHook(): void {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getRefreshToken()) {
      void ensureFreshAccessToken();
    }
  });
  window.addEventListener("focus", () => {
    if (getRefreshToken()) void ensureFreshAccessToken();
  });
}

/** Schedule refresh before access JWT expires; extends refresh-token sliding window while the tab is open. */
export function scheduleProactiveRefresh(): void {
  stopProactiveRefresh();
  ensureVisibilityHook();
  if (!getRefreshToken()) return;

  const expiresAt = getAccessExpiresAt();
  if (!expiresAt) {
    // Unknown expiry — refresh soon so we learn expires_in and extend the portal session.
    proactiveTimer = setTimeout(() => {
      void ensureFreshAccessToken();
    }, 30_000);
    return;
  }

  const delay = Math.max(MIN_REFRESH_DELAY_MS, expiresAt - Date.now() - REFRESH_SKEW_MS);
  proactiveTimer = setTimeout(() => {
    void ensureFreshAccessToken();
  }, delay);
}

/** Refresh if access token is missing, expired, or within the skew window. */
export async function ensureFreshAccessToken(): Promise<boolean> {
  if (!getRefreshToken()) return false;
  const expiresAt = getAccessExpiresAt();
  const access = getAccessToken();
  if (access && expiresAt && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    scheduleProactiveRefresh();
    return true;
  }
  const outcome = await refreshAccessToken();
  return outcome === "ok";
}

/** Exchange refresh token for a new access token (persisted in localStorage). */
export async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    const refresh = getRefreshToken();
    if (!refresh) return "unauthorized";

    let res: Response;
    try {
      res = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      // Network blip — keep tokens so the next attempt can succeed.
      scheduleProactiveRefresh();
      return "transient";
    }

    if (res.status === 401 || res.status === 403) {
      clearSession();
      return "unauthorized";
    }

    if (!res.ok) {
      scheduleProactiveRefresh();
      return "transient";
    }

    const body = (await res.json()) as RefreshResponse;
    persistSession({
      access_token: body.access_token,
      user: body.user,
      expires_in: body.expires_in,
    });
    return "ok";
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function forceLoginRedirect(): void {
  clearSession();
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

/** Restore portal session after browser reload or server restart. */
export async function restoreSession(): Promise<PortalUser | null> {
  const refresh = getRefreshToken();
  if (!refresh) {
    clearSession();
    return null;
  }

  const access = getAccessToken();
  if (access) {
    try {
      const res = await fetch(`${API}/auth/session`, { headers: authHeaders() });
      if (res.ok) {
        const body = (await res.json()) as { user: PortalUser };
        persistSession({ access_token: access, user: body.user });
        return body.user;
      }
      // Non-auth failures: keep cached identity so a blip does not look like logout.
      if (res.status !== 401 && res.status !== 403) {
        const cached = getStoredUser();
        if (cached) {
          scheduleProactiveRefresh();
          return cached;
        }
      }
    } catch {
      const cached = getStoredUser();
      if (cached) {
        scheduleProactiveRefresh();
        return cached;
      }
    }
  }

  const outcome = await refreshAccessToken();
  if (outcome === "ok") return getStoredUser();
  if (outcome === "transient") {
    const cached = getStoredUser();
    if (cached) {
      scheduleProactiveRefresh();
      return cached;
    }
  }
  return null;
}

export async function logoutSession(): Promise<void> {
  const refresh = getRefreshToken();
  try {
    await fetch(`${API}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(refresh ? { refresh_token: refresh } : {}),
    });
  } catch {
    /* best-effort revoke */
  }
  clearSession();
}

/** Fetch binary media with JWT (for img/video src — browsers do not send Authorization on plain URLs). */
export async function apiBlob(path: string, retried = false): Promise<Blob> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${API}${normalized}`, {
    headers: authHeaders(),
  });

  const isAuthRoute = normalized.startsWith("/auth/");
  if (res.status === 401 && !retried && !isAuthRoute && getRefreshToken()) {
    const outcome = await refreshAccessToken();
    if (outcome === "ok") {
      return apiBlob(path, true);
    }
    if (outcome === "transient") {
      throw new Error("Session refresh temporarily unavailable");
    }
  }

  if (res.status === 401) {
    forceLoginRedirect();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(formatApiError(body as ApiError, res.statusText));
  }

  return res.blob();
}

/** Binary POST (VRM upload). Does not set JSON Content-Type. */
export async function apiUpload<T>(
  path: string,
  body: Blob,
  filename: string,
  extraQuery?: Record<string, string>,
  retried = false,
): Promise<T> {
  const qs = new URLSearchParams({ filename, ...(extraQuery || {}) });
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${API}${normalized}?${qs.toString()}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/octet-stream",
      "X-Vrm-Filename": filename,
    },
    body,
  });

  if (res.status === 401 && !retried && getRefreshToken()) {
    const outcome = await refreshAccessToken();
    if (outcome === "ok") {
      return apiUpload<T>(path, body, filename, extraQuery, true);
    }
    if (outcome === "transient") {
      throw new Error("Session refresh temporarily unavailable");
    }
  }
  if (res.status === 401) {
    forceLoginRedirect();
    throw new Error("Unauthorized");
  }
  const json = (await res.json().catch(() => ({}))) as ApiError;
  if (!res.ok) {
    throw new Error(formatApiError(json, res.statusText));
  }
  return json as T;
}

export async function api<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init?.headers,
    },
  });

  const isLogin = path.startsWith("/auth/login");
  const isRefresh = path.startsWith("/auth/refresh");
  const isAuthRoute = isLogin || isRefresh;

  if (res.status === 401 && !retried && !isAuthRoute && getRefreshToken()) {
    const outcome = await refreshAccessToken();
    if (outcome === "ok") {
      return api<T>(path, init, true);
    }
    if (outcome === "transient") {
      throw new Error("Session refresh temporarily unavailable");
    }
  }

  if (res.status === 401) {
    // Failed login must not wipe an existing browser session.
    if (isLogin) {
      const body = await res.json().catch(() => ({}));
      throw new Error(formatApiError(body as ApiError, "Unauthorized"));
    }
    forceLoginRedirect();
    throw new Error("Unauthorized");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatApiError(body as ApiError, res.statusText));
  }
  return body as T;
}

export { type DbInstance } from "../types";
