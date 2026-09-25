import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { deploymentsOf, load, save, saveEvidence } from '../store.js';
import { takeSnapshot } from '../snapshots.js';
import type { MetricValues } from '../metrics.js';
import { modeOf, type EnvRef } from '../environments.js';
import { graphFor, grantedRoles, psRunner, tenantInfo } from '../tenant.js';
import { executePlan, type ItemResult, type ResolvedItem } from './runner.js';

export interface Job {
  id: string;
  mode: 'simulacion' | 'real';
  envId: string;
  envName: string;
  tier: EnvRef['tier'];
  /** Cuenta de administrador que autorizó el despliegue (sesión con MFA). */
  account?: string;
  createdAt: string;
  finishedAt?: string;
  status: 'en-curso' | 'completado' | 'con-errores' | 'con-pendientes';
  items: { playbookId: string; title: string }[];
  results: ItemResult[];
  /** Métricas del tenant inmediatamente antes y después del despliegue. */
  metrics?: { before?: MetricValues; after?: MetricValues };
  /** Huella SHA-256 del archivo de evidencia. */
  evidenceHash?: string;
  tenant?: { initialDomain?: string; defaultDomain?: string };
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

export function startJob(items: ResolvedItem[], env: EnvRef, account?: string): Job {
  const mode = modeOf(env);
  const job: Job = {
    id: crypto.randomUUID(),
    mode,
    envId: env.id,
    envName: env.name,
    tier: env.tier,
    account,
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
      log(`Despliegue iniciado en ${env.name}${account ? ` por ${account}` : ''}: ${items.length} playbooks`);
      const tenant = await tenantInfo(env);
      job.tenant = { initialDomain: tenant.initialDomain, defaultDomain: tenant.defaultDomain };
      job.metrics = {};
      try {
        log('Midiendo estado inicial del tenant (métricas "antes")…');
        job.metrics.before = (await takeSnapshot(env, 'antes-despliegue', job.id)).values;
      } catch (e: any) {
        log(`⚠ No se pudieron medir las métricas iniciales: ${e?.message ?? e}`);
      }
      const results = await executePlan(items, {
        graph: graphFor(env),
        mode,
        dryRun: false,
        tenant,
        grantedRoles: await grantedRoles(env).catch(() => undefined),
        manualDone: load().manualDone[env.id] ?? {},
        log,
        runPowerShell: psRunner(env, tenant, log),
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
          deploymentsOf(s, env.id)[r.playbookId] = {
            playbookId: r.playbookId,
            status: r.status === 'ok' ? 'ok' : r.status === 'manual' ? 'manual' : 'error',
            params: items.find((i) => i.playbook.id === r.playbookId)?.params ?? {},
            at: new Date().toISOString(),
            jobId: job.id,
            summary: r.error ?? `${r.steps.filter((x) => x.action === 'crear' || x.action === 'actualizar').length} cambios`,
          };
        }
      });
      try {
        log('Midiendo estado final del tenant (métricas "después")…');
        job.metrics.after = (await takeSnapshot(env, 'despues-despliegue', job.id)).values;
      } catch (e: any) {
        log(`⚠ No se pudieron medir las métricas finales: ${e?.message ?? e}`);
      }
      job.evidenceHash = saveEvidence(job.id, {
        jobId: job.id,
        environment: { id: env.id, name: env.name, tier: env.tier, tenantId: env.tenantId },
        tenant,
        account,
        startedAt: job.createdAt,
        finishedAt: new Date().toISOString(),
        status: job.status,
        metrics: job.metrics,
        results,
      });
      log(`Evidencia registrada (SHA-256 ${job.evidenceHash.slice(0, 16)}…)`);
      log(`Despliegue terminado: ${results.length - errors - manual} OK, ${manual} con pasos manuales, ${errors} con error`);
    } catch (e: any) {
      job.status = 'con-errores';
      log(`✖ Error general: ${e?.message ?? e}`);
    } finally {
      job.finishedAt = new Date().toISOString();
      running.delete(job.id);
      // La evidencia detallada vive en su propio archivo; el historial guarda el resumen
      const summary = { ...job, results: job.results.map(({ evidence: _e, ...r }) => r) };
      save((s) => {
        s.jobs = [summary, ...(s.jobs as Job[])].slice(0, MAX_JOBS);
      });
      jobEvents.emit(job.id, { type: 'done', status: job.status });
    }
  })();
  return job;
}
