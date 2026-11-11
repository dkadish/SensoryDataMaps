// Client for BrianBackend's live read API (`/api/live/*`).
//
// BrianReactNative pushes smell-walk readings to InfluxDB through BrianBackend,
// which keeps the InfluxDB credentials. This client reads them back through the
// same backend, using the anonymous app session that the mobile app uses.

/** One 5-second flush of a walk: GPS fix plus every sensor reading. */
export interface LiveSnapshot {
  /** Epoch milliseconds. */
  time: number;
  deviceName: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  /** Sensor key (CH4, NO2, …, TempC, GasResOhm) → value. */
  readings: Record<string, number>;
}

export interface LiveWalk {
  walkId: string;
  deviceName: string | null;
  firstAt: number;
  lastAt: number;
  sensors: string[];
}

const STORAGE_URL_KEY = "sdm.brianBackendUrl";
const STORAGE_INSTALL_KEY = "sdm.brianInstallationId";

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the value just isn't remembered.
  }
}

/** The backend URL to offer by default: last one used, else the build-time one. */
export function defaultBackendUrl(): string {
  return storageGet(STORAGE_URL_KEY) ?? import.meta.env.VITE_BRIAN_BACKEND_URL ?? "";
}

export function rememberBackendUrl(url: string): void {
  storageSet(STORAGE_URL_KEY, url);
}

export function normaliseBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function installationId(): string {
  const existing = storageGet(STORAGE_INSTALL_KEY);
  if (existing) return existing;
  const id = `sdm-${crypto.randomUUID()}`;
  storageSet(STORAGE_INSTALL_KEY, id);
  return id;
}

// Session tokens per backend; they last an hour and are refreshed on a 401.
const sessions = new Map<string, Promise<string>>();

async function createSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installationId: installationId() }),
  });
  if (!response.ok) {
    throw new Error(`Could not start a backend session (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error("The backend did not return a session token.");
  return data.token;
}

function session(baseUrl: string, fresh = false): Promise<string> {
  let token = sessions.get(baseUrl);
  if (!token || fresh) {
    token = createSession(baseUrl);
    sessions.set(baseUrl, token);
    // Don't cache a failed attempt.
    token.catch(() => sessions.delete(baseUrl));
  }
  return token;
}

async function getJson<T>(baseUrl: string, path: string, signal?: AbortSignal): Promise<T> {
  const request = async (fresh: boolean) =>
    fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${await session(baseUrl, fresh)}` },
      signal,
    });

  let response: Response;
  try {
    response = await request(false);
    if (response.status === 401) response = await request(true);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(
      `Could not reach ${baseUrl}. Check the URL, and that the backend allows this site in CORS_ORIGINS.`,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Backend request failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

/** Walks with data in the last `hours` hours, most recently active first. */
export async function fetchLiveWalks(baseUrl: string, hours = 24): Promise<LiveWalk[]> {
  const data = await getJson<{ walks: LiveWalk[] }>(baseUrl, `/api/live/walks?hours=${hours}`);
  return data.walks;
}

/** A walk's snapshots newer than `since` (epoch ms), oldest first. */
export async function fetchLiveSamples(
  baseUrl: string,
  walkId: string,
  since?: number,
  signal?: AbortSignal,
): Promise<LiveSnapshot[]> {
  const query = since !== undefined ? `?since=${Math.floor(since)}` : "";
  const data = await getJson<{ samples: LiveSnapshot[] }>(
    baseUrl,
    `/api/live/walks/${encodeURIComponent(walkId)}/samples${query}`,
    signal,
  );
  return data.samples;
}
