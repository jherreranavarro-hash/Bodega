import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { AppState, Catalog, Params, PlanEntry, Playbook, Status, Tile } from './types';

export type TileStatus = 'desplegado' | 'parcial' | 'error' | 'pendiente-manual' | 'sin-configurar' | 'informativo';

interface Ctx {
  catalog: Catalog;
  state: AppState;
  status: Status | null;
  refresh: () => Promise<void>;
  playbook: (id: string) => Playbook | undefined;
  playbooksForTile: (tileId: string) => Playbook[];
  tileStatus: (tileId: string) => TileStatus;
  recommendedParams: (playbookId: string) => Params | undefined;
  planParams: (playbookId: string) => Params | undefined;
  inPlan: (playbookId: string) => boolean;
  setPlan: (plan: PlanEntry[]) => Promise<void>;
  upsertPlan: (playbookId: string, params: Params) => Promise<void>;
  removeFromPlan: (playbookId: string) => Promise<void>;
  openTile: (tileId: string | null) => void;
  openTileId: string | null;
  activeJob: string | null;
  watchJob: (jobId: string | null) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [openTileId, openTile] = useState<string | null>(null);
  const [activeJob, watchJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, st] = await Promise.all([api<AppState>('/state'), api<Status>('/status').catch(() => null)]);
    setState(s);
    setStatus(st);
  }, []);

  useEffect(() => {
    Promise.all([api<Catalog>('/catalog').then(setCatalog), refresh()]).catch((e) => setError(e.message));
  }, [refresh]);

  const value = useMemo<Ctx | null>(() => {
    if (!catalog || !state) return null;
    const byId = new Map(catalog.playbooks.map((p) => [p.id, p]));
    const playbooksForTile = (tileId: string) => catalog.playbooks.filter((p) => p.tiles.includes(tileId));
    const isDone = (pb: Playbook) => state.deployments[pb.id]?.status === 'ok' || Boolean(state.manualDone[pb.id]);
    const tileStatus = (tileId: string): TileStatus => {
      const pbs = playbooksForTile(tileId);
      if (!pbs.length) return 'informativo';
      if (pbs.some((p) => state.deployments[p.id]?.status === 'error')) return 'error';
      const done = pbs.filter(isDone).length;
      if (done === pbs.length) return 'desplegado';
      if (pbs.some((p) => state.deployments[p.id]?.status === 'manual')) return 'pendiente-manual';
      return done > 0 ? 'parcial' : 'sin-configurar';
    };
    const savePlan = async (plan: PlanEntry[]) => {
      setState((s) => (s ? { ...s, plan } : s));
      await api('/plan', { method: 'PUT', body: { items: plan } });
    };
    return {
      catalog,
      state,
      status,
      refresh,
      playbook: (id) => byId.get(id),
      playbooksForTile,
      tileStatus,
      recommendedParams: (id) => state.assessment?.recommendation.items.find((i) => i.playbookId === id)?.params,
      planParams: (id) => state.plan.find((p) => p.playbookId === id)?.params,
      inPlan: (id) => state.plan.some((p) => p.playbookId === id),
      setPlan: savePlan,
      upsertPlan: async (playbookId, params) => {
        const rest = state.plan.filter((p) => p.playbookId !== playbookId);
        await savePlan([...rest, { playbookId, params }]);
      },
      removeFromPlan: async (playbookId) => savePlan(state.plan.filter((p) => p.playbookId !== playbookId)),
      openTile,
      openTileId,
      activeJob,
      watchJob,
    };
  }, [catalog, state, status, refresh, openTileId, activeJob]);

  if (error) return <div className="center-msg error-text">No se pudo cargar la aplicación: {error}</div>;
  if (!value) return <div className="center-msg">Cargando catálogo…</div>;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function tilesOf(catalog: Catalog, group: string): Tile[] {
  return catalog.tiles.filter((t) => t.group === group);
}
