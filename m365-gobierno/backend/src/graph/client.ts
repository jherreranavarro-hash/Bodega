import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from '../config.js';

export interface RequestOptions {
  beta?: boolean;
  headers?: Record<string, string>;
}

/** Superficie mínima de Microsoft Graph que usan playbooks y assessment. */
export interface GraphLike {
  get<T = any>(path: string, opts?: RequestOptions): Promise<T>;
  /** Recorre @odata.nextLink hasta `max` elementos. */
  list<T = any>(path: string, opts?: RequestOptions & { max?: number }): Promise<T[]>;
  post<T = any>(path: string, body: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = any>(path: string, body: unknown, opts?: RequestOptions): Promise<T>;
  put<T = any>(path: string, body: unknown, opts?: RequestOptions): Promise<T>;
  delete(path: string, opts?: RequestOptions): Promise<void>;
}

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public path: string,
  ) {
    super(message);
  }
}

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com';

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Firma un client_assertion (RFC 7523) con el certificado PEM configurado. */
function clientAssertion(tenantId: string, clientId: string, pemPath: string): string {
  const pem = fs.readFileSync(pemPath, 'utf8');
  const certBlock = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!certBlock) throw new Error(`CERT_PEM_PATH no contiene un bloque CERTIFICATE: ${pemPath}`);
  const cert = new crypto.X509Certificate(certBlock[0]);
  const key = crypto.createPrivateKey(pem);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', x5t: b64url(crypto.createHash('sha1').update(cert.raw).digest()) };
  const payload = {
    aud: `${LOGIN}/${tenantId}/oauth2/v2.0/token`,
    iss: clientId,
    sub: clientId,
    jti: crypto.randomUUID(),
    nbf: now,
    exp: now + 600,
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), key);
  return `${data}.${b64url(sig)}`;
}

export function decodeJwt(token: string): Record<string, any> {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GraphClient implements GraphLike {
  private token?: { value: string; exp: number };

  constructor(private fetchImpl: typeof fetch = fetch) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.exp - 120 > Date.now() / 1000) return this.token.value;
    const { tenantId, clientId, clientSecret, certPemPath } = config;
    if (!tenantId || !clientId) throw new Error('TENANT_ID y CLIENT_ID no están configurados');
    const form = new URLSearchParams({
      client_id: clientId,
      scope: `${GRAPH}/.default`,
      grant_type: 'client_credentials',
    });
    if (certPemPath) {
      form.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      form.set('client_assertion', clientAssertion(tenantId, clientId, certPemPath));
    } else if (clientSecret) {
      form.set('client_secret', clientSecret);
    } else {
      throw new Error('Configura CLIENT_SECRET o CERT_PEM_PATH');
    }
    const res = await this.fetchImpl(`${LOGIN}/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GraphError(res.status, json.error ?? 'token_error', json.error_description ?? 'No se pudo obtener token', 'token');
    }
    this.token = { value: json.access_token, exp: Math.floor(Date.now() / 1000) + Number(json.expires_in ?? 3600) };
    return this.token.value;
  }

  /** Permisos de aplicación (roles) concedidos, leídos del token. */
  async grantedRoles(): Promise<string[]> {
    const claims = decodeJwt(await this.accessToken());
    return Array.isArray(claims.roles) ? claims.roles : [];
  }

  private url(path: string, beta?: boolean) {
    if (/^https:\/\//.test(path)) return path;
    return `${GRAPH}/${beta ? 'beta' : 'v1.0'}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  async request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const url = this.url(path, opts.beta);
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
        const retry = Number(res.headers.get('Retry-After')) || 2 ** (attempt + 1);
        await sleep(Math.min(retry, 30) * 1000);
        continue;
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const json = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        const err = json?.error ?? {};
        throw new GraphError(res.status, err.code ?? String(res.status), err.message ?? res.statusText, path);
      }
      return json as T;
    }
  }

  get<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, undefined, opts);
  }
  async list<T>(path: string, opts: RequestOptions & { max?: number } = {}): Promise<T[]> {
    const max = opts.max ?? 5000;
    const out: T[] = [];
    let next: string | undefined = path;
    while (next && out.length < max) {
      const page: any = await this.request('GET', next, undefined, opts);
      out.push(...(page?.value ?? []));
      next = page?.['@odata.nextLink'];
    }
    return out.slice(0, max);
  }
  post<T>(path: string, body: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, body, opts);
  }
  patch<T>(path: string, body: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, body, opts);
  }
  put<T>(path: string, body: unknown, opts?: RequestOptions) {
    return this.request<T>('PUT', path, body, opts);
  }
  async delete(path: string, opts?: RequestOptions) {
    await this.request('DELETE', path, undefined, opts);
  }
}
