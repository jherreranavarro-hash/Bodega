import type { Mode } from '../config.js';
import type { GraphLike } from '../graph/client.js';
import { getPlaybook } from '../playbooks/index.js';
import { PowerShellUnavailableError, type PsKind } from '../powershell/runner.js';
import type { Ctx, ParamDef, Params, PlanStep, Playbook, Profile, TenantInfo } from './types.js';
import { EvidenceGraph, clip, type EvidenceEntry } from './evidence.js';

export interface PlanItemInput {
  playbookId: string;
  params?: Params;
}

export interface ResolvedItem {
  playbook: Playbook;
  params: Params;
  /** Agregado automáticamente por ser dependencia de otro. */
  autoAdded: boolean;
}

export type ItemStatus = 'ok' | 'error' | 'omitido' | 'manual';

export interface ItemResult {
  playbookId: string;
  title: string;
  engine: Playbook['engine'];
  status: ItemStatus;
  steps: PlanStep[];
  error?: string;
  missingPermissions: string[];
  autoAdded: boolean;
  /** Parámetros con los que se ejecutó. */
  params?: Params;
  /** Solo en despliegues: estado anterior y posterior de cada recurso modificado. */
  evidence?: EvidenceEntry[];
}

function coerce(def: ParamDef, value: unknown): unknown {
  if (value === undefined || value === null) return def.default;
  switch (def.type) {
    case 'boolean':
      return value === true || value === 'true';
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return def.default;
      return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
    }
    case 'select':
      return def.options?.some((o) => o.value === String(value)) ? String(value) : def.default;
    case 'multiselect': {
      const arr = Array.isArray(value) ? value.map(String) : [];
      return arr.filter((v) => def.options?.some((o) => o.value === v));
    }
    case 'list':
      return (Array.isArray(value) ? value : String(value).split(/\r?\n/))
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 1000);
    default:
      return String(value).slice(0, 2000);
  }
}

/** Valores por defecto → preset del perfil → valores entregados, validados y acotados. */
export function normalizeParams(pb: Playbook, input: Params = {}, profile?: Profile): Params {
  const preset = profile ? pb.presets?.[profile] ?? {} : {};
  const out: Params = {};
  for (const def of pb.params) {
    const raw = def.key in input ? input[def.key] : def.key in preset ? preset[def.key] : def.default;
    out[def.key] = coerce(def, raw);
  }
  return out;
}

export function dependenciesOf(pb: Playbook, params: Params): string[] {
  return typeof pb.dependsOn === 'function' ? pb.dependsOn(params) : pb.dependsOn ?? [];
}

