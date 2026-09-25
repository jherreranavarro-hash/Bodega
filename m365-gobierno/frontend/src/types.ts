export type Pillar = 'entra' | 'intune' | 'defender' | 'purview';
export type Engine = 'graph' | 'exo' | 'ipps' | 'manual';
export type Profile = 'esencial' | 'recomendado' | 'estricto';
export type Params = Record<string, any>;

export interface Tile {
  id: string;
  name: string;
  group: string;
  pillar?: Pillar;
  description: string;
}

export interface ParamDef {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'text' | 'select' | 'multiselect' | 'list';
  default: unknown;
  options?: { value: string; label: string }[];
  help?: string;
  min?: number;
  max?: number;
}

export interface Playbook {
  id: string;
  title: string;
  pillar: Pillar;
  engine: Engine;
  tiles: string[];
  summary: string;
  changes: string[];
  userImpact: string;
  risk: 'bajo' | 'medio' | 'alto';
  phase: number;
  profiles: Profile[];
  params: ParamDef[];
  presets?: Partial<Record<Profile, Params>>;
  permissions: string[];
  extraRequirements?: string[];
  manualSteps?: { text: string; url?: string }[];
  docsUrl?: string;
  experimental?: boolean;
  defaultDependsOn: string[];
  defaults: Params;
}

export interface Catalog {
  tiles: Tile[];
  groups: Record<string, string>;
  playbooks: Playbook[];
  profiles: Profile[];
  phases: { phase: number; name: string; description: string }[];
  requiredPermissions: string[];
}

export interface DeploymentRecord {
  playbookId: string;
  status: 'ok' | 'error' | 'manual';
  params: Params;
  at: string;
  jobId: string;
  summary: string;
}

export interface PlanEntry {
  playbookId: string;
  params?: Params;
}

export interface PlanStep {
  action: 'crear' | 'actualizar' | 'sin-cambios' | 'asegurar' | 'manual' | 'aviso';
  target: string;
  detail?: string;
  payload?: unknown;
}

export interface ItemResult {
  playbookId: string;
  title: string;
  engine: Engine;
  status: 'ok' | 'error' | 'omitido' | 'manual';
  steps: PlanStep[];
  error?: string;
  missingPermissions: string[];
  autoAdded: boolean;
}

export interface Job {
  id: string;
  mode: 'simulacion' | 'real';
  envId?: string;
  envName?: string;
  tier?: Tier;
  account?: string;
  createdAt: string;
  finishedAt?: string;
  status: 'en-curso' | 'completado' | 'con-errores' | 'con-pendientes';
  items: { playbookId: string; title: string }[];
  results: ItemResult[];
  log?: { at: string; msg: string }[];
  metrics?: { before?: MetricValues; after?: MetricValues };
  evidenceHash?: string;
}

export type MetricValues = Record<string, number | null>;

export interface MetricDef {
  key: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
}

export interface MetricSnapshot {
  at: string;
  source: 'assessment' | 'antes-despliegue' | 'despues-despliegue' | 'manual';
  jobId?: string;
  values: MetricValues;
}

export interface Questionnaire {
  company: string;
  employees: number;
  industry: string;
  countries: string[];
  byod: 'no' | 'movil' | 'todo';
  sensitiveData: string[];
  itTeam: 'interno' | 'externo' | 'ninguno';
  tolerance: 'baja' | 'media' | 'alta';
  frameworks: string[];
  onPremAD: boolean;
}

export interface Finding {
  id: string;
  severity: 'critica' | 'alta' | 'media' | 'baja';
  pillar: Pillar;
  title: string;
  detail: string;
  playbooks: string[];
}

export interface RecommendedItem {
  playbookId: string;
  priority: 'P1' | 'P2' | 'P3';
  phase: number;
  reason: string;
  params: Params;
}

export interface Assessment {
  at: string;
  mode: string;
  questionnaire: Questionnaire;
  scan: any;
  recommendation: {
    profile: Profile;
    profileReasons: string[];
    scores: { overall: number; pillars: Record<Pillar, number | null>; checks?: MaturityCheck[] };
    findings: Finding[];
    items: RecommendedItem[];
    roadmap: { phase: number; name: string; description: string; playbooks: string[] }[];
  };
}

export type Tier = 'dev' | 'poc' | 'prd' | 'sim';

export interface Environment {
  id: string;
  name: string;
  kind: 'simulacion' | 'aplicacion' | 'delegado';
  tier: Tier;
  tenantId?: string;
  clientId?: string;
  orgDomain?: string;
  adminUpn?: string;
  connected: boolean;
  session: {
    account: string;
    name?: string;
    scopes: string[];
    globalAdmin: boolean;
    amr: string[];
    signedInAt: string;
    expiresAt: string;
  } | null;
}

export interface AppState {
  mode: 'simulacion' | 'real';
  environment: Environment;
  deployments: Record<string, DeploymentRecord>;
  manualDone: Record<string, string>;
  plan: PlanEntry[];
  assessment: Assessment | null;
  /** playbookId → ambientes DEV/POC donde ya se desplegó correctamente. */
  validatedInLower: Record<string, string[]>;
}

export interface Status {
  mode: 'simulacion' | 'real';
  environment: Environment;
  powershellConfigured: boolean;
  pwshAvailable: boolean;
  forcedSimulation: boolean;
  tenant?: { initialDomain?: string; defaultDomain?: string; country?: string };
  tenantError?: string;
}

export const TIER_LABEL: Record<Tier, string> = { dev: 'DEV', poc: 'POC', prd: 'PRD', sim: 'SIM' };

export const PILLARS: { id: Pillar; label: string; color: string }[] = [
  { id: 'entra', label: 'Entra ID', color: '#1a73e8' },
  { id: 'intune', label: 'Intune', color: '#0f8aa8' },
  { id: 'defender', label: 'Defender', color: '#c2410c' },
  { id: 'purview', label: 'Purview', color: '#7c3aed' },
];

export const pillarLabel = (p?: Pillar) => PILLARS.find((x) => x.id === p)?.label ?? 'Productividad';

export const ENGINE_LABEL: Record<Engine, string> = {
  graph: 'Automático · Microsoft Graph',
  exo: 'Automático · Exchange Online PowerShell',
  ipps: 'Automático · Purview PowerShell',
  manual: 'Guiado · pasos en el portal',
};

export interface MaturityCheck {
  pillar: Pillar;
  id: string;
  label: string;
  why: string;
  weight: number;
  value: number | null;
  detail: string;
  source: string | null;
}
