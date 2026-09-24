import type { GraphLike } from '../graph/client.js';
import { PREFIX } from '../engine/helpers.js';

export interface ScanResult {
  at: string;
  org?: { name: string; country?: string; defaultDomain?: string; initialDomain?: string };
  license?: { businessPremium: boolean; purchased: number; assigned: number; skus: string[] };
  users?: { members: number; guests: number; disabled: number };
  globalAdmins?: number;
  securityDefaults?: boolean;
  ca?: { total: number; enabled: number; reportOnly: number; requireMfaAll: boolean; blocksLegacy: boolean; gob: string[] };
  mfa?: { total: number; registered: number; pct: number };
  authMethods?: Record<string, string>;
  authorization?: { usersCanCreateApps: boolean; guestInvites: string; legacyConsent: boolean };
  devices?: { total: number; compliant: number; noncompliant: number; encrypted: number; byOs: Record<string, number> };
  intune?: { compliancePolicies: number; configurationProfiles: number; appProtection: number };
  secureScore?: { current: number; max: number; pct: number };
  sharepoint?: { sharingCapability: string };
  namedLocations?: number;
  errors: { area: string; message: string }[];
}

const GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10';

/** Lectura (solo lectura) del estado actual del tenant. Cada área falla de forma independiente. */
export async function scanTenant(graph: GraphLike): Promise<ScanResult> {
  const r: ScanResult = { at: new Date().toISOString(), errors: [] };
  const area = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e: any) {
      r.errors.push({ area: name, message: e?.status === 403 ? 'Sin permiso para leer esta área' : e?.message ?? String(e) });
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
      const users = await graph.list<any>('/users?$select=id,userType,accountEnabled&$top=999', { max: 20000 });
      r.users = {
        members: users.filter((u) => u.userType !== 'Guest').length,
        guests: users.filter((u) => u.userType === 'Guest').length,
        disabled: users.filter((u) => u.accountEnabled === false).length,
      };
    }),
    area('Administradores', async () => {
      const m = await graph.list<any>(`/directoryRoles(roleTemplateId='${GLOBAL_ADMIN}')/members?$select=id`);
      r.globalAdmins = m.length;
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
        requireMfaAll: enabled.some(
          (p) => p.conditions?.users?.includeUsers?.includes('All') && p.grantControls?.builtInControls?.includes('mfa'),
        ),
        blocksLegacy: enabled.some(
          (p) => p.conditions?.clientAppTypes?.includes('other') && p.grantControls?.builtInControls?.includes('block'),
        ),
        gob: ps.map((p) => p.displayName).filter((n: string) => n?.startsWith(PREFIX)),
      };
    }),
    area('Ubicaciones con nombre', async () => {
      r.namedLocations = (await graph.list<any>('/identity/conditionalAccess/namedLocations')).length;
    }),
    area('Registro de MFA', async () => {
      const d = await graph.list<any>('/reports/authenticationMethods/userRegistrationDetails?$select=id,isMfaRegistered', { max: 20000 });
      const registered = d.filter((x) => x.isMfaRegistered).length;
      r.mfa = { total: d.length, registered, pct: d.length ? Math.round((registered / d.length) * 100) : 0 };
    }),
    area('Métodos de autenticación', async () => {
      const cfg = await graph.list<any>('/policies/authenticationMethodsPolicy/authenticationMethodConfigurations');
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
        graph.list<any>('/deviceManagement/deviceCompliancePolicies?$select=id'),
        graph.list<any>('/deviceManagement/deviceConfigurations?$select=id'),
        graph.list<any>('/deviceManagement/configurationPolicies?$select=id', { beta: true }),
        graph.list<any>('/deviceAppManagement/iosManagedAppProtections?$select=id'),
        graph.list<any>('/deviceAppManagement/androidManagedAppProtections?$select=id'),
      ]);
      r.intune = { compliancePolicies: c.length, configurationProfiles: cfg.length + sc.length, appProtection: ios.length + android.length };
    }),
    area('Secure Score', async () => {
      const s = (await graph.list<any>('/security/secureScores?$top=1', { max: 1 }))[0];
      if (s) r.secureScore = { current: Math.round(s.currentScore), max: Math.round(s.maxScore), pct: Math.round((s.currentScore / s.maxScore) * 100) };
    }),
    area('SharePoint', async () => {
      r.sharepoint = { sharingCapability: (await graph.get<any>('/admin/sharepoint/settings'))?.sharingCapability };
    }),
  ]);
  return r;
}
