import crypto from 'node:crypto';
import type { Ctx, PlanStep } from './types.js';

/** Prefijo con el que se nombran todos los objetos que crea la aplicación (idempotencia y trazabilidad). */
export const PREFIX = 'GOB';

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

function arraysMatch(desired: unknown[], actual: unknown[]): boolean {
  if (desired.length !== actual.length) return false;
  if (desired.every((x) => !isObj(x))) {
    const a = desired.map((x) => JSON.stringify(x)).sort();
    const b = actual.map((x) => JSON.stringify(x)).sort();
    return a.every((x, i) => x === b[i]);
  }
  // Arreglos de objetos: cada elemento deseado debe estar contenido en alguno real
  return desired.every((d) => actual.some((a) => diff(d, a).length === 0));
}

/** ¿`actual` ya contiene todo lo que pide `desired`? Devuelve las rutas que difieren. */
export function diff(desired: unknown, actual: unknown, base = ''): string[] {
  if (isObj(desired)) {
    if (!isObj(actual)) return [base || '(raíz)'];
    return Object.entries(desired).flatMap(([k, v]) =>
      k.startsWith('@odata') ? [] : diff(v, actual[k], base ? `${base}.${k}` : k),
    );
  }
  if (Array.isArray(desired)) {
    if (!Array.isArray(actual)) return desired.length === 0 && actual == null ? [] : [base];
    return arraysMatch(desired, actual) ? [] : [base];
  }
  if (desired === null || desired === undefined) return [];
  return desired === actual ? [] : [base];
}

export function omit<T extends Record<string, any>>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, any> = { ...obj };
  for (const k of keys) delete out[k];
  return out as Partial<T>;
}

export function fingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

/** Id de marcador para objetos que se crearán en un paso previo durante una previsualización. */
export const pending = (what: string) => `<pendiente:${what}>`;

