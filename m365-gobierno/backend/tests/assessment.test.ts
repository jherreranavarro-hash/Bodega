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
    // 38 personas (42 miembros − 2 deshabilitados − 2 sin licencia); 23 registradas
    expect(scan.users?.people).toBe(38);
    expect(scan.mfa?.pct).toBe(61);
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
    // Aplicada en Exchange, SharePoint y OneDrive; Teams sin DLP → 3 de 4 cargas
    expect(dlp.value).toBe(0.75);
    expect(dlp.source).toBe('Tenant · Purview PowerShell');
    expect(dlp.detail).toContain('Teams sin DLP');
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

describe('lecturas robustas', () => {
  it('lee los métodos de autenticación desde la política (la colección no admite GET directo)', async () => {
    const seed = () => {
      const t = demoTenant();
      t['/policies/authenticationmethodspolicy'] = {
        id: 'authenticationMethodsPolicy',
        authenticationMethodConfigurations: [{ id: 'Sms', state: 'disabled' }],
      };
      delete t['/policies/authenticationmethodspolicy/authenticationmethodconfigurations'];
      return t;
    };
    const scan = await scanTenant(new SimulatedGraph(undefined, seed));
    expect(scan.authMethods).toEqual({ Sms: 'disabled' });
  });

  it('no reporta como no evaluadas las etiquetas por Graph si Purview se leyó por PowerShell', async () => {
    const { simulatedProbe } = await import('../src/assessment/probe.js');
    const probe = simulatedProbe();
    probe.ipps!.labels = [{ Name: 'Confidencial' }];
    const graph = new SimulatedGraph(undefined, demoTenant);
    const orig = graph.list.bind(graph);
    graph.list = (async (path: string, o?: any) => {
      if (path.includes('sensitivityLabels')) throw Object.assign(new Error(''), { status: 403 });
      if (path.includes('retentionLabels')) throw Object.assign(new Error(''), { status: 400 });
      return orig(path, o);
    }) as any;
    const scan = await scanTenant(graph, { probe: async () => probe });
    expect(scan.errors.map((e) => e.area)).not.toContain('Etiquetas de confidencialidad (Graph)');
    expect(scan.errors.map((e) => e.area)).not.toContain('Etiquetas de retención (Graph)');
  });
});

