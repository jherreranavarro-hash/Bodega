import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GraphLike, RequestOptions } from './client.js';
import { GraphError } from './client.js';

/**
 * Tenant simulado: una API REST en memoria con la forma de Microsoft Graph.
 * Permite recorrer la aplicación completa (assessment, planes, despliegues)
 * sin credenciales, y es la base de las pruebas automatizadas.
 */
type Store = Record<string, any>;

const ACTIONS = new Set(['assign', 'assignments', '$ref']);

function normalize(p: string): { key: string; query: URLSearchParams } {
  const noHost = p.replace(/^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)/, '');
  const [rawPath, rawQuery = ''] = noHost.split('?');
  const key = ('/' + rawPath.replace(/^\/+|\/+$/g, '')).toLowerCase();
  return { key, query: new URLSearchParams(rawQuery) };
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target: any, src: any): any {
  if (!isPlainObject(target) || !isPlainObject(src)) return src;
  const out: Record<string, any> = { ...target };
  for (const [k, v] of Object.entries(src)) out[k] = deepMerge(target[k], v);
  return out;
}

function applyFilter(items: any[], filter: string | null): any[] {
  if (!filter) return items;
  const m = filter.match(/^(\w+) eq '((?:[^']|'')*)'$/);
  if (!m) return items;
  const [, prop, raw] = m;
  const value = raw.replace(/''/g, "'");
  return items.filter((i) => i?.[prop] === value);
}

export class SimulatedGraph implements GraphLike {
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  private store: Store;

  constructor(private file?: string, seed: () => Store = demoTenant) {
    this.store = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : seed();
  }

  reset(seed: () => Store = demoTenant) {
    this.store = seed();
    this.persist();
  }

  private persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.store, null, 1));
  }

  private locate(key: string): { collection?: any[]; item?: any } {
    const idx = key.lastIndexOf('/');
    const parent = key.slice(0, idx);
    const id = key.slice(idx + 1);
    const coll = this.store[parent];
    if (Array.isArray(coll)) {
      const item = coll.find(
        (i) => String(i.id).toLowerCase() === id || String(i.userPrincipalName ?? '').toLowerCase() === decodeURIComponent(id),
      );
      return { collection: coll, item };
    }
    return {};
  }

  async get<T>(p: string, _opts?: RequestOptions): Promise<T> {
    const { key, query } = normalize(p);
    this.calls.push({ method: 'GET', path: p });
    const refs = this.store[`${key}/$ref`];
    if (key.endsWith('/members') && Array.isArray(refs)) {
      const ids = refs.map((r: any) => String(r['@odata.id']).split('/').pop());
      return { value: (this.store['/users'] ?? []).filter((u: any) => ids.includes(u.id)) } as T;
    }
    const v = this.store[key];
    if (Array.isArray(v)) return { value: applyFilter(v, query.get('$filter')) } as T;
    if (v !== undefined) return structuredClone(v);
    const { collection, item } = this.locate(key);
    if (item) return structuredClone(item);
    if (collection) throw new GraphError(404, 'Request_ResourceNotFound', `No existe ${p}`, p);
    return { value: [] } as T;
  }

  async list<T>(p: string, opts?: RequestOptions & { max?: number }): Promise<T[]> {
    const res: any = await this.get(p, opts);
    return (res?.value ?? []).slice(0, opts?.max ?? 5000);
  }

  async post<T>(p: string, body: any): Promise<T> {
    const { key } = normalize(p);
    this.calls.push({ method: 'POST', path: p, body });
    const last = key.split('/').pop() ?? '';
    if (ACTIONS.has(last)) {
      (this.store[key] ??= []).push(body);
      this.persist();
      return {} as T;
    }
    const item = { id: crypto.randomUUID(), createdDateTime: new Date().toISOString(), ...body };
    if (!Array.isArray(this.store[key])) this.store[key] = [];
    this.store[key].push(item);
    this.persist();
    return structuredClone(item);
  }

  private write(p: string, body: any, replace: boolean) {
    const { key } = normalize(p);
    this.calls.push({ method: replace ? 'PUT' : 'PATCH', path: p, body });
    const current = this.store[key];
    if (isPlainObject(current)) {
      this.store[key] = replace ? body : deepMerge(current, body);
    } else {
      const { collection, item } = this.locate(key);
      if (item && collection) {
        const merged = replace ? { id: item.id, ...body } : deepMerge(item, body);
        collection.splice(collection.indexOf(item), 1, merged);
      } else if (collection) {
        throw new GraphError(404, 'Request_ResourceNotFound', `No existe ${p}`, p);
      } else {
        this.store[key] = body;
      }
    }
    this.persist();
  }

  async patch<T>(p: string, body: unknown): Promise<T> {
    this.write(p, body, false);
    return {} as T;
  }
  async put<T>(p: string, body: unknown): Promise<T> {
    this.write(p, body, true);
    return {} as T;
  }
  async delete(p: string) {
    const { key } = normalize(p);
    this.calls.push({ method: 'DELETE', path: p });
    const { collection, item } = this.locate(key);
    if (collection && item) collection.splice(collection.indexOf(item), 1);
    this.persist();
  }
}

