import crypto from 'node:crypto';
import { config } from '../config.js';
import type { EnvRef } from '../environments.js';
import { decodeJwt } from '../graph/client.js';

/**
 * Inicio de sesión del administrador con su propia cuenta (permisos delegados).
 *
 * Flujo OAuth 2.0 "authorization code + PKCE": el navegador va a login.microsoftonline.com,
 * el administrador escribe su contraseña y aprueba el MFA EN LA PÁGINA DE MICROSOFT, y
 * Microsoft devuelve un código que se canjea por tokens. Esta aplicación nunca ve ni guarda la
 * contraseña, y rechaza sesiones que no se hayan validado con MFA.
 *
 * Los tokens viven solo en memoria: al reiniciar el servidor o tras 8 h sin uso hay que volver a
 * iniciar sesión (con MFA).
 */

const LOGIN = 'https://login.microsoftonline.com';
export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
export const EXO_SCOPE = 'https://outlook.office365.com/.default';
export const IPPS_SCOPE = 'https://ps.compliance.protection.outlook.com/.default';

const GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10';
/** Valores de `amr` que prueban autenticación multifactor (MFA, Windows Hello, FIDO2). */
const MFA_AMR = ['mfa', 'ngcmfa', 'fido', 'rsa'];
const PENDING_TTL = 10 * 60 * 1000;
const IDLE_TTL = 8 * 60 * 60 * 1000;

export class NotSignedInError extends Error {
  // 403 (no 401): la sesión de la aplicación sigue válida, falta la del tenant
  status = 403;
  code = 'no_signed_in';
}

interface Pending {
  envId: string;
  tenantId: string;
  clientId: string;
  adminUpn?: string;
  verifier: string;
  nonce: string;
  createdAt: number;
}

interface Session {
  envId: string;
  tenantId: string;
  clientId: string;
  account: string;
  name?: string;
  scopes: string[];
  globalAdmin: boolean;
  amr: string[];
  refreshToken: string;
  tokens: Map<string, { value: string; exp: number }>;
  signedInAt: number;
  lastUsed: number;
}

export interface SessionInfo {
  account: string;
  name?: string;
  scopes: string[];
  globalAdmin: boolean;
  amr: string[];
  signedInAt: string;
  expiresAt: string;
}

const pending = new Map<string, Pending>();
const sessions = new Map<string, Session>();
let fetchImpl: typeof fetch = (...a) => fetch(...a);

