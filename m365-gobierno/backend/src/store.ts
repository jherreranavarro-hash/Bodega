import fs from 'node:fs';
import path from 'node:path';
import { config, type Mode } from './config.js';
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

interface State {
  deployments: Record<Mode, Record<string, DeploymentRecord>>;
  manualDone: Record<Mode, Record<string, string>>;
  plan: PlanEntry[];
  assessment: Partial<Record<Mode, unknown>>;
  jobs: unknown[];
}

const empty = (): State => ({
  deployments: { simulacion: {}, real: {} },
  manualDone: { simulacion: {}, real: {} },
  plan: [],
  assessment: {},
  jobs: [],
});

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
