import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Mode } from '../config.js';
import { load, save } from '../store.js';
import { graphFor, grantedRoles, psRunner, tenantInfo } from '../tenant.js';
import { executePlan, type ItemResult, type ResolvedItem } from './runner.js';

export interface Job {
  id: string;
  mode: Mode;
  createdAt: string;
  finishedAt?: string;
  status: 'en-curso' | 'completado' | 'con-errores' | 'con-pendientes';
  items: { playbookId: string; title: string }[];
  results: ItemResult[];
  log: { at: string; msg: string }[];
}

const MAX_JOBS = 40;
const running = new Map<string, Job>();
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

export function getJob(id: string): Job | undefined {
  return running.get(id) ?? (load().jobs as Job[]).find((j) => j.id === id);
}

export function listJobs(): Job[] {
  return [...running.values(), ...(load().jobs as Job[])];
}

export function startJob(items: ResolvedItem[], mode: Mode): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    mode,
    createdAt: new Date().toISOString(),
    status: 'en-curso',
    items: items.map((i) => ({ playbookId: i.playbook.id, title: i.playbook.title })),
    results: [],
    log: [],
  };
  running.set(job.id, job);
  const log = (msg: string) => {
    const entry = { at: new Date().toISOString(), msg };
    job.log.push(entry);
    jobEvents.emit(job.id, { type: 'log', ...entry });
  };
  void (async () => {
    try {
      log(`Despliegue iniciado en modo ${mode === 'real' ? 'REAL (tenant)' : 'simulación'}: ${items.length} playbooks`);
      const tenant = await tenantInfo(mode);
      const results = await executePlan(items, {
        graph: graphFor(mode),
        mode,
        dryRun: false,
        tenant,
        grantedRoles: await grantedRoles(mode).catch(() => undefined),
        manualDone: load().manualDone[mode],
        log,
        runPowerShell: psRunner(mode, tenant, log),
        onResult: (r) => {
          job.results.push(r);
          jobEvents.emit(job.id, { type: 'result', result: r });
        },
      });
      const errors = results.filter((r) => r.status === 'error' || r.status === 'omitido').length;
      const manual = results.filter((r) => r.status === 'manual').length;
      job.status = errors ? 'con-errores' : manual ? 'con-pendientes' : 'completado';
      save((s) => {
        for (const r of results) {
          if (r.status === 'omitido') continue;
          s.deployments[mode][r.playbookId] = {
            playbookId: r.playbookId,
            status: r.status === 'ok' ? 'ok' : r.status === 'manual' ? 'manual' : 'error',
            params: items.find((i) => i.playbook.id === r.playbookId)?.params ?? {},
            at: new Date().toISOString(),
            jobId: job.id,
            summary: r.error ?? `${r.steps.filter((x) => x.action === 'crear' || x.action === 'actualizar').length} cambios`,
          };
        }
      });
      log(`Despliegue terminado: ${results.length - errors - manual} OK, ${manual} con pasos manuales, ${errors} con error`);
    } catch (e: any) {
      job.status = 'con-errores';
      log(`✖ Error general: ${e?.message ?? e}`);
    } finally {
      job.finishedAt = new Date().toISOString();
      running.delete(job.id);
      save((s) => {
        s.jobs = [job, ...(s.jobs as Job[])].slice(0, MAX_JOBS);
      });
      jobEvents.emit(job.id, { type: 'done', status: job.status });
    }
  })();
  return job;
}
