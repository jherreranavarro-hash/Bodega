import { describe, expect, it } from 'vitest';
import { SimulatedGraph, demoTenant } from '../src/graph/simulated.js';
import { PLAYBOOKS, getPlaybook } from '../src/playbooks/index.js';
import { TILES } from '../src/catalog/tiles.js';
import { executePlan, missingPermissions, normalizeParams, resolvePlan } from '../src/engine/runner.js';
import { diff, psHash, psq } from '../src/engine/helpers.js';
import { CA_NAMES } from '../src/playbooks/entra.js';
import type { Params } from '../src/engine/types.js';

const tenant = { initialDomain: 'contosodemo.onmicrosoft.com', defaultDomain: 'contoso-demo.cl', country: 'CL' };

function run(graph: SimulatedGraph, items: { playbookId: string; params?: Params }[], dryRun = false) {
  const { items: resolved, errors } = resolvePlan(items);
  expect(errors).toEqual([]);
  return executePlan(resolved, {
    graph,
    mode: 'simulacion',
    dryRun,
    tenant,
    runPowerShell: async () => ['ok'],
  });
}

describe('catálogo', () => {
  it('todas las cajas referenciadas por playbooks existen en el mapa', () => {
    const ids = new Set(TILES.map((t) => t.id));
    expect(ids.size).toBe(TILES.length);
    for (const pb of PLAYBOOKS) for (const t of pb.tiles) expect(ids, `${pb.id} → ${t}`).toContain(t);
  });

  it('ids únicos, dependencias válidas y sin ciclos', () => {
    expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
    const { items, errors } = resolvePlan(PLAYBOOKS.map((p) => ({ playbookId: p.id })));
    expect(errors).toEqual([]);
    expect(items).toHaveLength(PLAYBOOKS.length);
    const pos = new Map(items.map((i, n) => [i.playbook.id, n]));
    for (const i of items) {
      const deps = typeof i.playbook.dependsOn === 'function' ? i.playbook.dependsOn(i.params) : i.playbook.dependsOn ?? [];
      for (const d of deps) expect(pos.get(d)!, `${d} antes de ${i.playbook.id}`).toBeLessThan(pos.get(i.playbook.id)!);
    }
  });

  it('cada playbook automatizado tiene implementación', () => {
    for (const pb of PLAYBOOKS) {
      if (pb.engine === 'graph') expect(pb.run, pb.id).toBeTypeOf('function');
      if (pb.engine === 'exo' || pb.engine === 'ipps') expect(pb.script, pb.id).toBeTypeOf('function');
      if (pb.engine === 'manual') expect(pb.manualSteps?.length, pb.id).toBeGreaterThan(0);
    }
  });
});

describe('parámetros', () => {
  it('acota números, valida selecciones y aplica presets de perfil', () => {
    const pb = getPlaybook('intune-update-ring')!;
    expect(normalizeParams(pb, { qualityDeferral: 999 }).qualityDeferral).toBe(30);
    const ca = getPlaybook('entra-ca-admins-mfa')!;
    expect(normalizeParams(ca, { state: 'hackeado' }).state).toBe('enabled');
    expect(normalizeParams(ca, {}, 'estricto').strength).toBe('phishingResistant');
    expect(normalizeParams(getPlaybook('entra-named-locations')!, { countries: 'CL\nAR\n' }).countries).toEqual(['CL', 'AR']);
  });

  it('agrega dependencias según parámetros', () => {
    const { items } = resolvePlan([{ playbookId: 'entra-ca-admins-mfa', params: { strength: 'phishingResistant' } }]);
    expect(items.map((i) => i.playbook.id)).toEqual(expect.arrayContaining(['entra-emergency-access', 'entra-fido2']));
    expect(items.find((i) => i.playbook.id === 'entra-fido2')!.autoAdded).toBe(true);
  });
});

