import { describe, expect, it } from 'vitest';
import { SimulatedGraph, demoTenant } from '../src/graph/simulated.js';
import { scanTenant } from '../src/assessment/scan.js';
import { DEFAULT_QUESTIONNAIRE, chooseProfile, recommend } from '../src/assessment/recommend.js';

describe('assessment', () => {
  it('lee el tenant de demostración', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, demoTenant));
    expect(scan.errors).toEqual([]);
    expect(scan.license?.businessPremium).toBe(true);
    expect(scan.securityDefaults).toBe(true);
    expect(scan.globalAdmins).toBe(5);
    expect(scan.mfa?.pct).toBe(62);
    expect(scan.devices?.total).toBe(31);
  });

  it('recomienda reemplazar security defaults manteniendo MFA aplicado', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, demoTenant));
    const rec = recommend(scan, { ...DEFAULT_QUESTIONNAIRE, company: 'Contoso Demo SpA' });
    expect(rec.profile).toBe('recomendado');
    const byId = new Map(rec.items.map((i) => [i.playbookId, i]));
    expect(byId.get('entra-security-defaults')).toBeDefined();
    expect(byId.get('entra-ca-all-users-mfa')!.params.state).toBe('enabled');
    expect(byId.get('entra-password-protection')!.params.banned).toContain('contoso');
    expect(byId.get('purview-dlp')!.params.types).toContain('Chile Identity Card Number');
    expect(rec.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['too-many-admins', 'mfa-registration', 'anyone-links']));
    expect(rec.scores.pillars.entra).toBeGreaterThan(0);
    expect(rec.roadmap.flatMap((r) => r.playbooks)).toHaveLength(rec.items.length);
  });

  it('elige el perfil según el contexto de la empresa', () => {
    expect(chooseProfile({ ...DEFAULT_QUESTIONNAIRE, itTeam: 'ninguno', sensitiveData: [], frameworks: [] }).profile).toBe('esencial');
    expect(
      chooseProfile({ ...DEFAULT_QUESTIONNAIRE, industry: 'financiero', sensitiveData: ['tarjetas'], frameworks: ['pci', 'ley21719'], itTeam: 'interno' }).profile,
    ).toBe('estricto');
  });
});

describe('madurez basada en el estado real del tenant', () => {
  it('reconoce DLP y protección de correo existentes aunque no las haya desplegado la app', async () => {
    const { simulatedProbe } = await import('../src/assessment/probe.js');
    const scan = await scanTenant(new SimulatedGraph(undefined, demoTenant), { probe: async () => simulatedProbe() });
    const rec = recommend(scan, DEFAULT_QUESTIONNAIRE, {});
    const dlp = rec.scores.checks.find((c) => c.id === 'dlp')!;
    expect(dlp.value).toBe(1);
    expect(dlp.source).toBe('Tenant · Purview PowerShell');
    expect(dlp.detail).toContain('Datos financieros Chile (aplicada)');
    expect(rec.scores.checks.find((c) => c.id === 'safe-links')!.value).toBe(0.5);
    expect(rec.scores.checks.find((c) => c.id === 'audit')!.value).toBe(1);
    expect(rec.scores.pillars.purview).toBeGreaterThan(0);
    expect(rec.scores.pillars.defender).toBeGreaterThan(0);
    expect(scan.secureScore?.categories?.Data.pct).toBe(40);
    expect(rec.findings.find((f) => f.id === 'audit')).toBeUndefined();
  });

  it('si PowerShell no se puede leer, lo marca como no evaluado en vez de 0%', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, demoTenant), {
      probe: async () => ({ at: '', errors: [{ area: 'Purview', message: 'pwsh no instalado' }] }),
    });
    const rec = recommend(scan, DEFAULT_QUESTIONNAIRE, {});
    expect(rec.scores.checks.find((c) => c.id === 'dlp')!.value).toBeNull();
    // Solo cuentan los criterios evaluables (sharing + Secure Score Datos)
    expect(rec.scores.pillars.purview).not.toBeNull();
  });
});
