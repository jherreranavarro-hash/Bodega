import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { ENGINE_LABEL, pillarLabel, type ItemResult } from '../types';
import { ResultCard } from '../components/StepList';
import { ConfirmDeploy } from '../components/ConfirmDeploy';

export function PlanPage({ goto }: { goto: (p: string) => void }) {
  const app = useApp();
  const { state, catalog } = app;
  const [preview, setPreview] = useState<ItemResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // Solo se previsualiza y despliega lo seleccionado (por defecto nada)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = state.plan
    .map((e) => ({ entry: e, pb: app.playbook(e.playbookId)! }))
    .filter((x) => x.pb)
    .sort((a, b) => a.pb.phase - b.pb.phase);
  const recOf = (id: string) => state.assessment?.recommendation.items.find((i) => i.playbookId === id);
  const chosen = state.plan.filter((e) => selected.has(e.playbookId));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
    setPreview(null);
  };
  const selectWhere = (pred: (id: string) => boolean) => {
    setSelected(new Set(items.filter(({ pb }) => pred(pb.id)).map(({ pb }) => pb.id)));
    setPreview(null);
  };
  const phases = [...new Set(items.map(({ pb }) => pb.phase))];
  const isDone = (id: string) => state.deployments[id]?.status === 'ok' || Boolean(state.manualDone[id]);

  // Dependencias que el motor agregará automáticamente (no seleccionadas y aún no desplegadas)
  const autoDeps = (() => {
    const out = new Set<string>();
    const visit = (id: string) => {
      for (const d of app.playbook(id)?.defaultDependsOn ?? []) {
        if (!selected.has(d) && !out.has(d) && !isDone(d)) {
          out.add(d);
          visit(d);
        }
      }
    };
    selected.forEach(visit);
    return [...out];
  })();

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results: ItemResult[] }>('/plan/preview', { body: { items: chosen } });
      setPreview(r.results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doDeploy = async (confirmText: string) => {
    setConfirm(false);
    setError(null);
    try {
      const r = await api<{ jobId: string }>('/deploy', { body: { items: chosen, confirm: true, confirmText } });
      app.watchJob(r.jobId);
      setPreview(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const summary = preview && {
    crear: preview.flatMap((r) => r.steps).filter((s) => s.action === 'crear').length,
    actualizar: preview.flatMap((r) => r.steps).filter((s) => s.action === 'actualizar').length,
    manual: preview.filter((r) => r.status === 'manual').length,
    errores: preview.filter((r) => r.status === 'error' || r.status === 'omitido').length,
  };

  return (
    <div className="page">
      <h1>
        Plan de despliegue <span className={`tier t-${state.environment.tier}`}>{state.environment.name}</span>
      </h1>
      <p className="muted">
        Marca las acciones que quieres aplicar ahora. Primero previsualiza (lee el tenant y calcula qué cambiará), luego despliega solo lo
        seleccionado: el motor lo aplica en orden y agrega los prerrequisitos que falten.
      </p>

      {items.length === 0 ? (
        <div className="card empty">
          El plan está vacío.{' '}
          <button className="link" onClick={() => goto(state.assessment ? 'assessment' : 'map')}>
            {state.assessment ? 'Cargar el plan recomendado del assessment' : 'Elige capacidades en el mapa'}
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="select-bar">
              <span>
                <b>{selected.size}</b> de {items.length} seleccionados
              </span>
              <button className="chip" onClick={() => selectWhere(() => true)}>
                Todos
              </button>
              <button className="chip" onClick={() => selectWhere(() => false)}>
                Ninguno
              </button>
              <button className="chip" onClick={() => selectWhere((id) => !isDone(id))}>
                Pendientes
              </button>
              <button className="chip" onClick={() => selectWhere((id) => recOf(id)?.priority === 'P1' && !isDone(id))}>
                P1 pendientes
              </button>
              {phases.map((ph) => (
                <button key={ph} className="chip" onClick={() => selectWhere((id) => app.playbook(id)?.phase === ph)}>
                  Fase {ph}
                </button>
              ))}
            </div>
            <table className="plan-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos"
                      checked={selected.size === items.length && items.length > 0}
                      onChange={(e) => selectWhere(() => e.target.checked)}
                    />
                  </th>
                  <th>Fase</th>
                  <th>Playbook</th>
                  <th>Pilar</th>
                  <th>Motor</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map(({ entry, pb }) => {
                  const d = state.deployments[pb.id];
                  const rec = recOf(pb.id);
                  return (
                    <tr key={entry.playbookId} className={selected.has(pb.id) ? 'row-selected' : ''}>
                      <td>
                        <input type="checkbox" aria-label={`Seleccionar ${pb.title}`} checked={selected.has(pb.id)} onChange={(e) => toggle(pb.id, e.target.checked)} />
                      </td>
                      <td>{pb.phase}</td>
                      <td>
                        <button className="link" onClick={() => app.openTile(pb.tiles[0])}>
                          {pb.title}
                        </button>
                      </td>
                      <td>{pillarLabel(pb.pillar)}</td>
                      <td className="small">{ENGINE_LABEL[pb.engine]}</td>
                      <td>{rec ? <span className={`prio ${rec.priority}`}>{rec.priority}</span> : '—'}</td>
                      <td className="small">
                        {d ? (d.status === 'ok' ? '✓ desplegado' : d.status === 'manual' ? '⧗ manual' : '✖ error') : 'pendiente'}
                        {state.environment.tier === 'prd' && (
                          <div className="muted">{state.validatedInLower[pb.id] ? `validado en ${state.validatedInLower[pb.id].join(', ')}` : 'sin validar en DEV/POC'}</div>
                        )}
                      </td>
                      <td>
                        <button className="link small" onClick={() => app.removeFromPlan(pb.id)} aria-label={`Quitar ${pb.title}`}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {autoDeps.length > 0 && (
              <p className="small warn-text">
                Se agregarán automáticamente por ser prerrequisitos: {autoDeps.map((d) => app.playbook(d)?.title ?? d).join(' · ')}
              </p>
            )}
            <div className="plan-actions">
              <button className="btn ghost" onClick={() => app.setPlan([])}>
                Vaciar plan
              </button>
              <button className="btn" onClick={doPreview} disabled={busy || selected.size === 0}>
                {busy ? 'Analizando tenant…' : `1 · Previsualizar ${selected.size} seleccionados`}
              </button>
              <button className="btn primary" onClick={() => setConfirm(true)} disabled={app.activeJob !== null || selected.size === 0}>
                2 · Desplegar {selected.size} seleccionados
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>

          {preview && summary && (
            <div className="card">
              <h2>Previsualización</h2>
              <p>
                <b>{summary.crear}</b> objetos a crear · <b>{summary.actualizar}</b> a actualizar · <b>{summary.manual}</b> con pasos manuales ·{' '}
                <b className={summary.errores ? 'error-text' : ''}>{summary.errores}</b> con error
              </p>
              {preview.map((r) => (
                <ResultCard key={r.playbookId} r={r} />
              ))}
            </div>
          )}
        </>
      )}
      {confirm && <ConfirmDeploy playbookIds={chosen.map((c) => c.playbookId)} onConfirm={doDeploy} onCancel={() => setConfirm(false)} />}
      <p className="muted small">Fases: {catalog.phases.map((p) => `${p.phase} ${p.name}`).join(' · ')}</p>
    </div>
  );
}
