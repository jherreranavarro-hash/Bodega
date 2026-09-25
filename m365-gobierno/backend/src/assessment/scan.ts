import type { GraphLike } from '../graph/client.js';
import { PREFIX } from '../engine/helpers.js';
import type { ProbeResult } from './probe.js';

export interface ScanResult {
  at: string;
  org?: { name: string; country?: string; defaultDomain?: string; initialDomain?: string };
  license?: { businessPremium: boolean; purchased: number; assigned: number; skus: string[] };
  /**
   * members incluye cuentas deshabilitadas, buzones compartidos, salas y cuentas sin licencia.
   * people = miembros habilitados con al menos una licencia: la base de los % de usuarios.
   */
  users?: { members: number; guests: number; disabled: number; enabledMembers: number; people: number; peopleBase: 'licenciados' | 'habilitados' };
  globalAdmins?: number;
  securityDefaults?: boolean;
  ca?: {
    total: number;
    enabled: number;
    reportOnly: number;
    requireMfaAll: boolean;
    blocksLegacy: boolean;
    gob: string[];
    /** Usuarios excluidos (directo o por grupo) de la política aplicada de MFA para todos. */
    mfaAllExcluded?: number;
  };
  /** Calculado sobre `users.people` (personas: miembros habilitados con licencia). */
  mfa?: { total: number; registered: number; pct: number; strong: number; weakOnly: number; reportUpdated?: string };
  /** Uso real de MFA según los registros de inicio de sesión interactivos exitosos. */
  signIns?: {
    days: number;
    records: number;
    truncated: boolean;
    /** Personas que iniciaron sesión en la ventana. */
    people: number;
    /** Todas sus sesiones exigieron MFA. */
    allMfa: number;
    /** Algunas sí, otras no. */
    partialMfa: number;
    /** Ninguna sesión exigió MFA. */
    noMfa: number;
  };
  /** Detalle por persona para revisión y exportación. */
  mfaUsers?: {
    upn: string;
    name?: string;
    registered: boolean;
    strong: boolean;
    methods: string[];
    signIns: number | null;
    mfaSignIns: number | null;
    lastSignIn?: string;
  }[];
  /** Controles de calidad de los datos leídos. */
  quality?: { id: string; status: 'ok' | 'warn' | 'info'; label: string; detail: string }[];
  authMethods?: Record<string, string>;
  authorization?: { usersCanCreateApps: boolean; guestInvites: string; legacyConsent: boolean };
  devices?: { total: number; compliant: number; noncompliant: number; encrypted: number; byOs: Record<string, number> };
  intune?: { compliancePolicies: number; configurationProfiles: number; appProtection: number; compliancePlatforms?: string[] };
  secureScore?: {
    current: number;
    max: number;
    pct: number;
    date?: string;
    /** Por categoría de Secure Score (Identity, Data, Device, Apps…), calculado desde controlScores. */
    categories?: Record<string, { score: number; max: number; pct: number }>;
    controls?: { name: string; title: string; category: string; service?: string; score: number; max: number }[];
  };
  /** Etiquetas de confidencialidad leídas vía Graph. */
  sensitivityLabels?: string[];
  retentionLabels?: string[];
  /** Configuración leída vía PowerShell (Defender for Office, auditoría, DLP, retención). */
  probe?: ProbeResult;
  sharepoint?: { sharingCapability: string };
  namedLocations?: number;
  errors: { area: string; message: string }[];
}

const GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10';
/** Métodos resistentes o robustos; SMS, llamada y correo se consideran débiles. */
const STRONG_METHODS = new Set([
  'microsoftAuthenticatorPush',
  'microsoftAuthenticatorPasswordless',
  'softwareOneTimePasscode',
  'hardwareOneTimePasscode',
  'fido2SecurityKey',
  'passKeyDeviceBound',
  'passKeyDeviceBoundAuthenticator',
  'passKeyDeviceBoundWindowsHello',
  'windowsHelloForBusiness',
  'macOsSecureEnclaveKey',
  'platformCredential',
]);

