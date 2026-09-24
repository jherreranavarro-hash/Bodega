import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = '66666666-7777-8888-9999-000000000000';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;

let app: any;
let token: string;
let delegated: typeof import('../src/auth/delegated.js');
let nextClaims: Record<string, unknown>;
const tokenCalls: URLSearchParams[] = [];

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gob-del-'));
  process.env.APP_PASSWORD = 'clave';
  delegated = await import('../src/auth/delegated.js');
  delegated.setFetch((async (_url: string, init: any) => {
    const form = new URLSearchParams(init.body);
    tokenCalls.push(form);
    const nonce = (globalThis as any).__nonce;
    return new Response(
      JSON.stringify({
        access_token: jwt({ tid: TENANT, scp: 'Policy.Read.All Group.ReadWrite.All', wids: ['62e90394-69f5-4237-9190-012177145e10'], ...nextClaims }),
        refresh_token: `rt-${tokenCalls.length}`,
        id_token: jwt({ preferred_username: 'admin@contoso.cl', name: 'Admin', nonce }),
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as any);
  const { createApp } = await import('../src/app.js');
  app = createApp();
  token = (await request(app).post('/api/login').send({ password: 'clave' })).body.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createEnv(body: object) {
  return request(app).post('/api/environments').set(auth()).send(body);
}

async function signIn(envId: string) {
  const { url } = (await request(app).post(`/api/auth/login/${envId}`).set(auth())).body;
  const u = new URL(url);
  (globalThis as any).__nonce = u.searchParams.get('nonce');
  return request(app).get(`/api/auth/callback?code=abc&state=${u.searchParams.get('state')}`);
}

describe('ambientes e inicio de sesión del administrador', () => {
  let prdId: string;

  it('valida los identificadores del ambiente', async () => {
    const bad = await createEnv({ name: 'PRD', tier: 'prd', tenantId: 'no-es-guid', clientId: '123' });
    expect(bad.status).toBe(400);
    const ok = await createEnv({ name: 'PRD', tier: 'prd', tenantId: TENANT, clientId: CLIENT, adminUpn: 'Admin@Contoso.cl', orgDomain: 'contoso.onmicrosoft.com' });
    expect(ok.status).toBe(201);
    expect(ok.body.connected).toBe(false);
    prdId = ok.body.id;
    expect((await createEnv({ name: 'prd', tier: 'dev', tenantId: TENANT, clientId: CLIENT })).status).toBe(409);
  });

  it('arma la URL de Microsoft con PKCE, login_hint y prompt=login (la contraseña se escribe en Microsoft)', async () => {
    const { url } = (await request(app).post(`/api/auth/login/${prdId}`).set(auth())).body;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('login_hint')).toBe('admin@contoso.cl');
    expect(u.searchParams.get('prompt')).toBe('login');
    expect(u.searchParams.get('client_id')).toBe(CLIENT);
  });

  it('rechaza sesiones sin MFA', async () => {
    nextClaims = { amr: ['pwd'] };
    const r = await signIn(prdId);
    expect(r.headers.location).toMatch(/login=error.*MFA/);
    expect(delegated.sessionInfo(prdId)).toBeNull();
  });

  it('rechaza cuentas de otro tenant', async () => {
    nextClaims = { amr: ['pwd', 'mfa'], tid: '99999999-2222-3333-4444-555555555555' };
    const r = await signIn(prdId);
    expect(decodeURIComponent(r.headers.location)).toMatch(/otro tenant/);
  });

  it('rechaza un state desconocido', async () => {
    const r = await request(app).get('/api/auth/callback?code=x&state=inventado');
    expect(r.headers.location).toMatch(/login=error/);
  });

  it('acepta la sesión con MFA y la usa para Graph (y renueva tokens)', async () => {
    nextClaims = { amr: ['pwd', 'mfa'] };
    const r = await signIn(prdId);
    expect(r.headers.location).toMatch(/login=ok/);
    const last = tokenCalls.at(-1)!;
    expect(last.get('grant_type')).toBe('authorization_code');
    expect(last.get('code_verifier')).toBeTruthy();
    expect(last.get('client_secret')).toBeNull();
    const envs = (await request(app).get('/api/environments').set(auth())).body.environments;
    const prd = envs.find((e: any) => e.id === prdId);
    expect(prd.session.account).toBe('admin@contoso.cl');
    expect(prd.session.globalAdmin).toBe(true);

    const env = { id: prdId, name: 'PRD', kind: 'delegado', tier: 'prd', tenantId: TENANT, clientId: CLIENT } as const;
    const exo = await delegated.delegatedToken(env, delegated.EXO_SCOPE);
    expect(exo).toBeTruthy();
    const refresh = tokenCalls.at(-1)!;
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('scope')).toContain('outlook.office365.com');
  });

  it('producción exige escribir el nombre del ambiente para desplegar', async () => {
    await request(app).post(`/api/environments/${prdId}/activate`).set(auth()).expect(200);
    const items = [{ playbookId: 'entra-tap' }];
    const r1 = await request(app).post('/api/deploy').set(auth()).send({ items, confirm: true });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/escribe "PRD"/);
  });

  it('sin sesión el ambiente pide iniciar sesión (403, no cierra la sesión de la app)', async () => {
    await request(app).post(`/api/auth/logout/${prdId}`).set(auth()).expect(200);
    const r = await request(app).post('/api/deploy').set(auth()).send({ items: [{ playbookId: 'entra-tap' }], confirm: true, confirmText: 'PRD' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Inicia sesión/);
  });

  it('cambiar el tenant de un ambiente invalida su sesión', async () => {
    nextClaims = { amr: ['mfa'] };
    await signIn(prdId);
    expect(delegated.sessionInfo(prdId)).not.toBeNull();
    await request(app)
      .put(`/api/environments/${prdId}`)
      .set(auth())
      .send({ name: 'PRD', tier: 'prd', tenantId: 'aaaaaaaa-2222-3333-4444-555555555555', clientId: CLIENT, adminUpn: 'admin@contoso.cl' })
      .expect(200);
    expect(delegated.sessionInfo(prdId)).toBeNull();
  });
});
