import { describe, expect, it } from 'vitest';
import { SimulatedGraph } from '../src/graph/simulated.js';
import { executePlan, resolvePlan } from '../src/engine/runner.js';
import { PUBLIC_RANGES, patchState } from '../src/playbooks/vulnerabilidades.js';
import { complianceFor } from '../src/compliance/controls.js';
import { getPlaybook } from '../src/playbooks/index.js';
import type { Params } from '../src/engine/types.js';

const ID = 'cve-2026-124194-outlook-ntlm';
const tenant = { initialDomain: 'contosodemo.onmicrosoft.com', defaultDomain: 'contoso-demo.cl', country: 'CL' };

function run(graph: SimulatedGraph, params: Params = {}, dryRun = false) {
  const { items, errors } = resolvePlan([{ playbookId: ID, params }]);
  expect(errors).toEqual([]);
  return executePlan(items, { graph, mode: 'simulacion', dryRun, tenant, runPowerShell: async () => ['ok'] });
}

describe('respuesta CVE-2026-124194', () => {
  it('clasifica compilaciones de Office por rama', () => {
    const fixed = ['16.0.14334.21048', '16.0.17932.21140'];
    expect(patchState('16.0.17932.21140', fixed)).toBe('corregido');
    expect(patchState('16.0.17932.21200', fixed)).toBe('corregido');
    expect(patchState('16.0.17932.21002', fixed)).toBe('vulnerable');
    expect(patchState('16.0.18025.20030', fixed)).toBe('corregido'); // rama más nueva
    expect(patchState('16.0.16130.20000', fixed)).toBe('vulnerable'); // rama intermedia sin parche listado
    expect(patchState('15.0.1.1', fixed)).toBe('no-verificable');
    expect(patchState('16.0.17932.21002', [])).toBe('no-verificable');
  });

  it('los rangos públicos no incluyen redes privadas', () => {
    const toNum = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
    const v4 = PUBLIC_RANGES.filter((r) => !r.includes(':')).map((r) => r.split('-').map(toNum));
    for (const priv of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '127.0.0.1', '169.254.10.1', '100.64.0.1']) {
      expect(v4.some(([a, b]) => toNum(priv) >= a && toNum(priv) <= b), priv).toBe(false);
    }
    for (const pub of ['8.8.8.8', '52.96.0.1', '172.32.0.1', '200.1.2.3']) {
      expect(v4.some(([a, b]) => toNum(pub) >= a && toNum(pub) <= b), pub).toBe(true);
    }
  });

  it('previsualiza sin escribir e informa el estado del parche', async () => {
    const graph = new SimulatedGraph();
    const [r] = await run(graph, {}, true);
    expect(r.status, r.error).toBe('ok');
    expect(graph.calls.some((c) => c.method !== 'GET')).toBe(false);
    const verify = r.steps.find((s) => s.target.startsWith('Verificación del parche'))!;
    expect(verify.target).toContain('16 de 28'); // 12 corregidas + 4 de rama nueva, de 28
    expect(r.steps.find((s) => s.target.startsWith('Sin parche'))?.target).toContain('12');
    expect(r.steps.filter((s) => s.action === 'crear').map((s) => s.target)).toEqual([
      'Plantilla administrativa: GOB-CVE-2026-124194-Office-Actualizaciones',
      'Regla de firewall (protección de extremos): GOB-CVE-2026-124194-Bloquear-SMB-saliente',
      'Perfil de configuración (catálogo): GOB-CVE-2026-124194-NTLM-saliente',
    ]);
  });

  it('despliega las tres mitigaciones, asignadas a todos los equipos, y es idempotente', async () => {
    const graph = new SimulatedGraph();
    const [r] = await run(graph, { deadline: '2026-11-20' });
    expect(r.status, r.error).toBe('ok');

    const [cfg] = await graph.list<any>('/deviceManagement/groupPolicyConfigurations');
    const values = await graph.list<any>(`/deviceManagement/groupPolicyConfigurations/${cfg.id}/definitionValues`);
    expect(values.map((v) => v['definition@odata.bind'].match(/'(.+)'/)[1]).sort()).toEqual([
      'gpd-office-autoupdates',
      'gpd-office-deadline', // la plantilla de equipo, no la de usuario
      'gpd-office-hideupdates',
    ]);
    const deadline = values.find((v) => v.presentationValues)?.presentationValues[0];
    expect(deadline.value).toBe('11/20/2026 18:00');
    expect(deadline['presentation@odata.bind']).toContain("presentations('p-deadline')");

    const rule = (await graph.list<any>('/deviceManagement/deviceConfigurations')).find((c) => c.displayName.includes('SMB'));
    expect(rule.firewallRules[0]).toMatchObject({ protocol: 6, remotePortRanges: ['445'], trafficDirection: 'out', action: 'blocked' });
    expect(rule.firewallRules[0].remoteAddressRanges).toEqual(PUBLIC_RANGES);

    const ntlm = (await graph.list<any>('/deviceManagement/configurationPolicies')).find((c) => c.name.includes('NTLM'));
    expect(ntlm.settings[0].settingInstance.choiceSettingValue.value).toMatch(/_1$/); // auditar

    const assigns = graph.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/assign'));
    expect(assigns).toHaveLength(3);
    for (const a of assigns) expect(JSON.stringify(a.body)).toContain('allDevicesAssignmentTarget');

    const [again] = await run(graph, { deadline: '2026-11-20' });
    expect(again.steps.filter((s) => s.action === 'crear' || s.action === 'actualizar')).toEqual([]);
  });

  it('sin fecha conserva la del primer despliegue; al cambiarla reemplaza los valores', async () => {
    const graph = new SimulatedGraph();
    await run(graph);
    const [cfg] = await graph.list<any>('/deviceManagement/groupPolicyConfigurations');
    const first = cfg.description.match(/plazo (\d{4}-\d{2}-\d{2})/)[1];
    const [again] = await run(graph);
    expect(again.steps.find((s) => s.target.includes('Office-Actualizaciones'))?.action).toBe('sin-cambios');

    const [changed] = await run(graph, { deadline: '2026-11-22', ntlm: 'bloquear', smbScope: 'todo' });
    expect(changed.steps.find((s) => s.target.includes('Office-Actualizaciones'))?.action).toBe('actualizar');
    const values = await graph.list<any>(`/deviceManagement/groupPolicyConfigurations/${cfg.id}/definitionValues`);
    expect(values).toHaveLength(3);
    expect(values.find((v) => v.presentationValues).presentationValues[0].value).toBe('11/22/2026 18:00');
    expect(first).not.toBe('2026-11-22');
    const rule = (await graph.list<any>('/deviceManagement/deviceConfigurations')).find((c) => c.displayName.includes('SMB'));
    expect(rule.firewallRules[0].remoteAddressRanges).toEqual(['*']);
  });

  it('rechaza fechas inválidas y avisa si falta la plantilla de Office', async () => {
    const [bad] = await run(new SimulatedGraph(), { deadline: '20-11-2026' });
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/AAAA-MM-DD/);

    const graph = new SimulatedGraph();
    await graph.delete('/deviceManagement/groupPolicyDefinitions/gpd-office-deadline');
    const [missing] = await run(graph, {}, true);
    expect(missing.status).toBe('error');
    expect(missing.error).toMatch(/Update Deadline/);
  });

  it('se vincula a ISO 27001 A.8.8 y a la Ley 21.719', () => {
    const pb = getPlaybook(ID)!;
    const c = complianceFor(pb.id, pb.pillar);
    expect(c.iso.map((x) => x.id)).toContain('8.8');
    expect(c.law.map((x) => x.id)).toContain('vulneraciones');
    expect(pb.advisory).toMatchObject({ id: 'CVE-2026-124194', exploited: true, kevDue: '2026-11-24' });
  });
});