/** Lectura (solo lectura) del estado actual del tenant. Cada área falla de forma independiente. */
const SIGNIN_DAYS = 7;
const SIGNIN_MAX = 20000;
const MFA_GRANT = (p: any) => p.grantControls?.builtInControls?.includes('mfa') || Boolean(p.grantControls?.authenticationStrength);

export async function scanTenant(
  graph: GraphLike,
  opts: { probe?: () => Promise<ProbeResult>; signIns?: boolean } = {},
): Promise<ScanResult> {
  const r: ScanResult = { at: new Date().toISOString(), errors: [] };
  // Datos crudos que se cruzan al final (usuarios × registro × inicios de sesión)
  let usersRaw: any[] | undefined;
  let regRaw: any[] | undefined;
  let signInRaw: any[] | undefined;
  let adminsRaw: any[] | undefined;
  const area = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e: any) {
      const msg = e?.status === 403 ? 'Sin permiso para leer esta área' : e?.message || (e?.status ? `Error HTTP ${e.status}` : String(e));
      r.errors.push({ area: name, message: msg });
    }
  };

  await Promise.all([
    area('Organización', async () => {
      const org = (await graph.list<any>('/organization?$select=displayName,countryLetterCode,verifiedDomains'))[0] ?? {};
      const d: any[] = org.verifiedDomains ?? [];
      r.org = {
        name: org.displayName,
        country: org.countryLetterCode,
        defaultDomain: d.find((x) => x.isDefault)?.name,
        initialDomain: d.find((x) => x.isInitial)?.name,
      };
    }),
    area('Licencias', async () => {
      const skus = await graph.list<any>('/subscribedSkus');
      const spb = skus.find((s) => s.skuPartNumber === 'SPB' || s.skuPartNumber === 'O365_BUSINESS_PREMIUM_SPB');
      r.license = {
        businessPremium: Boolean(spb),
        purchased: spb?.prepaidUnits?.enabled ?? 0,
        assigned: spb?.consumedUnits ?? 0,
        skus: skus.map((s) => s.skuPartNumber),
      };
    }),
    area('Usuarios', async () => {
      usersRaw = await graph.list<any>('/users?$select=id,displayName,userPrincipalName,userType,accountEnabled,assignedLicenses&$top=999', { max: 20000 });
    }),
    area('Administradores', async () => {
      adminsRaw = await graph.list<any>(`/directoryRoles(roleTemplateId='${GLOBAL_ADMIN}')/members?$select=id,userPrincipalName`);
      r.globalAdmins = adminsRaw.length;
    }),
    area('Valores predeterminados de seguridad', async () => {
      r.securityDefaults = Boolean((await graph.get<any>('/policies/identitySecurityDefaultsEnforcementPolicy'))?.isEnabled);
    }),
    area('Acceso Condicional', async () => {
      const ps = await graph.list<any>('/identity/conditionalAccess/policies');
      const enabled = ps.filter((p) => p.state === 'enabled');
      r.ca = {
        total: ps.length,
        enabled: enabled.length,
        reportOnly: ps.filter((p) => p.state === 'enabledForReportingButNotEnforced').length,
        requireMfaAll: enabled.some((p) => p.conditions?.users?.includeUsers?.includes('All') && MFA_GRANT(p)),
        blocksLegacy: enabled.some(
          (p) => p.conditions?.clientAppTypes?.includes('other') && p.grantControls?.builtInControls?.includes('block'),
        ),
        gob: ps.map((p) => p.displayName).filter((n: string) => n?.startsWith(PREFIX)),
      };
      const mfaAll = enabled.find((p) => p.conditions?.users?.includeUsers?.includes('All') && MFA_GRANT(p));
      if (mfaAll) {
        // excludeUsers puede traer palabras clave ("GuestsOrExternalUsers", "None") además de ids
        const keywords = new Set(['all', 'none', 'guestsorexternalusers']);
        const excluded = new Set<string>((mfaAll.conditions?.users?.excludeUsers ?? []).filter((u: string) => !keywords.has(String(u).toLowerCase())));
        for (const g of mfaAll.conditions?.users?.excludeGroups ?? []) {
          const members = await graph.list<any>(`/groups/${g}/transitiveMembers?$select=id`, { max: 20000 }).catch(() => []);
          members.forEach((m) => excluded.add(m.id));
        }
        r.ca.mfaAllExcluded = excluded.size;
      }
    }),
    area('Ubicaciones con nombre', async () => {
      r.namedLocations = (await graph.list<any>('/identity/conditionalAccess/namedLocations')).length;
    }),
    area('Registro de MFA', async () => {
      regRaw = await graph.list<any>(
        '/reports/authenticationMethods/userRegistrationDetails?$select=id,userType,isMfaRegistered,methodsRegistered,lastUpdatedDateTime',
        { max: 20000 },
      );
    }),
    area(`Inicios de sesión (últimos ${SIGNIN_DAYS} días)`, async () => {
      if (opts.signIns === false) return;
      const since = new Date(Date.now() - SIGNIN_DAYS * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
      // beta: incluye authenticationRequirement (si la sesión exigió MFA)
      signInRaw = await graph.list<any>(`/auditLogs/signIns?$filter=createdDateTime ge ${since} and status/errorCode eq 0&$top=999`, {
        beta: true,
        max: SIGNIN_MAX,
      });
    }),
    area('Métodos de autenticación', async () => {
      // La colección no admite GET directo: viene incluida en la política de métodos de autenticación
      const policy = await graph.get<any>('/policies/authenticationMethodsPolicy');
      const cfg: any[] = policy?.authenticationMethodConfigurations ?? (await graph.list<any>('/policies/authenticationMethodsPolicy/authenticationMethodConfigurations'));
      r.authMethods = Object.fromEntries(cfg.map((c) => [c.id, c.state]));
    }),
    area('Permisos de usuarios', async () => {
      const a = await graph.get<any>('/policies/authorizationPolicy');
      const perms = a?.defaultUserRolePermissions ?? {};
      r.authorization = {
        usersCanCreateApps: perms.allowedToCreateApps !== false,
        guestInvites: a?.allowInvitesFrom ?? 'desconocido',
        legacyConsent: (perms.permissionGrantPoliciesAssigned ?? []).some((x: string) => x.endsWith('microsoft-user-default-legacy')),
      };
    }),
    area('Dispositivos', async () => {
      const ds = await graph.list<any>('/deviceManagement/managedDevices?$select=operatingSystem,complianceState,isEncrypted', { max: 20000 });
      const byOs: Record<string, number> = {};
      for (const d of ds) byOs[d.operatingSystem ?? 'Otro'] = (byOs[d.operatingSystem ?? 'Otro'] ?? 0) + 1;
      r.devices = {
        total: ds.length,
        compliant: ds.filter((d) => d.complianceState === 'compliant').length,
        noncompliant: ds.filter((d) => d.complianceState === 'noncompliant').length,
        encrypted: ds.filter((d) => d.isEncrypted).length,
        byOs,
      };
    }),
    area('Intune', async () => {
      const [c, cfg, sc, ios, android] = await Promise.all([
        graph.list<any>('/deviceManagement/deviceCompliancePolicies'),
        graph.list<any>('/deviceManagement/deviceConfigurations?$select=id'),
        graph.list<any>('/deviceManagement/configurationPolicies?$select=id', { beta: true }),
        graph.list<any>('/deviceAppManagement/iosManagedAppProtections?$select=id'),
        graph.list<any>('/deviceAppManagement/androidManagedAppProtections?$select=id'),
      ]);
      const platformOf = (t: string) =>
        /windows/i.test(t) ? 'Windows' : /ios/i.test(t) ? 'iOS' : /android/i.test(t) ? 'Android' : /macos/i.test(t) ? 'macOS' : 'Otro';
      r.intune = {
        compliancePolicies: c.length,
        configurationProfiles: cfg.length + sc.length,
        appProtection: ios.length + android.length,
        compliancePlatforms: [...new Set(c.map((p: any) => platformOf(String(p['@odata.type'] ?? ''))))],
      };
    }),
    area('Secure Score', async () => {
      // El orden de la API no está garantizado: se toma el más reciente de los últimos registros
      const recent = await graph.list<any>('/security/secureScores?$top=7', { max: 7 });
      const s = recent.sort((a, b) => String(b.createdDateTime).localeCompare(String(a.createdDateTime)))[0];
      if (!s) return;
      r.secureScore = {
        current: Math.round(s.currentScore),
        max: Math.round(s.maxScore),
        pct: Math.round((s.currentScore / s.maxScore) * 100),
        date: s.createdDateTime,
      };
      try {
        const profiles = await graph.list<any>('/security/secureScoreControlProfiles?$select=id,title,maxScore,controlCategory,service,deprecated', { max: 1000 });
        const byId = new Map(profiles.filter((p) => !p.deprecated).map((p) => [p.id, p]));
        const controls = (s.controlScores ?? [])
          .map((c: any) => {
            const p = byId.get(c.controlName);
            return p
              ? { name: c.controlName, title: p.title, category: c.controlCategory ?? p.controlCategory, service: p.service, score: Number(c.score ?? 0), max: Number(p.maxScore ?? 0) }
              : null;
          })
          .filter((c: any) => c && c.max > 0);
        const categories: Record<string, { score: number; max: number; pct: number }> = {};
        for (const c of controls) {
          const k = c.category ?? 'Otros';
          categories[k] ??= { score: 0, max: 0, pct: 0 };
          categories[k].score += c.score;
          categories[k].max += c.max;
        }
        for (const v of Object.values(categories)) v.pct = v.max ? Math.round((v.score / v.max) * 100) : 0;
        r.secureScore.categories = categories;
        r.secureScore.controls = controls;
      } catch (e: any) {
        r.errors.push({ area: 'Secure Score (detalle por control)', message: e?.status === 403 ? 'Sin permiso para leer (403)' : e?.message ?? String(e) });
      }
    }),
    area('Etiquetas de confidencialidad (Graph)', async () => {
      const labels = await graph.list<any>('/security/informationProtection/sensitivityLabels', { beta: true });
      r.sensitivityLabels = labels.map((l) => l.name ?? l.displayName);
    }),
    area('Etiquetas de retención (Graph)', async () => {
      const labels = await graph.list<any>('/security/labels/retentionLabels?$select=displayName');
      r.retentionLabels = labels.map((l) => l.displayName);
    }),
    area('SharePoint', async () => {
      r.sharepoint = { sharingCapability: (await graph.get<any>('/admin/sharepoint/settings'))?.sharingCapability };
    }),
    area('PowerShell (Defender for Office 365 y Purview)', async () => {
      if (!opts.probe) return;
      r.probe = await opts.probe();
      r.errors.push(...r.probe.errors);
    }),
  ]);
  crossReference(r, { usersRaw, regRaw, signInRaw, adminsRaw });
  // Las lecturas de etiquetas por Graph son complementarias: si Purview se leyó por PowerShell no son un problema
  const ipps = r.probe?.ipps;
  const covered: Record<string, boolean> = {
    'Etiquetas de confidencialidad (Graph)': Boolean(ipps?.labels),
    'Etiquetas de retención (Graph)': Boolean(ipps?.retentionPolicies),
  };
  r.errors = r.errors.filter((e) => !covered[e.area]);
  return r;
}