/** Agrega dependencias faltantes y ordena topológicamente (dependencias primero, luego por fase). */
export function resolvePlan(items: PlanItemInput[]): { items: ResolvedItem[]; errors: string[] } {
  const errors: string[] = [];
  const map = new Map<string, ResolvedItem>();
  const queue: ResolvedItem[] = [];
  for (const it of items) {
    const pb = getPlaybook(it.playbookId);
    if (!pb) {
      errors.push(`Playbook desconocido: ${it.playbookId}`);
      continue;
    }
    if (map.has(pb.id)) continue;
    const r = { playbook: pb, params: normalizeParams(pb, it.params), autoAdded: false };
    map.set(pb.id, r);
    queue.push(r);
  }
  while (queue.length) {
    const r = queue.shift()!;
    for (const dep of dependenciesOf(r.playbook, r.params)) {
      if (map.has(dep)) continue;
      const pb = getPlaybook(dep);
      if (!pb) {
        errors.push(`${r.playbook.id} depende de un playbook inexistente: ${dep}`);
        continue;
      }
      const added = { playbook: pb, params: normalizeParams(pb), autoAdded: true };
      map.set(dep, added);
      queue.push(added);
    }
  }
  const sorted: ResolvedItem[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (r: ResolvedItem, chain: string[]) => {
    const s = state.get(r.playbook.id);
    if (s === 'done') return;
    if (s === 'visiting') {
      errors.push(`Dependencia circular: ${[...chain, r.playbook.id].join(' → ')}`);
      return;
    }
    state.set(r.playbook.id, 'visiting');
    for (const dep of dependenciesOf(r.playbook, r.params)) {
      const d = map.get(dep);
      if (d) visit(d, [...chain, r.playbook.id]);
    }
    state.set(r.playbook.id, 'done');
    sorted.push(r);
  };
  const ordered = [...map.values()].sort((a, b) => a.playbook.phase - b.playbook.phase);
  for (const r of ordered) visit(r, []);
  return { items: sorted, errors };
}

const IMPLIED: Record<string, string[]> = {
  'Group.Read.All': ['Group.ReadWrite.All', 'Directory.Read.All', 'Directory.ReadWrite.All'],
  'User.Read.All': ['User.ReadWrite.All', 'Directory.Read.All', 'Directory.ReadWrite.All'],
  'Policy.Read.All': ['Policy.ReadWrite.ConditionalAccess'],
};

export function missingPermissions(required: string[], granted: string[] | undefined): string[] {
  if (!granted) return [];
  return required.filter(
    (p) => !granted.includes(p) && !granted.includes(p.replace('.Read.', '.ReadWrite.')) && !(IMPLIED[p] ?? []).some((i) => granted.includes(i)),
  );
}

export interface ExecuteOptions {
  graph: GraphLike;
  mode: Mode;
  dryRun: boolean;
  tenant: TenantInfo;
  grantedRoles?: string[];
  manualDone?: Record<string, string>;
  log?: (msg: string) => void;
  runPowerShell: (kind: PsKind, script: string) => Promise<string[]>;
  onResult?: (r: ItemResult) => void;
}

/** Ejecuta (o previsualiza) los playbooks en orden, compartiendo salidas entre ellos. */
export async function executePlan(items: ResolvedItem[], o: ExecuteOptions): Promise<ItemResult[]> {
  const log = o.log ?? (() => {});
  const ctx: Ctx = {
    graph: o.graph,
    mode: o.mode,
    dryRun: o.dryRun,
    log,
    outputs: {},
    tenant: o.tenant,
    runPowerShell: o.runPowerShell,
  };
  const failed = new Set<string>();
  const results: ItemResult[] = [];
  for (const { playbook: pb, params, autoAdded } of items) {
    const base = {
      playbookId: pb.id,
      title: pb.title,
      engine: pb.engine,
      autoAdded,
      missingPermissions: missingPermissions(pb.permissions, o.grantedRoles),
    };
    const blockedBy = dependenciesOf(pb, params).filter((d) => failed.has(d));
    let result: ItemResult;
    if (blockedBy.length) {
      failed.add(pb.id);
      result = { ...base, status: 'omitido', steps: [], error: `Omitido porque falló: ${blockedBy.join(', ')}` };
    } else {
      log(`▶ ${pb.title}`);
      // En despliegues cada playbook usa un cliente que registra el antes/después de sus escrituras
      const recorder = o.dryRun ? undefined : new EvidenceGraph(o.graph);
      ctx.graph = recorder ?? o.graph;
      const scriptEvidence: EvidenceEntry[] = [];
      ctx.runPowerShell = async (kind, script) => {
        const lines = await o.runPowerShell(kind, script);
        scriptEvidence.push({
          at: new Date().toISOString(),
          method: 'SCRIPT',
          api: 'powershell',
          resource: kind === 'exo' ? 'Exchange Online PowerShell' : 'Security & Compliance PowerShell',
          before: 'Evaluado por el script: cada bloque consulta el estado actual (Get-*) y solo crea o modifica lo que difiere.',
          after: clip({ salida: lines }),
          request: script,
        });
        return lines;
      };
      try {
        result = await runOne(pb, params, ctx, o);
        result = { ...base, ...result };
      } catch (e: any) {
        failed.add(pb.id);
        const msg = e?.message ?? String(e);
        log(`✖ ${pb.title}: ${msg}`);
        result = { ...base, status: 'error', steps: [], error: msg };
      }
      result.params = params;
      if (recorder) result.evidence = [...recorder.entries, ...scriptEvidence];
    }
    results.push(result);
    o.onResult?.(result);
  }
  return results;
}

async function runOne(pb: Playbook, params: Params, ctx: Ctx, o: ExecuteOptions): Promise<ItemResult> {
  const partial = (status: ItemStatus, steps: PlanStep[], error?: string) =>
    ({ status, steps, error }) as ItemResult;

  if (pb.engine === 'manual') {
    const done = o.manualDone?.[pb.id];
    const steps: PlanStep[] = (pb.manualSteps ?? []).map((s) => ({ action: 'manual', target: s.text, detail: s.url }));
    return partial(done ? 'ok' : 'manual', steps, done ? undefined : 'Requiere pasos manuales en el portal (se marcan como completados desde la ficha).');
  }

  if (pb.engine === 'graph') {
    if (!pb.run) throw new Error('Playbook sin implementación');
    const steps = await pb.run(ctx, params);
    if (pb.manualSteps?.length) {
      steps.push(...pb.manualSteps.map((s) => ({ action: 'manual' as const, target: s.text, detail: s.url })));
    }
    return partial('ok', steps);
  }

  // exo / ipps
  if (!pb.script) throw new Error('Playbook sin script');
  const script = pb.script(params, ctx.tenant);
  const target = pb.engine === 'exo' ? 'Script Exchange Online PowerShell' : 'Script Security & Compliance PowerShell';
  if (ctx.dryRun) return partial('ok', [{ action: 'asegurar', target, detail: 'Script idempotente (crea o actualiza)', payload: script }]);
  try {
    const lines = await ctx.runPowerShell(pb.engine, script);
    return partial('ok', [{ action: 'asegurar', target, detail: lines.join('\n'), payload: script }]);
  } catch (e) {
    if (e instanceof PowerShellUnavailableError) {
      return partial('manual', [{ action: 'manual', target, detail: e.message, payload: script }], `${e.message} Descarga el script y ejecútalo como administrador.`);
    }
    throw e;
  }
}
