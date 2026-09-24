import crypto from 'node:crypto';
import { config, graphConfigured } from './config.js';
import { load, save } from './store.js';

/**
 * Ambientes de trabajo. Cada uno apunta a un tenant (DEV, POC, PRD…) con su propio registro de
 * aplicación. Solo se guardan identificadores (no son secretos): la contraseña y el MFA del
 * administrador se ingresan en la página de Microsoft y aquí solo se reciben tokens.
 */
export type Tier = 'dev' | 'poc' | 'prd';
export type EnvKind = 'simulacion' | 'aplicacion' | 'delegado';

export interface StoredEnvironment {
  id: string;
  name: string;
  tier: Tier;
  tenantId: string;
  clientId: string;
  orgDomain?: string;
  adminUpn?: string;
  createdAt: string;
}

export interface EnvRef {
  id: string;
  name: string;
  kind: EnvKind;
  tier: Tier | 'sim';
  tenantId?: string;
  clientId?: string;
  orgDomain?: string;
  adminUpn?: string;
}

export const SIM_ENV: EnvRef = { id: 'simulacion', name: 'Simulación', kind: 'simulacion', tier: 'sim' };
/** Registro con secreto/certificado definido en backend/.env (sin intervención humana). Se trata como producción. */
export const APP_ENV_ID = 'aplicacion';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const UPN = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const TIERS: Tier[] = ['dev', 'poc', 'prd'];

function appEnv(): EnvRef | undefined {
  if (config.forceSimulation || !graphConfigured()) return undefined;
  return {
    id: APP_ENV_ID,
    name: 'Aplicación (.env)',
    kind: 'aplicacion',
    tier: 'prd',
    tenantId: config.tenantId,
    clientId: config.clientId,
    orgDomain: config.orgDomain,
  };
}

const toRef = (e: StoredEnvironment): EnvRef => ({ ...e, kind: 'delegado' });

export function listEnvironments(): EnvRef[] {
  const stored = (load().environments as StoredEnvironment[]).map(toRef);
  const app = appEnv();
  return [SIM_ENV, ...(app ? [app] : []), ...stored];
}

export function getEnvironment(id: string): EnvRef | undefined {
  return listEnvironments().find((e) => e.id === id);
}

export function activeEnvironment(): EnvRef {
  const s = load();
  return getEnvironment(s.activeEnv) ?? appEnv() ?? SIM_ENV;
}

export function setActiveEnvironment(id: string): EnvRef {
  const env = getEnvironment(id);
  if (!env) throw Object.assign(new Error('Ambiente inexistente'), { status: 404 });
  save((s) => {
    s.activeEnv = id;
  });
  return env;
}

export function validateEnvironment(input: any): Omit<StoredEnvironment, 'id' | 'createdAt'> {
  const errors: string[] = [];
  const name = String(input?.name ?? '').trim().slice(0, 40);
  const tier = String(input?.tier ?? '') as Tier;
  const tenantId = String(input?.tenantId ?? '').trim();
  const clientId = String(input?.clientId ?? '').trim();
  const orgDomain = String(input?.orgDomain ?? '').trim().toLowerCase();
  const adminUpn = String(input?.adminUpn ?? '').trim().toLowerCase();
  if (!name) errors.push('Indica un nombre (ej. PRD)');
  if (!TIERS.includes(tier)) errors.push('Tipo de ambiente inválido (dev, poc o prd)');
  if (!GUID.test(tenantId) && !DOMAIN.test(tenantId)) errors.push('Tenant ID debe ser un GUID o un dominio (contoso.onmicrosoft.com)');
  if (!GUID.test(clientId)) errors.push('Client ID (Id. de aplicación) debe ser un GUID');
  if (orgDomain && !DOMAIN.test(orgDomain)) errors.push('Dominio inicial inválido');
  if (adminUpn && !UPN.test(adminUpn)) errors.push('Cuenta de administrador inválida (usuario@dominio)');
  if (errors.length) throw Object.assign(new Error(errors.join('. ')), { status: 400 });
  return { name, tier, tenantId, clientId, orgDomain: orgDomain || undefined, adminUpn: adminUpn || undefined };
}

export function createEnvironment(input: unknown): EnvRef {
  const data = validateEnvironment(input);
  if (listEnvironments().some((e) => e.name.toLowerCase() === data.name.toLowerCase())) {
    throw Object.assign(new Error(`Ya existe un ambiente llamado ${data.name}`), { status: 409 });
  }
  const env: StoredEnvironment = { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  save((s) => {
    s.environments.push(env);
  });
  return toRef(env);
}

export function updateEnvironment(id: string, input: unknown): EnvRef {
  const data = validateEnvironment(input);
  let updated: StoredEnvironment | undefined;
  save((s) => {
    const envs = s.environments as StoredEnvironment[];
    const i = envs.findIndex((e) => e.id === id);
    if (i >= 0) envs[i] = updated = { ...envs[i], ...data };
  });
  if (!updated) throw Object.assign(new Error('Ambiente inexistente'), { status: 404 });
  return toRef(updated);
}

export function deleteEnvironment(id: string) {
  save((s) => {
    s.environments = (s.environments as StoredEnvironment[]).filter((e) => e.id !== id);
    if (s.activeEnv === id) s.activeEnv = SIM_ENV.id;
  });
}

export const modeOf = (env: EnvRef) => (env.kind === 'simulacion' ? 'simulacion' : 'real') as 'simulacion' | 'real';