/** Cruza usuarios, registro de MFA e inicios de sesión sobre la base de personas, y audita la calidad de los datos. */
function crossReference(
  r: ScanResult,
  raw: { usersRaw?: any[]; regRaw?: any[]; signInRaw?: any[]; adminsRaw?: any[] },
) {
  const quality: NonNullable<ScanResult['quality']> = [];
  const { usersRaw, regRaw, signInRaw, adminsRaw } = raw;
  let agg: Map<string, { total: number; mfa: number; last: string }> | undefined;

  let people: any[] | undefined;
  if (usersRaw) {
    const members = usersRaw.filter((u) => u.userType !== 'Guest');
    const enabled = members.filter((u) => u.accountEnabled !== false);
    const licenseKnown = usersRaw.some((u) => Array.isArray(u.assignedLicenses));
    const licensed = enabled.filter((u) => (u.assignedLicenses?.length ?? 0) > 0);
    people = licenseKnown ? licensed : enabled;
    r.users = {
      members: members.length,
      guests: usersRaw.length - members.length,
      disabled: usersRaw.filter((u) => u.accountEnabled === false).length,
      enabledMembers: enabled.length,
      people: people.length,
      peopleBase: licenseKnown ? 'licenciados' : 'habilitados',
    };
    quality.push({
      id: 'people-base',
      status: 'info',
      label: 'Base de personas',
      detail: `${members.length} cuentas miembro → ${enabled.length} habilitadas → ${people.length} ${licenseKnown ? 'con licencia' : ''}. Se excluyen ${members.length - people.length} cuentas (deshabilitadas, buzones compartidos, salas o sin licencia) de todos los % de usuarios.`,
    });
    if (r.license?.businessPremium && Math.abs(r.license.assigned - people.length) > Math.max(5, people.length * 0.1)) {
      quality.push({
        id: 'licenses-vs-people',
        status: 'warn',
        label: 'Licencias vs personas',
        detail: `Hay ${r.license.assigned} licencias Business Premium asignadas y ${people.length} personas con alguna licencia: parte de las personas tiene otra licencia (sin Entra ID P1 / Intune) o hay licencias en cuentas no personales.`,
      });
    }
  }

  // ---- Registro de MFA sobre la base de personas
  if (regRaw) {
    const byId = new Map(regRaw.map((x) => [x.id, x]));
    const base = people ?? regRaw.filter((x) => (x.userType ?? 'member').toLowerCase() !== 'guest');
    let registered = 0;
    let strong = 0;
    for (const p of base) {
      const reg = byId.get(p.id) ?? (people ? undefined : p);
      if (!reg?.isMfaRegistered) continue;
      registered++;
      if ((reg.methodsRegistered ?? []).some((m: string) => STRONG_METHODS.has(m))) strong++;
    }
    const updated = regRaw.map((x) => x.lastUpdatedDateTime).filter(Boolean).sort().pop();
    r.mfa = {
      total: base.length,
      registered,
      pct: base.length ? Math.round((registered / base.length) * 100) : 0,
      strong,
      weakOnly: registered - strong,
      reportUpdated: updated,
    };
    const phoneOnly = registered - strong;
    if (phoneOnly > registered * 0.4 && registered > 0) {
      quality.push({
        id: 'mfa-phone',
        status: 'warn',
        label: 'Registros de MFA solo con teléfono',
        detail: `${phoneOnly} de ${registered} personas "registradas" solo tienen teléfono. Un teléfono cargado por un administrador o por sincronización cuenta como registro aunque la persona nunca haya usado MFA.`,
      });
    }
    quality.push({
      id: 'mfa-report',
      status: 'info',
      label: 'Informe de registro de métodos',
      detail: `Informe de Microsoft (Entra ID → Métodos de autenticación → Detalles de registro de usuario)${updated ? `, actualizado el ${new Date(updated).toLocaleString('es-CL')}` : ''}. Microsoft lo refresca periódicamente: cambios recientes pueden tardar en reflejarse.`,
    });
  }

  // ---- Uso real de MFA (registros de inicio de sesión)
  if (signInRaw) {
    const peopleIds = people ? new Set(people.map((p) => p.id)) : undefined;
    agg = new Map<string, { total: number; mfa: number; last: string }>();
    for (const s of signInRaw) {
      if (!s.userId) continue;
      if (peopleIds && !peopleIds.has(s.userId)) continue;
      if (!peopleIds && String(s.userType ?? '').toLowerCase() === 'guest') continue;
      const a = agg.get(s.userId) ?? { total: 0, mfa: 0, last: '' };
      a.total++;
      if (s.authenticationRequirement === 'multiFactorAuthentication') a.mfa++;
      if (String(s.createdDateTime) > a.last) a.last = String(s.createdDateTime);
      agg.set(s.userId, a);
    }
    const vals = [...agg.values()];
    r.signIns = {
      days: SIGNIN_DAYS,
      records: signInRaw.length,
      truncated: signInRaw.length >= SIGNIN_MAX,
      people: vals.length,
      allMfa: vals.filter((v) => v.mfa === v.total).length,
      partialMfa: vals.filter((v) => v.mfa > 0 && v.mfa < v.total).length,
      noMfa: vals.filter((v) => v.mfa === 0).length,
    };
    if (r.signIns.truncated) {
      quality.push({ id: 'signins-sample', status: 'warn', label: 'Muestra de inicios de sesión', detail: `Se leyeron los ${SIGNIN_MAX} inicios de sesión más recientes: el resultado es una muestra de los últimos ${SIGNIN_DAYS} días.` });
    }
    if (r.mfa && r.signIns.people) {
      const used = Math.round(((r.signIns.allMfa + r.signIns.partialMfa * 0.5) / r.signIns.people) * 100);
      if (r.mfa.pct - used > 15) {
        quality.push({
          id: 'mfa-registered-vs-used',
          status: 'warn',
          label: 'MFA registrado vs MFA usado',
          detail: `${r.mfa.pct}% de las personas tiene MFA registrado, pero solo ≈${used}% de quienes iniciaron sesión en ${SIGNIN_DAYS} días tuvo MFA exigido. Registrar un método no significa usarlo: ${r.securityDefaults ? 'con los valores predeterminados de seguridad Microsoft pide MFA solo en situaciones de riesgo.' : 'ninguna política lo está exigiendo a todos.'}`,
        });
      }
    }
  }

  // ---- Detalle por persona (revisión y CSV)
  if (people && regRaw) {
    const byId = new Map(regRaw.map((x) => [x.id, x]));
    r.mfaUsers = people.map((p) => {
      const reg = byId.get(p.id);
      const methods: string[] = (reg?.methodsRegistered ?? []).filter((m: string) => m !== 'email');
      const a = agg?.get(p.id);
      return {
        upn: p.userPrincipalName,
        name: p.displayName,
        registered: Boolean(reg?.isMfaRegistered),
        strong: methods.some((m) => STRONG_METHODS.has(m)),
        methods,
        signIns: agg ? (a?.total ?? 0) : null,
        mfaSignIns: agg ? (a?.mfa ?? 0) : null,
        lastSignIn: a?.last || undefined,
      };
    });
  }

  if (adminsRaw) {
    const nonUsers = adminsRaw.filter((a) => !String(a['@odata.type'] ?? '#microsoft.graph.user').endsWith('user'));
    if (nonUsers.length) quality.push({ id: 'admins-nonusers', status: 'info', label: 'Administradores globales', detail: `${nonUsers.length} de ${adminsRaw.length} miembros del rol no son usuarios (grupos o aplicaciones).` });
  }
  if (r.secureScore?.date) {
    quality.push({ id: 'secure-score-date', status: 'info', label: 'Secure Score', detail: `Última medición de Microsoft: ${new Date(r.secureScore.date).toLocaleString('es-CL')} (se recalcula una vez al día).` });
  }
  if (r.securityDefaults) {
    quality.push({
      id: 'per-user-mfa-portal',
      status: 'info',
      label: 'Portal "MFA por usuario"',
      detail: 'La página heredada "MFA por usuario" muestra "Deshabilitado" aunque el MFA se exija por valores predeterminados o Acceso Condicional. Para revisar personas use el detalle de abajo (registro + inicios de sesión reales).',
    });
  }
  r.quality = quality;
}
