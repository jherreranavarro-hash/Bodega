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

/**
 * Redirige a la página de inicio de sesión de Microsoft. La contraseña y el MFA del administrador
 * se ingresan allí (nunca en esta aplicación); Microsoft vuelve a /api/auth/callback.
 */
export async function signInWithMicrosoft(envId: string) {
  const { url } = await api<{ url: string }>(`/auth/login/${envId}`, { body: {} });
  window.location.assign(url);
}

/**
 * Abre un documento generado por el backend en una pestaña nueva. Se descarga con la cabecera
 * de sesión (el token no viaja en la URL) y se muestra como blob; desde ahí se imprime a PDF.
 */
export async function openDocument(path: string, query: Record<string, string | undefined> = {}) {
  const win = window.open('', '_blank');
  if (win) win.document.write('<p style="font-family:sans-serif;padding:24px">Generando documento…</p>');
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
  const res = await fetch(`/api${path}${q.toString() ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error ?? 'No se pudo generar el documento';
    win?.close();
    throw new Error(msg);
  }
  const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) throw new Error('No se pudo descargar');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
