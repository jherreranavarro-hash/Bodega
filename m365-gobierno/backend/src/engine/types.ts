import type { GraphLike } from '../graph/client.js';
import type { Mode } from '../config.js';

export type Pillar = 'entra' | 'intune' | 'defender' | 'purview';
export type Engine = 'graph' | 'exo' | 'ipps' | 'manual';
export type Profile = 'esencial' | 'recomendado' | 'estricto';
export type Risk = 'bajo' | 'medio' | 'alto';

export const PROFILES: Profile[] = ['esencial', 'recomendado', 'estricto'];

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamDef {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'text' | 'select' | 'multiselect' | 'list';
  default: unknown;
  options?: ParamOption[];
  help?: string;
  min?: number;
  max?: number;
}

export type Params = Record<string, any>;

export type StepAction = 'crear' | 'actualizar' | 'sin-cambios' | 'asegurar' | 'manual' | 'aviso';

export interface PlanStep {
  action: StepAction;
  target: string;
  detail?: string;
  /** Petición o script que se enviará (visible en la previsualización). */
  payload?: unknown;
}

export interface TenantInfo {
  initialDomain?: string;
  defaultDomain?: string;
  country?: string;
}

export interface Ctx {
  graph: GraphLike;
  mode: Mode;
  /** true: solo lee el tenant y calcula cambios; false: aplica. */
  dryRun: boolean;
  log: (msg: string) => void;
  /** Valores producidos por playbooks previos (ids de grupos, ubicaciones, etc.). */
  outputs: Record<string, any>;
  tenant: TenantInfo;
  /** Ejecuta un script de PowerShell (Exchange Online o Purview). */
  runPowerShell: (kind: 'exo' | 'ipps', script: string) => Promise<string[]>;
}

export interface ManualStep {
  text: string;
  url?: string;
}

export interface Playbook {
  id: string;
  title: string;
  pillar: Pillar;
  engine: Engine;
  /** Cajas del mapa que este playbook configura. */
  tiles: string[];
  summary: string;
  /** Qué se configura, en lenguaje simple. */
  changes: string[];
  userImpact: string;
  risk: Risk;
  /** Fase de la hoja de ruta de gobierno (0 = fundamentos). */
  phase: 0 | 1 | 2 | 3 | 4;
  /** Perfiles de gobierno que lo incluyen. */
  profiles: Profile[];
  params: ParamDef[];
  presets?: Partial<Record<Profile, Params>>;
  dependsOn?: string[] | ((params: Params) => string[]);
  /** Permisos de aplicación de Microsoft Graph que requiere. */
  permissions: string[];
  /** Roles/permisos fuera de Graph (Exchange, Purview). */
  extraRequirements?: string[];
  manualSteps?: ManualStep[];
  docsUrl?: string;
  /** Marcado cuando los identificadores usados deben validarse en un tenant de pruebas. */
  experimental?: boolean;
  /** Motor graph: lee, compara y (si !dryRun) aplica. Debe ser idempotente. */
  run?: (ctx: Ctx, params: Params) => Promise<PlanStep[]>;
  /** Motores exo/ipps: cuerpo de script idempotente (sin la conexión). */
  script?: (params: Params, tenant: TenantInfo) => string;
}

export interface Tile {
  id: string;
  name: string;
  group: TileGroup;
  pillar?: Pillar;
  description: string;
}

export type TileGroup =
  | 'office365'
  | 'defender-o365'
  | 'entra-p1'
  | 'intune-p1'
  | 'ems'
  | 'windows'
  | 'defender-business'
  | 'fasttrack';
