import type { ScanResult } from './assessment/scan.js';
import { DEFAULT_QUESTIONNAIRE, recommend, type Questionnaire } from './assessment/recommend.js';
import type { DeploymentRecord } from './store.js';
import { PLAYBOOKS } from './playbooks/index.js';

/** Indicadores que se comparan antes/después de cada cambio. `higherIsBetter` define el sentido. */
export const METRIC_DEFS = [
  { key: 'overall', label: 'Madurez global', unit: '%', higherIsBetter: true },
  { key: 'entra', label: 'Madurez Entra ID', unit: '%', higherIsBetter: true },
  { key: 'intune', label: 'Madurez Intune', unit: '%', higherIsBetter: true },
  { key: 'defender', label: 'Madurez Defender', unit: '%', higherIsBetter: true },
  { key: 'purview', label: 'Madurez Purview', unit: '%', higherIsBetter: true },
  { key: 'secureScore', label: 'Secure Score', unit: '%', higherIsBetter: true },
  { key: 'mfaPct', label: 'Usuarios con MFA registrado', unit: '%', higherIsBetter: true },
  { key: 'caEnabled', label: 'Políticas de Acceso Condicional aplicadas', unit: '', higherIsBetter: true },
  { key: 'globalAdmins', label: 'Administradores globales', unit: '', higherIsBetter: false },
  { key: 'devicesManaged', label: 'Dispositivos administrados', unit: '', higherIsBetter: true },
  { key: 'compliantPct', label: 'Dispositivos conformes', unit: '%', higherIsBetter: true },
  { key: 'encryptedPct', label: 'Dispositivos cifrados', unit: '%', higherIsBetter: true },
  { key: 'findingsHigh', label: 'Hallazgos críticos y altos', unit: '', higherIsBetter: false },
  { key: 'controlsDeployed', label: 'Controles desplegados', unit: '', higherIsBetter: true },
] as const;

export type MetricKey = (typeof METRIC_DEFS)[number]['key'];
export type MetricValues = Partial<Record<MetricKey, number | null>>;

export interface MetricSnapshot {
  at: string;
  source: 'assessment' | 'antes-despliegue' | 'despues-despliegue' | 'manual';
  jobId?: string;
  values: MetricValues;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

export function computeMetrics(
  scan: ScanResult,
  deployments: Record<string, DeploymentRecord>,
  q: Questionnaire = DEFAULT_QUESTIONNAIRE,
): MetricValues {
  const rec = recommend(scan, q, deployments);
  return {
    overall: rec.scores.overall,
    entra: rec.scores.pillars.entra,
    intune: rec.scores.pillars.intune,
    defender: rec.scores.pillars.defender,
    purview: rec.scores.pillars.purview,
    secureScore: scan.secureScore?.pct ?? null,
    mfaPct: scan.mfa?.pct ?? null,
    caEnabled: scan.ca?.enabled ?? null,
    globalAdmins: scan.globalAdmins ?? null,
    devicesManaged: scan.devices?.total ?? null,
    compliantPct: scan.devices ? pct(scan.devices.compliant, scan.devices.total) : null,
    encryptedPct: scan.devices ? pct(scan.devices.encrypted, scan.devices.total) : null,
    findingsHigh: rec.findings.filter((f) => f.severity === 'critica' || f.severity === 'alta').length,
    controlsDeployed: PLAYBOOKS.filter((p) => deployments[p.id]?.status === 'ok').length,
  };
}