describe('madurez por cobertura real de usuarios y dispositivos', () => {
  // Tenant mínimo verificable a mano
  const tiny = () => {
    const t = demoTenant();
    const lic = [{ skuId: 'spb' }];
    t['/users'] = [
      { id: 'a', userPrincipalName: 'a@x.cl', userType: 'Member', accountEnabled: true, assignedLicenses: lic },
      { id: 'b', userPrincipalName: 'b@x.cl', userType: 'Member', accountEnabled: true, assignedLicenses: lic },
      { id: 'c', userPrincipalName: 'c@x.cl', userType: 'Member', accountEnabled: true, assignedLicenses: lic },
      { id: 'd', userPrincipalName: 'd@x.cl', userType: 'Member', accountEnabled: false, assignedLicenses: lic }, // deshabilitado
      { id: 'e', userPrincipalName: 'buzon@x.cl', userType: 'Member', accountEnabled: true, assignedLicenses: [] }, // buzón compartido
      { id: 'g', userPrincipalName: 'g_ext#EXT#@x.cl', userType: 'Guest', accountEnabled: true, assignedLicenses: [] },
    ];
    t['/reports/authenticationmethods/userregistrationdetails'] = [
      { id: 'a', userType: 'member', isMfaRegistered: true, methodsRegistered: ['microsoftAuthenticatorPush'] },
      { id: 'b', userType: 'member', isMfaRegistered: true, methodsRegistered: ['mobilePhone', 'email'] },
      { id: 'c', userType: 'member', isMfaRegistered: false, methodsRegistered: ['email'] },
      { id: 'd', userType: 'member', isMfaRegistered: true, methodsRegistered: ['microsoftAuthenticatorPush'] },
      { id: 'e', userType: 'member', isMfaRegistered: false, methodsRegistered: [] },
    ];
    const si = (userId: string, mfa: boolean) => ({
      userId,
      createdDateTime: new Date().toISOString(),
      status: { errorCode: 0 },
      authenticationRequirement: mfa ? 'multiFactorAuthentication' : 'singleFactorAuthentication',
    });
    t['/auditlogs/signins'] = [si('a', true), si('a', true), si('b', true), si('b', false), si('c', false), si('c', false), si('e', false), si('g', false)];
    t['/devicemanagement/manageddevices'] = [
      { id: 'd1', operatingSystem: 'Windows', complianceState: 'compliant', isEncrypted: true },
      { id: 'd2', operatingSystem: 'Windows', complianceState: 'noncompliant', isEncrypted: false },
    ];
    return t;
  };

  it('la base son personas: miembros habilitados con licencia', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, tiny));
    expect(scan.users).toMatchObject({ members: 5, guests: 1, enabledMembers: 4, people: 3, peopleBase: 'licenciados' });
    expect(scan.mfa).toMatchObject({ total: 3, registered: 2, pct: 67, strong: 1, weakOnly: 1 });
    expect(scan.quality?.find((q) => q.id === 'people-base')?.detail).toContain('5 cuentas miembro → 4 habilitadas → 3 con licencia');
  });

  it('el MFA efectivo sale de los inicios de sesión reales, no del registro', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, tiny));
    expect(scan.signIns).toMatchObject({ people: 3, allMfa: 1, partialMfa: 1, noMfa: 1 });
    const rec = recommend(scan, DEFAULT_QUESTIONNAIRE, {});
    const mfa = rec.scores.checks.find((c) => c.id === 'mfa-protected')!;
    expect(mfa.value).toBeCloseTo((1 + 0.5) / 3, 5);
    expect(mfa.source).toBe('Tenant · Registros de inicio de sesión');
    expect(rec.scores.checks.find((c) => c.id === 'mfa-strong')!.value).toBeCloseTo(1 / 3, 5);
    // 67% registrado vs 50% usado → advertencia de calidad
    expect(scan.quality?.some((q) => q.id === 'mfa-registered-vs-used')).toBe(true);
    expect(rec.findings.find((f) => f.id === 'mfa-usage')?.title).toContain('1 personas iniciaron sesión sin MFA');
    const c = scan.mfaUsers!.find((u) => u.upn === 'c@x.cl')!;
    expect(c).toMatchObject({ registered: false, signIns: 2, mfaSignIns: 0 });
    expect(scan.mfaUsers!.map((u) => u.upn).sort()).toEqual(['a@x.cl', 'b@x.cl', 'c@x.cl']);
  });

  it('sin registros de inicio de sesión, el MFA se estima y se indica', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, tiny), { signIns: false });
    const rec = recommend(scan, DEFAULT_QUESTIONNAIRE, {});
    const mfa = rec.scores.checks.find((c) => c.id === 'mfa-protected')!;
    // (1 robusto + 0.5 × 1 teléfono) / 3 × 0.5 (valores predeterminados)
    expect(mfa.value).toBeCloseTo(((1 + 0.5) / 3) * 0.5, 5);
    expect(mfa.detail).toContain('ESTIMADO');
  });

  it('dispositivos: cobertura sobre personas y % reales de los administrados', async () => {
    const scan = await scanTenant(new SimulatedGraph(undefined, tiny));
    const rec = recommend(scan, DEFAULT_QUESTIONNAIRE, {});
    expect(rec.scores.checks.find((c) => c.id === 'enrolled')!.value).toBeCloseTo(2 / 3, 5);
    expect(rec.scores.checks.find((c) => c.id === 'compliant')!.value).toBe(0.5);
    expect(rec.scores.checks.find((c) => c.id === 'encrypted')!.value).toBe(0.5);
  });

  it('Acceso Condicional con "fortaleza de autenticación" cuenta como MFA exigido', async () => {
    const seed = () => {
      const t = tiny();
      t['/identity/conditionalaccess/policies'] = [
        {
          id: 'p1',
          displayName: 'MFA fuerte',
          state: 'enabled',
          conditions: { users: { includeUsers: ['All'], excludeUsers: ['a'] }, clientAppTypes: ['all'] },
          grantControls: { operator: 'OR', authenticationStrength: { id: '00000000-0000-0000-0000-000000000002' } },
        },
      ];
      return t;
    };
    const scan = await scanTenant(new SimulatedGraph(undefined, seed));
    expect(scan.ca?.requireMfaAll).toBe(true);
    expect(scan.ca?.mfaAllExcluded).toBe(1);
  });

  it('Secure Score toma la medición más reciente', async () => {
    const seed = () => {
      const t = tiny();
      t['/security/securescores'] = [
        { currentScore: 10, maxScore: 100, createdDateTime: '2026-09-20T00:00:00Z' },
        { currentScore: 48, maxScore: 100, createdDateTime: '2026-09-25T00:00:00Z' },
      ];
      return t;
    };
    const scan = await scanTenant(new SimulatedGraph(undefined, seed));
    expect(scan.secureScore?.pct).toBe(48);
  });

  it('reglas de correo limitadas a algunos usuarios valen 50%', async () => {
    const { simulatedProbe } = await import('../src/assessment/probe.js');
    const probe = simulatedProbe();
    probe.exo!.safeLinksRules = [{ Name: 'Piloto', State: 'Enabled', Scope: 'usuarios' }];
    const scan = await scanTenant(new SimulatedGraph(undefined, demoTenant), { probe: async () => probe });
    const rec = recommend(scan, DEFAULT_QUESTIONNAIRE, {});
    expect(rec.scores.checks.find((c) => c.id === 'safe-links')!.value).toBe(0.5);
  });
});
