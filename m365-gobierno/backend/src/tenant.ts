import path from 'node:path';
import { config } from './config.js';
import { GraphClient, type GraphLike } from './graph/client.js';
import { SimulatedGraph } from './graph/simulated.js';
import { runPowerShell, type PsKind } from './powershell/runner.js';
import type { TenantInfo } from './engine/types.js';
import type { EnvRef } from './environments.js';
import { EXO_SCOPE, IPPS_SCOPE, delegatedToken, signedInAccount, NotSignedInError } from './auth/delegated.js';

/** Clientes de Graph por ambiente (la clave incluye tenant y app para invalidar si cambian). */
const clients = new Map<string, GraphLike>();
let sim: SimulatedGraph | undefined;

const keyOf = (env: EnvRef) => `${env.id}|${env.tenantId ?? ''}|${env.clientId ?? ''}`;

export function simulatedGraph(): SimulatedGraph {
  return (sim ??= new SimulatedGraph(path.join(config.dataDir, 'tenant-simulado.json')));
}

export function graphFor(env: EnvRef): GraphLike {
  if (env.kind === 'simulacion') return simulatedGraph();
  const key = keyOf(env);
  let c = clients.get(key);
  if (!c) {
    c = env.kind === 'aplicacion' ? new GraphClient() : new GraphClient(() => delegatedToken(env));
    clients.set(key, c);
  }
  return c;
}

export async function grantedRoles(env: EnvRef): Promise<string[] | undefined> {
  if (env.kind === 'simulacion') return undefined;
  return (graphFor(env) as GraphClient).grantedRoles();
}

const tenantCache = new Map<string, TenantInfo>();

export function forgetTenant(env: EnvRef) {
  tenantCache.delete(keyOf(env));
  clients.delete(keyOf(env));
}

export async function tenantInfo(env: EnvRef): Promise<TenantInfo> {
  const key = keyOf(env);
  if (tenantCache.has(key)) return tenantCache.get(key)!;
  const orgs = await graphFor(env).list<any>('/organization?$select=id,displayName,countryLetterCode,verifiedDomains');
  const org = orgs[0] ?? {};
  const domains: any[] = org.verifiedDomains ?? [];
  const info: TenantInfo = {
    initialDomain: env.orgDomain ?? domains.find((d) => d.isInitial)?.name,
    defaultDomain: domains.find((d) => d.isDefault)?.name,
    country: org.countryLetterCode,
  };
  tenantCache.set(key, info);
  return info;
}

export function psRunner(env: EnvRef, tenant: TenantInfo, log: (m: string) => void) {
  return async (kind: PsKind, script: string): Promise<string[]> => {
    if (env.kind === 'simulacion') {
      const outputs = [...script.matchAll(/Write-Output "([^"]+)"/g)].map((m) => `[simulación] ${m[1].replace(/\$\(?[\w@().]+\)?/g, '…')}`);
      outputs.forEach(log);
      return outputs.length ? outputs : ['[simulación] script validado'];
    }
    const organization = tenant.initialDomain ?? '';
    if (env.kind === 'aplicacion') return runPowerShell(kind, script, { type: 'cert', organization }, log);
    const upn = signedInAccount(env.id);
    if (!upn) throw new NotSignedInError(`Inicia sesión en ${env.name} para ejecutar PowerShell`);
    const token = await delegatedToken(env, kind === 'exo' ? EXO_SCOPE : IPPS_SCOPE);
    return runPowerShell(kind, script, { type: 'token', organization, upn, token }, log);
  };
}