describe('ejecución en tenant simulado', () => {
  it('despliega todo el catálogo sin errores y es idempotente', async () => {
    const graph = new SimulatedGraph(undefined, demoTenant);
    const all = PLAYBOOKS.map((p) => ({ playbookId: p.id, params: normalizeParams(p, { upns: ['usuario1@contoso-demo.cl'], units: ['Ventas'], state: 'enabled' }, 'estricto') }));
    const first = await run(graph, all);
    const errors = first.filter((r) => r.status === 'error' || r.status === 'omitido');
    expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);

    const second = await run(graph, all);
    for (const r of second.filter((x) => x.engine === 'graph')) {
      const changes = r.steps.filter((s) => s.action === 'crear' || s.action === 'actualizar');
      expect(changes, `${r.playbookId}: ${JSON.stringify(changes)}`).toEqual([]);
    }
  });

  it('la previsualización no escribe en el tenant', async () => {
    const graph = new SimulatedGraph(undefined, demoTenant);
    await run(graph, PLAYBOOKS.map((p) => ({ playbookId: p.id })), true);
    expect(graph.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('CA excluye el grupo de emergencia real', async () => {
    const graph = new SimulatedGraph(undefined, demoTenant);
    await run(graph, [{ playbookId: 'entra-ca-block-legacy' }]);
    const group = (await graph.list<any>('/groups')).find((g) => g.displayName.includes('Emergencia'));
    const policy = (await graph.list<any>('/identity/conditionalAccess/policies'))[0];
    expect(policy.conditions.users.excludeGroups).toEqual([group.id]);
    expect(policy.state).toBe('enabledForReportingButNotEnforced');
  });
});

describe('valores predeterminados de seguridad', () => {
  it('no los desactiva si la línea base de MFA no quedaría aplicada', async () => {
    const graph = new SimulatedGraph(undefined, demoTenant);
    const res = await run(graph, [
      { playbookId: 'entra-ca-all-users-mfa', params: { state: 'enabledForReportingButNotEnforced' } },
      { playbookId: 'entra-security-defaults' },
    ]);
    expect(res.find((r) => r.playbookId === 'entra-security-defaults')!.status).toBe('error');
    expect((await graph.get<any>('/policies/identitySecurityDefaultsEnforcementPolicy')).isEnabled).toBe(true);
  });

  it('crea las políticas en modo informe, desactiva los defaults y luego las aplica', async () => {
    const graph = new SimulatedGraph(undefined, demoTenant);
    const res = await run(graph, [
      { playbookId: 'entra-ca-admins-mfa' },
      { playbookId: 'entra-ca-all-users-mfa', params: { state: 'enabled' } },
      { playbookId: 'entra-ca-block-legacy', params: { state: 'enabled' } },
      { playbookId: 'entra-security-defaults' },
    ]);
    expect(res.every((r) => r.status === 'ok' || r.status === 'manual')).toBe(true);
    expect((await graph.get<any>('/policies/identitySecurityDefaultsEnforcementPolicy')).isEnabled).toBe(false);
    const policies = await graph.list<any>('/identity/conditionalAccess/policies');
    for (const n of [CA_NAMES.admins, CA_NAMES.allUsers, CA_NAMES.legacy]) {
      expect(policies.find((p) => p.displayName === n)?.state, n).toBe('enabled');
    }
    // El orden garantiza que las políticas existen antes de desactivar los defaults
    const writes = graph.calls.filter((c) => c.method !== 'GET').map((c) => c.path);
    const sdIndex = writes.indexOf('/policies/identitySecurityDefaultsEnforcementPolicy');
    expect(writes.slice(0, sdIndex).filter((p) => p === '/identity/conditionalAccess/policies')).toHaveLength(3);
  });
});

describe('utilidades', () => {
  it('escapa cadenas de PowerShell', () => {
    expect(psq("O'Brien; Remove-Item C:\\")).toBe("'O''Brien; Remove-Item C:\\'");
    expect(psHash({ A: true, B: 3, C: "x'y", D: ['a'] })).toBe("@{ A = $true; B = 3; C = 'x''y'; D = @('a') }");
  });

  it('diff compara subconjuntos y arreglos de objetos', () => {
    expect(diff({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [2, 1], d: 5 }, z: 0 })).toEqual([]);
    expect(diff({ t: [{ id: 'x' }] }, { t: [{ id: 'x', extra: true }] })).toEqual([]);
    expect(diff({ a: 1 }, { a: 2 })).toEqual(['a']);
  });

  it('permisos implícitos', () => {
    expect(missingPermissions(['Group.Read.All', 'Policy.Read.All'], ['Group.ReadWrite.All', 'Policy.Read.All'])).toEqual([]);
    expect(missingPermissions(['Group.ReadWrite.All'], ['Group.Read.All'])).toEqual(['Group.ReadWrite.All']);
  });
});
