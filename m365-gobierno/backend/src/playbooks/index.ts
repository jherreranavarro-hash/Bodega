import type { Playbook } from '../engine/types.js';
import { entraPlaybooks } from './entra.js';
import { intunePlaybooks } from './intune.js';
import { defenderPlaybooks } from './defender.js';
import { purviewPlaybooks } from './purview.js';

export const PLAYBOOKS: Playbook[] = [...entraPlaybooks, ...intunePlaybooks, ...defenderPlaybooks, ...purviewPlaybooks];

const byId = new Map(PLAYBOOKS.map((p) => [p.id, p]));

export function getPlaybook(id: string): Playbook | undefined {
  return byId.get(id);
}