/** Tenant de demostración: una pyme chilena típica con Business Premium recién contratado. */
export function demoTenant(): Store {
  const users = Array.from({ length: 48 }, (_, i) => ({
    id: `u${i}`,
    displayName: `Usuario ${i + 1}`,
    userPrincipalName: `usuario${i + 1}@contoso-demo.cl`,
    userType: i < 42 ? 'Member' : 'Guest',
    accountEnabled: i !== 3 && i !== 17,
  }));
  const oses = ['Windows', 'Windows', 'Windows', 'Windows', 'iOS', 'Android', 'macOS'];
  const devices = Array.from({ length: 31 }, (_, i) => ({
    id: `d${i}`,
    deviceName: `EQ-${1000 + i}`,
    operatingSystem: oses[i % oses.length],
    complianceState: i % 5 === 0 ? 'noncompliant' : i % 4 === 0 ? 'unknown' : 'compliant',
    isEncrypted: i % 3 !== 0,
  }));
  return {
    '/organization': [
      {
        id: '00000000-0000-0000-0000-00000000demo',
        displayName: 'Contoso Demo SpA',
        countryLetterCode: 'CL',
        verifiedDomains: [
          { name: 'contosodemo.onmicrosoft.com', isInitial: true, isDefault: false },
          { name: 'contoso-demo.cl', isInitial: false, isDefault: true },
        ],
      },
    ],
    '/subscribedskus': [
      { skuPartNumber: 'SPB', prepaidUnits: { enabled: 50 }, consumedUnits: 42 },
      { skuPartNumber: 'FLOW_FREE', prepaidUnits: { enabled: 10000 }, consumedUnits: 3 },
    ],
    '/users': users,
    "/directoryroles(roletemplateid='62e90394-69f5-4237-9190-012177145e10')/members": users.slice(0, 5),
    '/policies/identitysecuritydefaultsenforcementpolicy': { id: 'securityDefaults', isEnabled: true },
    '/policies/authorizationpolicy': {
      id: 'authorizationPolicy',
      allowInvitesFrom: 'everyone',
      blockMsolPowerShell: false,
      defaultUserRolePermissions: {
        allowedToCreateApps: true,
        allowedToCreateSecurityGroups: true,
        allowedToCreateTenants: true,
        allowedToReadOtherUsers: true,
        permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'],
      },
    },
    '/policies/authenticationmethodspolicy': { id: 'authenticationMethodsPolicy', registrationEnforcement: {} },
    '/policies/authenticationmethodspolicy/authenticationmethodconfigurations': [
      { id: 'MicrosoftAuthenticator', state: 'enabled' },
      { id: 'Fido2', state: 'disabled' },
      { id: 'TemporaryAccessPass', state: 'disabled' },
      { id: 'Sms', state: 'enabled' },
      { id: 'Voice', state: 'disabled' },
    ],
    '/reports/authenticationmethods/userregistrationdetails': users
      .filter((u) => u.userType === 'Member')
      .map((u, i) => ({
        id: u.id,
        userType: 'member',
        isMfaRegistered: i % 5 < 3,
        isAdmin: i < 5,
        methodsRegistered: i % 5 === 0 ? ['microsoftAuthenticatorPush'] : i % 5 < 3 ? ['mobilePhone'] : [],
      })),
    '/identity/conditionalaccess/policies': [],
    '/identity/conditionalaccess/namedlocations': [],
    '/devicemanagement/manageddevices': devices,
    '/devicemanagement/devicecompliancepolicies': [],
    '/devicemanagement/deviceconfigurations': [],
    '/devicemanagement/configurationpolicies': [],
    '/devicemanagement': { id: 'deviceManagement', settings: { secureByDefault: false } },
    '/devicemanagement/deviceenrollmentconfigurations': [
      {
        id: 'default-whfb',
        '@odata.type': '#microsoft.graph.deviceEnrollmentWindowsHelloForBusinessConfiguration',
        displayName: 'All users and all devices',
        state: 'notConfigured',
      },
    ],
    '/deviceappmanagement/iosmanagedappprotections': [],
    '/deviceappmanagement/androidmanagedappprotections': [],
    '/security/securescores': [
      {
        currentScore: 142,
        maxScore: 380,
        createdDateTime: new Date().toISOString(),
        controlScores: [
          { controlName: 'MFARegistrationV2', controlCategory: 'Identity', score: 6 },
          { controlName: 'BlockLegacyAuthentication', controlCategory: 'Identity', score: 8 },
          { controlName: 'mdo_safelinksforemail', controlCategory: 'Apps', score: 3 },
          { controlName: 'mdo_safeattachments', controlCategory: 'Apps', score: 5 },
          { controlName: 'mip_DLP', controlCategory: 'Data', score: 6 },
          { controlName: 'mip_sensitivitylabels', controlCategory: 'Data', score: 0 },
          { controlName: 'scid_2010', controlCategory: 'Device', score: 4 },
        ],
      },
    ],
    '/security/securescorecontrolprofiles': [
      { id: 'MFARegistrationV2', title: 'Ensure all users can complete multifactor authentication', maxScore: 9, controlCategory: 'Identity', service: 'AzureAD' },
      { id: 'BlockLegacyAuthentication', title: 'Block legacy authentication', maxScore: 8, controlCategory: 'Identity', service: 'AzureAD' },
      { id: 'mdo_safelinksforemail', title: 'Create Safe Links policies for email messages', maxScore: 9, controlCategory: 'Apps', service: 'MDO' },
      { id: 'mdo_safeattachments', title: 'Turn on Safe Attachments in block mode', maxScore: 8, controlCategory: 'Apps', service: 'MDO' },
      { id: 'mip_DLP', title: 'Turn on DLP policies', maxScore: 8, controlCategory: 'Data', service: 'MIP' },
      { id: 'mip_sensitivitylabels', title: 'Publish sensitivity labels', maxScore: 7, controlCategory: 'Data', service: 'MIP' },
      { id: 'scid_2010', title: 'Turn on Microsoft Defender Antivirus', maxScore: 10, controlCategory: 'Device', service: 'MDATP' },
    ],
    '/admin/sharepoint/settings': { sharingCapability: 'externalUserAndGuestSharing', isResharingByExternalUsersEnabled: true },
    '/groups': [],
    '/grouplifecyclepolicies': [],
    '/settings': [],
    '/groupsettingtemplates': [
      { id: '5cf42378-d67d-4f36-ba46-e8b86229381d', displayName: 'Password Rule Settings' },
      { id: '62375ab9-6b52-47ed-826b-58e47e0e304b', displayName: 'Group.Unified' },
    ],
    '/directory/administrativeunits': [],
  };
}
