import crypto from 'node:crypto';
import { GraphError, type GraphLike } from './graph/client.js';
import { odataQuote } from './engine/helpers.js';
import { EMERGENCY_GROUP } from './playbooks/entra.js';
import type { ItemResult } from './engine/runner.js';
import { MAX_JOBS, type Job } from './engine/jobs.js';
import { modeOf, type EnvRef } from './environments.js';
import type { TenantInfo } from './engine/types.js';
import { save, saveEvidence } from './store.js';

/*
 * Grupos de seguridad de Entra ID: consulta y asignación masiva de cuentas.
 * Cada aplicación queda en el historial con un acta de evidencia (miembros antes y después).
 */

export type GroupKind = 'asignado' | 'dinamico' | 'microsoft365' | 'correo';
export type MembershipMode = 'agregar' | 'quitar';

export interface GroupView {
  id: string;
  displayName: string;
  description?: string;
  mail?: string;
  kind: GroupKind;
  roleAssignable: boolean;
  synced: boolean;
  membershipRule?: string;
  /** null = no se pudo contar. */
  members: number | null;
  /** Licencias que el grupo asigna a sus miembros (licenciamiento por grupo). */
  licenses: string[];
  /** Políticas de Acceso Condicional que incluyen o excluyen al grupo. */
  conditionalAccess: { include: string[]; exclude: string[] };
  createdDateTime?: string;
  /** Creado por Gobierno M365 (prefijo GOB-). */
  managedByApp: boolean;
  editable: boolean;
  blockedReason?: string;
  warnings: string[];
}

export interface GroupMember {
  id: string;
  type: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
  userType?: string;
  accountEnabled?: boolean;
}

export type EntryStatus = 'agregar' | 'ya-miembro' | 'quitar' | 'no-miembro' | 'no-encontrado' | 'duplicado';

export interface MembershipEntry {
  input: string;
  status: EntryStatus;
  user?: GroupMember;
  notes: string[];
}

export interface MembershipPreview {
  group: GroupView;
  mode: MembershipMode;
  entries: MembershipEntry[];
  /** Textos que no son correos ni identificadores (encabezados de CSV, nombres…). */
  ignored: string[];
  counts: Record<EntryStatus, number>;
  memberCount: number;
}

export interface MembershipChange {
  input: string;
  userId: string;
  upn: string;
  displayName?: string;
  status: 'agregado' | 'quitado' | 'error';
  error?: string;
  /** Confirmado al releer la membresía después del cambio. */
  verified: boolean;
}

export const MAX_ACCOUNTS = 2000;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GROUP_SELECT =
  'id,displayName,description,mail,mailEnabled,securityEnabled,groupTypes,membershipRule,isAssignableToRole,onPremisesSyncEnabled,createdDateTime,assignedLicenses';
const MEMBER_SELECT = 'id,displayName,userPrincipalName,mail,userType,accountEnabled';
const BIND_BATCH = 20;

const badRequest = (message: string) => Object.assign(new Error(message), { status: 400 });

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function kindOf(g: any): GroupKind {
  const types: string[] = g.groupTypes ?? [];
  if (types.includes('DynamicMembership')) return 'dinamico';
  if (types.includes('Unified')) return 'microsoft365';
  if (g.mailEnabled) return 'correo';
  return 'asignado';
}

interface Decorations {
  skus: Map<string, string>;
  ca: Map<string, { include: string[]; exclude: string[] }>;
}

async function decorations(graph: GraphLike): Promise<Decorations> {
  const [skus, policies] = await Promise.all([
    graph.list<any>('/subscribedSkus').catch(() => []),
    graph.list<any>('/identity/conditionalAccess/policies').catch(() => []),
  ]);
  const ca = new Map<string, { include: string[]; exclude: string[] }>();
  const entry = (id: string) => ca.get(id) ?? ca.set(id, { include: [], exclude: [] }).get(id)!;
  for (const p of policies) {
    const users = p?.conditions?.users ?? {};
    const label = `${p.displayName}${p.state === 'enabled' ? '' : p.state === 'disabled' ? ' (deshabilitada)' : ' (solo informe)'}`;
    for (const id of users.includeGroups ?? []) entry(String(id).toLowerCase()).include.push(label);
    for (const id of users.excludeGroups ?? []) entry(String(id).toLowerCase()).exclude.push(label);
  }
  return { skus: new Map(skus.filter((s) => s.skuId).map((s) => [String(s.skuId), s.skuPartNumber ?? s.skuId])), ca };
}