/** Solo para pruebas. */
export function setFetch(f: typeof fetch) {
  fetchImpl = f;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export const redirectUri = () => `${config.publicUrl}/api/auth/callback`;

export function startLogin(env: EnvRef): string {
  if (env.kind !== 'delegado' || !env.tenantId || !env.clientId) throw new Error('Este ambiente no usa inicio de sesión de administrador');
  const now = Date.now();
  for (const [k, p] of pending) if (now - p.createdAt > PENDING_TTL) pending.delete(k);
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const nonce = b64url(crypto.randomBytes(16));
  pending.set(state, { envId: env.id, tenantId: env.tenantId, clientId: env.clientId, adminUpn: env.adminUpn, verifier, nonce, createdAt: now });
  const q = new URLSearchParams({
    client_id: env.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: `${GRAPH_SCOPE} offline_access openid profile`,
    state,
    nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    // Siempre se pide escribir credenciales de nuevo (no reutiliza una sesión abierta en el navegador)
    prompt: 'login',
  });
  if (env.adminUpn) q.set('login_hint', env.adminUpn);
  return `${LOGIN}/${encodeURIComponent(env.tenantId)}/oauth2/v2.0/authorize?${q}`;
}

async function tokenRequest(tenantId: string, form: Record<string, string>) {
  const res = await fetchImpl(`${LOGIN}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(json.error_description ?? json.error ?? `HTTP ${res.status}`).split('\r\n')[0];
    throw Object.assign(new Error(`Microsoft rechazó el inicio de sesión: ${msg}`), { status: 403 });
  }
  return json as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number };
}

/** Canjea el código del callback. Devuelve el id del ambiente al que quedó conectado. */
export async function completeLogin(query: Record<string, unknown>): Promise<{ envId: string; info: SessionInfo }> {
  const state = String(query.state ?? '');
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.createdAt > PENDING_TTL) throw new Error('La solicitud de inicio de sesión expiró o no es válida. Inténtalo de nuevo.');
  if (query.error) throw new Error(`Microsoft devolvió un error: ${String(query.error_description ?? query.error)}`);
  const code = String(query.code ?? '');
  if (!code) throw new Error('Microsoft no devolvió un código de autorización');

  const tok = await tokenRequest(p.tenantId, {
    client_id: p.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: p.verifier,
    scope: `${GRAPH_SCOPE} offline_access openid profile`,
  });
  const claims = decodeJwt(tok.access_token);
  const id = tok.id_token ? decodeJwt(tok.id_token) : {};
  if (id.nonce && id.nonce !== p.nonce) throw new Error('El token no corresponde a esta solicitud (nonce)');
  const account = String(id.preferred_username ?? claims.upn ?? claims.unique_name ?? '').toLowerCase();
  const amr: string[] = Array.isArray(claims.amr) ? claims.amr : [];

  if (/^[0-9a-f-]{36}$/i.test(p.tenantId) && claims.tid && claims.tid.toLowerCase() !== p.tenantId.toLowerCase()) {
    throw new Error(`La cuenta ${account} pertenece a otro tenant (${claims.tid}), no al configurado en este ambiente.`);
  }
  if (p.adminUpn && account !== p.adminUpn.toLowerCase()) {
    throw new Error(`Se inició sesión con ${account}, pero este ambiente está asignado a ${p.adminUpn}.`);
  }
  if (!amr.some((m) => MFA_AMR.includes(m))) {
    throw new Error(
      'La sesión no se validó con MFA. Esta aplicación exige MFA para administrar el tenant: registra Microsoft Authenticator o una llave FIDO2 en la cuenta (o aplica la política CA01) y vuelve a intentarlo.',
    );
  }
  if (!tok.refresh_token) throw new Error('Microsoft no entregó refresh token (falta el permiso offline_access)');

  const wids: string[] = Array.isArray(claims.wids) ? claims.wids : [];
  const now = Date.now();
  const session: Session = {
    envId: p.envId,
    tenantId: claims.tid ?? p.tenantId,
    clientId: p.clientId,
    account,
    name: id.name ?? claims.name,
    scopes: String(claims.scp ?? '').split(' ').filter(Boolean),
    globalAdmin: wids.includes(GLOBAL_ADMIN),
    amr,
    refreshToken: tok.refresh_token,
    tokens: new Map([[GRAPH_SCOPE, { value: tok.access_token, exp: now + tok.expires_in * 1000 }]]),
    signedInAt: now,
    lastUsed: now,
  };
  sessions.set(p.envId, session);
  return { envId: p.envId, info: info(session) };
}

function info(s: Session): SessionInfo {
  return {
    account: s.account,
    name: s.name,
    scopes: s.scopes,
    globalAdmin: s.globalAdmin,
    amr: s.amr,
    signedInAt: new Date(s.signedInAt).toISOString(),
    expiresAt: new Date(s.lastUsed + IDLE_TTL).toISOString(),
  };
}

function live(envId: string): Session | undefined {
  const s = sessions.get(envId);
  if (s && Date.now() - s.lastUsed > IDLE_TTL) {
    sessions.delete(envId);
    return undefined;
  }
  return s;
}

export function sessionInfo(envId: string): SessionInfo | null {
  const s = live(envId);
  return s ? info(s) : null;
}

export function logout(envId: string) {
  sessions.delete(envId);
}

/** Token de acceso para un recurso (Graph, Exchange, Purview), renovándolo con el refresh token. */
export async function delegatedToken(env: EnvRef, scope = GRAPH_SCOPE): Promise<string> {
  const s = live(env.id);
  if (!s || s.clientId !== env.clientId) {
    throw new NotSignedInError(`Inicia sesión con la cuenta de administrador de ${env.name} (contraseña + MFA de Microsoft).`);
  }
  s.lastUsed = Date.now();
  const cached = s.tokens.get(scope);
  if (cached && cached.exp - 120_000 > Date.now()) return cached.value;
  let tok;
  try {
    tok = await tokenRequest(s.tenantId, {
      client_id: s.clientId,
      grant_type: 'refresh_token',
      refresh_token: s.refreshToken,
      scope: `${scope} offline_access`,
    });
  } catch (e) {
    if (scope === GRAPH_SCOPE) sessions.delete(env.id);
    throw e;
  }
  if (tok.refresh_token) s.refreshToken = tok.refresh_token;
  s.tokens.set(scope, { value: tok.access_token, exp: Date.now() + tok.expires_in * 1000 });
  return tok.access_token;
}

export function signedInAccount(envId: string): string | undefined {
  return live(envId)?.account;
}
