import { scanTenant, type ScanResult } from './assessment/scan.js';
import type { Questionnaire } from './assessment/recommend.js';
import type { EnvRef } from './environments.js';
import { computeMetrics, type MetricSnapshot } from './metrics.js';
import { load, save } from './store.js';
import { graphFor } from './tenant.js';

const MAX_SNAPSHOTS = 500;

/** Lee el tenant (solo lectura), calcula las métricas y las agrega a la serie del ambiente. */
export async function takeSnapshot(env: EnvRef, source: MetricSnapshot['source'], jobId?: string): Promise<MetricSnapshot> {
  // Las mediciones rápidas (antes/después de desplegar) no releen PowerShell ni los inicios de sesión
  const scan = await scanTenant(graphFor(env), { signIns: false });
  const s = load();
  const last = s.assessment[env.id] as { questionnaire?: Questionnaire; scan?: ScanResult } | undefined;
  const q = last?.questionnaire;
  // La lectura por PowerShell es lenta: las mediciones reutilizan la del último Assessment
  if (last?.scan?.probe) scan.probe = last.scan.probe;
  if (last?.scan?.signIns) scan.signIns = last.scan.signIns;
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
