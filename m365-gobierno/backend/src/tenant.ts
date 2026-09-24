import path from 'node:path';
import { config, currentMode, type Mode } from './config.js';
import { GraphClient, type GraphLike } from './graph/client.js';
import { SimulatedGraph } from './graph/simulated.js';
import { runPowerShell, type PsKind } from './powershell/runner.js';
import type { TenantInfo } from './engine/types.js';

let real: GraphClient | undefined;
let sim: SimulatedGraph | undefined;

export function graphFor(mode: Mode = currentMode()): GraphLike {
  if (mode === 'real') return (real ??= new GraphClient());
  return (sim ??= new SimulatedGraph(path.join(config.dataDir, 'tenant-simulado.json')));
}

export function simulatedGraph(): SimulatedGraph {
  return graphFor('simulacion') as SimulatedGraph;
}

export async function grantedRoles(mode: Mode = currentMode()): Promise<string[] | undefined> {
  if (mode !== 'real') return undefined;
  return (graphFor('real') as GraphClient).grantedRoles();
}

const tenantCache: Partial<Record<Mode, TenantInfo>> = {};

export async function tenantInfo(mode: Mode = currentMode()): Promise<TenantInfo> {
  if (tenantCache[mode]) return tenantCache[mode]!;
  const orgs = await graphFor(mode).list<any>('/organization?$select=id,displayName,countryLetterCode,verifiedDomains');
  const org = orgs[0] ?? {};
  const domains: any[] = org.verifiedDomains ?? [];
  const info: TenantInfo = {
    initialDomain: (mode === 'real' ? config.orgDomain : undefined) ?? domains.find((d) => d.isInitial)?.name,
    defaultDomain: domains.find((d) => d.isDefault)?.name,
    country: org.countryLetterCode,
  };
  tenantCache[mode] = info;
  return info;
}

export function psRunner(mode: Mode, tenant: TenantInfo, log: (m: string) => void) {
  return async (kind: PsKind, script: string): Promise<string[]> => {
    if (mode === 'simulacion') {
      const outputs = [...script.matchAll(/Write-Output "([^"]+)"/g)].map((m) => `[simulación] ${m[1].replace(/\$\(?[\w@().]+\)?/g, '…')}`);
      outputs.forEach(log);
      return outputs.length ? outputs : ['[simulación] script validado'];
    }
    return runPowerShell(kind, script, tenant.initialDomain, log);
  };
}
