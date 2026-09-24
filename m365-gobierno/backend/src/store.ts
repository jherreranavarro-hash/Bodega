import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { Params } from './engine/types.js';

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

/** Todo lo que depende del tenant se guarda por id de ambiente (simulacion, DEV, POC, PRD…). */
interface State {
  deployments: Record<string, Record<string, DeploymentRecord>>;
  manualDone: Record<string, Record<string, string>>;
  plan: PlanEntry[];
  assessment: Record<string, unknown>;
  jobs: unknown[];
  environments: unknown[];
  activeEnv: string;
}

const empty = (): State => ({
  deployments: {},
  manualDone: {},
  plan: [],
  assessment: {},
  jobs: [],
  environments: [],
  activeEnv: '',
});

export function deploymentsOf(s: State, envId: string): Record<string, DeploymentRecord> {
  return (s.deployments[envId] ??= {});
}

export function manualDoneOf(s: State, envId: string): Record<string, string> {
  return (s.manualDone[envId] ??= {});
}

const file = () => path.join(config.dataDir, 'state.json');
let cache: State | undefined;

export function load(): State {
  if (!cache) {
    try {
      cache = { ...empty(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
    } catch {
      cache = empty();
    }
  }
  return cache!;
}

export function save(mutate: (s: State) => void): State {
  const s = load();
  mutate(s);
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, file());
  return s;
}

/** Solo para pruebas. */
export function resetStore() {
  cache = empty();
}
