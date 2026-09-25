import { scanTenant } from './assessment/scan.js';
import type { Questionnaire } from './assessment/recommend.js';
import type { EnvRef } from './environments.js';
import { computeMetrics, type MetricSnapshot } from './metrics.js';
import { load, save } from './store.js';
import { graphFor } from './tenant.js';

const MAX_SNAPSHOTS = 500;

/** Lee el tenant (solo lectura), calcula las métricas y las agrega a la serie del ambiente. */
export async function takeSnapshot(env: EnvRef, source: MetricSnapshot['source'], jobId?: string): Promise<MetricSnapshot> {
  const scan = await scanTenant(graphFor(env));
  const s = load();
  const q = (s.assessment[env.id] as { questionnaire?: Questionnaire } | undefined)?.questionnaire;
  const snapshot: MetricSnapshot = {
    at: new Date().toISOString(),
    source,
    jobId,
    values: computeMetrics(scan, s.deployments[env.id] ?? {}, q),
  };
  recordSnapshot(env.id, snapshot);
  return snapshot;
}

export function recordSnapshot(envId: string, snapshot: MetricSnapshot) {
  save((st) => {
    const list = (st.metrics[envId] ??= []) as MetricSnapshot[];
    list.push(snapshot);
    if (list.length > MAX_SNAPSHOTS) list.splice(0, list.length - MAX_SNAPSHOTS);
  });
}

export function snapshotsOf(envId: string): MetricSnapshot[] {
  return (load().metrics[envId] ?? []) as MetricSnapshot[];
}