function toView(g: any, deco: Decorations, members: number | null): GroupView {
  const kind = kindOf(g);
  const roleAssignable = g.isAssignableToRole === true;
  const synced = g.onPremisesSyncEnabled === true;
  const ca = deco.ca.get(String(g.id).toLowerCase()) ?? { include: [], exclude: [] };
  const licenses = (g.assignedLicenses ?? []).map((l: any) => deco.skus.get(String(l.skuId)) ?? String(l.skuId));
  let blockedReason: string | undefined;
  if (synced) blockedReason = 'Sincronizado desde Active Directory local: la membresía se administra en el AD de origen.';
  else if (kind === 'dinamico')
    blockedReason = 'Membresía dinámica: los miembros los calcula la regla del grupo y no se pueden agregar ni quitar a mano.';
  else if (kind === 'correo')
    blockedReason =
      'Grupo de seguridad con correo: Microsoft Graph no permite cambiar su membresía. Se administra en Exchange (Add-DistributionGroupMember).';
  else if (roleAssignable)
    blockedReason =
      'Asignable a roles de Entra ID: sus miembros obtienen privilegios de administrador. Adminístralo con PIM y revisiones de acceso, no por carga masiva.';
  const warnings: string[] = [];
  if (g.displayName === EMERGENCY_GROUP)
    warnings.push('Grupo de cuentas de acceso de emergencia: solo deben estar las 2 cuentas break-glass. Toda cuenta agregada queda fuera de MFA.');
  if (ca.exclude.length)
    warnings.push(
      `Excluido de ${ca.exclude.length} ${ca.exclude.length === 1 ? 'política' : 'políticas'} de Acceso Condicional: quien entre a este grupo deja de estar protegido por ellas (por ejemplo, MFA).`,
    );
  if (licenses.length) warnings.push(`Asigna licencias por grupo (${licenses.join(', ')}): cada cuenta agregada consume una licencia.`);
  if (ca.include.length) warnings.push(`Las cuentas agregadas pasan a regirse por ${ca.include.length} ${ca.include.length === 1 ? 'política' : 'políticas'} de Acceso Condicional.`);
  return {
    id: g.id,
    displayName: g.displayName ?? '(sin nombre)',
    description: g.description || undefined,
    mail: g.mail || undefined,
    kind,
    roleAssignable,
    synced,
    membershipRule: g.membershipRule || undefined,
    members,
    licenses,
    conditionalAccess: ca,
    createdDateTime: g.createdDateTime,
    managedByApp: String(g.displayName ?? '').startsWith('GOB-'),
    editable: !blockedReason,
    blockedReason,
    warnings,
  };
}

async function memberCount(graph: GraphLike, id: string): Promise<number | null> {
  try {
    const n = await graph.get<number>(`/groups/${id}/members/$count`, { headers: { ConsistencyLevel: 'eventual' } });
    return typeof n === 'number' ? n : Number.isFinite(Number(n)) ? Number(n) : null;
  } catch {
    return null;
  }
}

/** Grupos con securityEnabled = true (seguridad y Microsoft 365 con seguridad), con conteo de miembros. */
export async function listSecurityGroups(graph: GraphLike): Promise<GroupView[]> {
  const [groups, deco] = await Promise.all([
    graph.list<any>(`/groups?$filter=securityEnabled eq true&$select=${GROUP_SELECT}&$top=999`, { max: 5000 }),
    decorations(graph),
  ]);
  const security = groups.filter((g) => g.securityEnabled !== false);
  const counts = await mapLimit(security, 8, (g) => memberCount(graph, g.id));
  return security
    .map((g, i) => toView(g, deco, counts[i]))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }));
}