export const odataQuote = (s: string) => s.replace(/'/g, "''");

export interface EnsureOptions {
  /** Colección, ej. /identity/conditionalAccess/policies */
  path: string;
  name: string;
  nameProp?: string;
  body: Record<string, any>;
  beta?: boolean;
  /** Campos que no se envían en un PATCH (navegaciones o inmutables). */
  updateOmit?: string[];
  /** Usa $filter en vez de listar todo (colecciones grandes como /groups). */
  serverFilter?: boolean;
  label: string;
}

export async function findByName(
  ctx: Ctx,
  path: string,
  name: string,
  opts: { nameProp?: string; beta?: boolean; serverFilter?: boolean } = {},
): Promise<any | undefined> {
  const prop = opts.nameProp ?? 'displayName';
  const url = opts.serverFilter ? `${path}?$filter=${prop} eq '${encodeURIComponent(odataQuote(name))}'` : path;
  const items = await ctx.graph.list<any>(url, { beta: opts.beta });
  return items.find((i) => i?.[prop] === name);
}

/** Crea el objeto si no existe; si existe y difiere, lo actualiza con PATCH. */
export async function ensureObject(ctx: Ctx, o: EnsureOptions): Promise<{ step: PlanStep; id: string; created: boolean; changed: boolean }> {
  const existing = await findByName(ctx, o.path, o.name, o);
  if (!existing) {
    let id = pending(o.name);
    if (!ctx.dryRun) {
      const created = await ctx.graph.post<any>(o.path, o.body, { beta: o.beta });
      id = created?.id ?? id;
      ctx.log(`Creado ${o.label}: ${o.name}`);
    }
    return { step: { action: 'crear', target: `${o.label}: ${o.name}`, payload: o.body }, id, created: true, changed: true };
  }
  const patchBody = omit(o.body, o.updateOmit ?? []);
  const changes = diff(patchBody, existing);
  if (changes.length === 0) {
    return { step: { action: 'sin-cambios', target: `${o.label}: ${o.name}` }, id: existing.id, created: false, changed: false };
  }
  if (!ctx.dryRun) {
    await ctx.graph.patch(`${o.path}/${existing.id}`, patchBody, { beta: o.beta });
    ctx.log(`Actualizado ${o.label}: ${o.name} (${changes.join(', ')})`);
  }
  return {
    step: { action: 'actualizar', target: `${o.label}: ${o.name}`, detail: `Campos: ${changes.join(', ')}`, payload: patchBody },
    id: existing.id,
    created: false,
    changed: true,
  };
}

/** Recursos únicos del tenant (políticas singleton): lee, compara y aplica PATCH. */
export async function ensureSingleton(
  ctx: Ctx,
  o: { path: string; desired: Record<string, any>; label: string; beta?: boolean },
): Promise<PlanStep> {
  const current = await ctx.graph.get<any>(o.path, { beta: o.beta });
  const changes = diff(o.desired, current);
  if (changes.length === 0) return { action: 'sin-cambios', target: o.label };
  if (!ctx.dryRun) {
    await ctx.graph.patch(o.path, o.desired, { beta: o.beta });
    ctx.log(`Actualizado ${o.label} (${changes.join(', ')})`);
  }
  return { action: 'actualizar', target: o.label, detail: `Campos: ${changes.join(', ')}`, payload: o.desired };
}

export const allUsersTarget = { '@odata.type': '#microsoft.graph.allLicensedUsersAssignmentTarget' };
export const allDevicesTarget = { '@odata.type': '#microsoft.graph.allDevicesAssignmentTarget' };
export const groupTarget = (groupId: string) => ({ '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId });

/** Asigna una política de Intune (acción /assign). Solo cuando se creó o cambió. */
export async function assign(
  ctx: Ctx,
  o: { path: string; id: string; targets: Record<string, any>[]; beta?: boolean; label: string },
): Promise<PlanStep> {
  const body = { assignments: o.targets.map((target) => ({ target })) };
  if (!ctx.dryRun) await ctx.graph.post(`${o.path}/${o.id}/assign`, body, { beta: o.beta });
  return { action: 'asegurar', target: `Asignación de ${o.label}`, payload: body };
}

// ---------- Settings Catalog (Intune) ----------

const SC = '#microsoft.graph.deviceManagementConfiguration';

export const sc = {
  choice: (id: string, value: string, children: any[] = []) => ({
    '@odata.type': `${SC}ChoiceSettingInstance`,
    settingDefinitionId: id,
    choiceSettingValue: { '@odata.type': `${SC}ChoiceSettingValue`, value: `${id}_${value}`, children },
  }),
  int: (id: string, value: number) => ({
    '@odata.type': `${SC}SimpleSettingInstance`,
    settingDefinitionId: id,
    simpleSettingValue: { '@odata.type': `${SC}IntegerSettingValue`, value },
  }),
  group: (id: string, children: any[]) => ({
    '@odata.type': `${SC}GroupSettingCollectionInstance`,
    settingDefinitionId: id,
    groupSettingCollectionValue: [{ children }],
  }),
};

/**
 * Política del catálogo de configuración. El catálogo no admite PATCH de settings, así que
 * se guarda una huella en la descripción y, si cambia, se reemplaza con PUT.
 */
export async function ensureSettingsPolicy(
  ctx: Ctx,
  o: { name: string; description: string; settings: any[]; platforms?: string; technologies?: string; targets: Record<string, any>[] },
): Promise<PlanStep[]> {
  const path = '/deviceManagement/configurationPolicies';
  const fp = fingerprint(o.settings);
  const body = {
    name: o.name,
    description: `${o.description} [gob:${fp}]`,
    platforms: o.platforms ?? 'windows10',
    technologies: o.technologies ?? 'mdm',
    settings: o.settings.map((settingInstance) => ({ '@odata.type': `${SC}Setting`, settingInstance })),
  };
  const existing = await findByName(ctx, `${path}?$select=id,name,description`, o.name, { nameProp: 'name', beta: true });
  const label = 'Perfil de configuración (catálogo)';
  let step: PlanStep;
  let id: string;
  if (!existing) {
    id = pending(o.name);
    if (!ctx.dryRun) {
      id = (await ctx.graph.post<any>(path, body, { beta: true })).id;
      ctx.log(`Creado ${label}: ${o.name}`);
    }
    step = { action: 'crear', target: `${label}: ${o.name}`, payload: body };
  } else if (!String(existing.description ?? '').includes(`[gob:${fp}]`)) {
    id = existing.id;
    if (!ctx.dryRun) {
      await ctx.graph.put(`${path}/${id}`, body, { beta: true });
      ctx.log(`Reemplazado ${label}: ${o.name}`);
    }
    step = { action: 'actualizar', target: `${label}: ${o.name}`, detail: 'La configuración deseada cambió', payload: body };
  } else {
    return [{ action: 'sin-cambios', target: `${label}: ${o.name}` }];
  }
  return [step, await assign(ctx, { path, id, targets: o.targets, beta: true, label: o.name })];
}

// ---------- PowerShell ----------

/** Cadena literal de PowerShell (comillas simples, sin interpolación). */
export const psq = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;
export const psArr = (list: unknown[]) => `@(${list.map(psq).join(', ')})`;
export const psBool = (b: unknown) => (b ? '$true' : '$false');

export const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(/[\n,;]+/))
    .map((s) => String(s).trim())
    .filter(Boolean);

/** Hashtable de PowerShell para splatting (@params). */
export function psHash(obj: Record<string, unknown>): string {
  const val = (v: unknown): string =>
    typeof v === 'boolean' ? psBool(v) : typeof v === 'number' ? String(v) : Array.isArray(v) ? psArr(v) : psq(v);
  return `@{ ${Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} = ${val(v)}`)
    .join('; ')} }`;
}
