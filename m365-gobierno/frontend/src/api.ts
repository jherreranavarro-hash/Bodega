const KEY = 'gob-m365-token';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible: la sesión dura lo que la pestaña */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; text?: boolean } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/login') {
    setToken(null);
    onUnauthorized();
  }
  if (opts.text && res.ok) return (await res.text()) as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? (json.errors ?? []).join('; ') ?? res.statusText, json);
  return json as T;
}

export function jobEventsUrl(jobId: string) {
  return `/api/jobs/${jobId}/events?token=${encodeURIComponent(getToken() ?? '')}`;
}