function assertGroupId(id: string) {
  if (!/^[\w-]{1,64}$/.test(id)) throw badRequest('Identificador de grupo inválido');
}

export async function getSecurityGroup(graph: GraphLike, id: string): Promise<GroupView> {
  assertGroupId(id);
  const [g, deco] = await Promise.all([graph.get<any>(`/groups/${id}?$select=${GROUP_SELECT}`), decorations(graph)]);
  if (g.securityEnabled === false) throw badRequest(`"${g.displayName}" no es un grupo de seguridad`);
  return toView(g, deco, null);
}

export async function listMembers(graph: GraphLike, id: string): Promise<GroupMember[]> {
  assertGroupId(id);
  const raw = await graph.list<any>(`/groups/${id}/members?$select=${MEMBER_SELECT}&$top=999`, { max: 20000 });
  return raw.map((m) => ({
    id: m.id,
    type: String(m['@odata.type'] ?? '#microsoft.graph.user').replace('#microsoft.graph.', ''),
    displayName: m.displayName ?? undefined,
    userPrincipalName: m.userPrincipalName ?? undefined,
    mail: m.mail ?? undefined,
    userType: m.userType ?? undefined,
    accountEnabled: m.accountEnabled ?? undefined,
  }));
}

/** Separa correos / UPN / identificadores de un texto libre o un CSV pegado. */
export function parseAccounts(input: unknown): { tokens: string[]; ignored: string[] } {
  const text = Array.isArray(input) ? input.join('\n') : String(input ?? '');
  const tokens: string[] = [];
  const ignored: string[] = [];
  for (const raw of text.split(/[\s,;|]+/)) {
    const t = raw.replace(/^[<("'[]+|[>)"'\]]+$/g, '').replace(/^mailto:/i, '');
    if (!t) continue;
    if (EMAIL.test(t) || GUID.test(t)) tokens.push(t);
    else ignored.push(t);
  }
  if (tokens.length > MAX_ACCOUNTS) throw badRequest(`Máximo ${MAX_ACCOUNTS} cuentas por operación (recibidas ${tokens.length})`);
  return { tokens, ignored };
}

async function findUser(graph: GraphLike, token: string): Promise<GroupMember | null> {
  const select = `$select=${MEMBER_SELECT}`;
  const asMember = (u: any): GroupMember => ({ ...u, type: 'user' });
  try {
    return asMember(await graph.get<any>(`/users/${encodeURIComponent(token)}?${select}`));
  } catch (e) {
    if (!(e instanceof GraphError && (e.status === 404 || e.status === 400))) throw e;
  }
  // Invitados y alias: el correo no siempre coincide con el UPN
  if (token.includes('@')) {
    const found = await graph.list<any>(`/users?$filter=mail eq '${encodeURIComponent(odataQuote(token))}'&${select}`, { max: 2 });
    if (found.length === 1) return asMember(found[0]);
  }
  return null;
}

export async function previewMembership(graph: GraphLike, groupId: string, input: unknown, mode: MembershipMode): Promise<MembershipPreview> {
  const group = await getSecurityGroup(graph, groupId);
  const { tokens, ignored } = parseAccounts(input);
  const members = await listMembers(graph, groupId);
  group.members = members.length;
  const memberIds = new Set(members.map((m) => m.id));
  const seenInput = new Set<string>();
  const unique = tokens.filter((t) => {
    const k = t.toLowerCase();
    if (seenInput.has(k)) return false;
    seenInput.add(k);
    return true;
  });
  const users = new Map<string, GroupMember | null>();
  await mapLimit(unique, 8, async (t) => users.set(t.toLowerCase(), await findUser(graph, t)));

  const seenUser = new Set<string>();
  const usedInput = new Set<string>();
  const entries: MembershipEntry[] = tokens.map((input) => {
    const key = input.toLowerCase();
    const user = users.get(key) ?? undefined;
    const notes: string[] = [];
    if (user?.userType === 'Guest') notes.push('Invitado externo');
    if (user?.accountEnabled === false) notes.push('Cuenta deshabilitada');
    if (usedInput.has(key) || (user && seenUser.has(user.id))) return { input, status: 'duplicado', user, notes: ['Repetido en la lista'] };
    usedInput.add(key);
    if (!user) return { input, status: 'no-encontrado', notes: ['No existe en el directorio'] };
    seenUser.add(user.id);
    const isMember = memberIds.has(user.id);
    const status: EntryStatus = mode === 'agregar' ? (isMember ? 'ya-miembro' : 'agregar') : isMember ? 'quitar' : 'no-miembro';
    return { input, status, user, notes };
  });
  const counts = { agregar: 0, 'ya-miembro': 0, quitar: 0, 'no-miembro': 0, 'no-encontrado': 0, duplicado: 0 } as Record<EntryStatus, number>;
  for (const e of entries) counts[e.status]++;
  return { group, mode, entries, ignored: ignored.slice(0, 50), counts, memberCount: members.length };
}

const objectUrl = (id: string) => `https://graph.microsoft.com/v1.0/directoryObjects/${id}`;
const alreadyExists = (e: unknown) => e instanceof GraphError && e.status === 400 && /already exist/i.test(e.message);

export interface ApplyOutcome {
  preview: MembershipPreview;
  changes: MembershipChange[];
  before: GroupMember[];
  after: GroupMember[];
}

/**
 * Aplica la asignación: vuelve a resolver la lista en el servidor (no confía en la previsualización
 * del navegador), agrega en lotes de 20 con `members@odata.bind` y, si un lote falla, reintenta
 * cuenta por cuenta para aislar el error.
 */
export async function applyMembership(
  graph: GraphLike,
  groupId: string,
  input: unknown,
  mode: MembershipMode,
  opts: { ackRisk?: boolean; log?: (m: string) => void } = {},
): Promise<ApplyOutcome> {
  const log = opts.log ?? (() => {});
  const preview = await previewMembership(graph, groupId, input, mode);
  const { group } = preview;
  if (!group.editable) throw badRequest(group.blockedReason ?? 'Este grupo no admite cambios de membresía');
  if (mode === 'agregar' && group.conditionalAccess.exclude.length && opts.ackRisk !== true) {
    throw badRequest('El grupo está excluido de políticas de Acceso Condicional: confirma explícitamente el riesgo para continuar');
  }
  const targets = preview.entries.filter((e) => e.status === (mode === 'agregar' ? 'agregar' : 'quitar') && e.user);
  if (!targets.length) throw badRequest(mode === 'agregar' ? 'No hay cuentas nuevas para agregar' : 'Ninguna cuenta de la lista es miembro del grupo');
  const before = await listMembers(graph, groupId);
  const changes: MembershipChange[] = [];
  const record = (e: MembershipEntry, error?: string) =>
    changes.push({
      input: e.input,
      userId: e.user!.id,
      upn: e.user!.userPrincipalName ?? e.user!.mail ?? e.input,
      displayName: e.user!.displayName,
      status: error ? 'error' : mode === 'agregar' ? 'agregado' : 'quitado',
      error,
      verified: false,
    });

  if (mode === 'agregar') {
    for (let i = 0; i < targets.length; i += BIND_BATCH) {
      const batch = targets.slice(i, i + BIND_BATCH);
      try {
        await graph.patch(`/groups/${groupId}`, { 'members@odata.bind': batch.map((e) => objectUrl(e.user!.id)) });
        batch.forEach((e) => record(e));
        log(`Lote ${i / BIND_BATCH + 1}: ${batch.length} cuentas agregadas a ${group.displayName}`);
      } catch (err: any) {
        log(`Lote ${i / BIND_BATCH + 1} rechazado (${err?.message ?? err}); se reintenta cuenta por cuenta`);
        for (const e of batch) {
          try {
            await graph.post(`/groups/${groupId}/members/$ref`, { '@odata.id': objectUrl(e.user!.id) });
            record(e);
          } catch (one: any) {
            if (alreadyExists(one)) record(e);
            else record(e, one?.message ?? String(one));
          }
        }
      }
    }
  } else {
    await mapLimit(targets, 4, async (e) => {
      try {
        await graph.delete(`/groups/${groupId}/members/${e.user!.id}/$ref`);
        record(e);
      } catch (err: any) {
        if (err instanceof GraphError && err.status === 404) record(e);
        else record(e, err?.message ?? String(err));
      }
    });
  }

  const after = await listMembers(graph, groupId);
  const afterIds = new Set(after.map((m) => m.id));
  for (const c of changes) if (c.status !== 'error') c.verified = mode === 'agregar' ? afterIds.has(c.userId) : !afterIds.has(c.userId);
  return { preview, changes, before, after };
}

const brief = (m: GroupMember) => ({ id: m.id, upn: m.userPrincipalName ?? m.mail, displayName: m.displayName, type: m.type });

/** Deja la operación en el historial de despliegues y en un acta de evidencia con huella SHA-256. */
export function recordMembershipJob(env: EnvRef, tenant: TenantInfo, account: string | undefined, startedAt: string, out: ApplyOutcome): Job {
  const { preview, changes } = out;
  const errors = changes.filter((c) => c.status === 'error');
  const verb = preview.mode === 'agregar' ? 'Agregar' : 'Quitar';
  const title = `${verb} ${changes.length} ${changes.length === 1 ? 'cuenta' : 'cuentas'} ${preview.mode === 'agregar' ? 'a' : 'de'} "${preview.group.displayName}"`;
  const result: ItemResult = {
    playbookId: 'grupos-membresia',
    title,
    engine: 'graph',
    status: errors.length ? 'error' : 'ok',
    steps: changes.map((c) => ({
      action: c.status === 'error' ? 'aviso' : preview.mode === 'agregar' ? 'crear' : 'actualizar',
      target: `${c.status === 'quitado' ? 'Quitado' : c.status === 'agregado' ? 'Agregado' : 'Error'}: ${c.upn}`,
      detail: c.error ?? (c.verified ? undefined : 'No visible aún al releer la membresía (replicación)'),
    })),
    error: errors.length ? `${errors.length} de ${changes.length} cuentas no se pudieron ${preview.mode === 'agregar' ? 'agregar' : 'quitar'}` : undefined,
    missingPermissions: [],
    autoAdded: false,
  };
  const job: Job = {
    id: crypto.randomUUID(),
    kind: 'grupos',
    mode: modeOf(env),
    envId: env.id,
    envName: env.name,
    tier: env.tier,
    account,
    createdAt: startedAt,
    finishedAt: new Date().toISOString(),
    status: errors.length ? 'con-errores' : 'completado',
    items: [{ playbookId: 'grupos-membresia', title }],
    results: [result],
    tenant: { initialDomain: tenant.initialDomain, defaultDomain: tenant.defaultDomain },
    log: [],
  };
  job.evidenceHash = saveEvidence(job.id, {
    kind: 'grupos',
    jobId: job.id,
    environment: { id: env.id, name: env.name, tier: env.tier, tenantId: env.tenantId },
    tenant,
    account,
    startedAt,
    finishedAt: job.finishedAt,
    status: job.status,
    operation: preview.mode,
    group: {
      id: preview.group.id,
      displayName: preview.group.displayName,
      kind: preview.group.kind,
      description: preview.group.description,
      licenses: preview.group.licenses,
      conditionalAccess: preview.group.conditionalAccess,
    },
    requested: { accounts: preview.entries.length, ignored: preview.ignored },
    counts: preview.counts,
    changes,
    skipped: preview.entries
      .filter((e) => e.status !== 'agregar' && e.status !== 'quitar')
      .map((e) => ({ input: e.input, status: e.status, upn: e.user?.userPrincipalName })),
    before: { count: out.before.length, members: out.before.map(brief) },
    after: { count: out.after.length, members: out.after.map(brief) },
  });
  job.log.push({ at: job.finishedAt!, msg: `${title}: ${changes.length - errors.length} correctas, ${errors.length} con error` });
  save((s) => {
    s.jobs = [job, ...(s.jobs as Job[])].slice(0, MAX_JOBS);
  });
  return job;
}

