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

  const items = state.plan
    .map((e) => ({ entry: e, pb: app.playbook(e.playbookId)! }))
    .filter((x) => x.pb)
    .sort((a, b) => a.pb.phase - b.pb.phase);
  const recOf = (id: string) => state.assessment?.recommendation.items.find((i) => i.playbookId === id);

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results: ItemResult[] }>('/plan/preview', { body: { items: state.plan } });
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
      const r = await api<{ jobId: string }>('/deploy', { body: { items: state.plan, confirm: true, confirmText } });
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
        Arma el plan desde el mapa o cárgalo desde el Assessment. Primero previsualiza (lee el tenant y calcula qué cambiará), luego despliega:
        el motor aplica las políticas en orden, resolviendo dependencias.
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
            <table className="plan-table">
              <thead>
                <tr>
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
                    <tr key={entry.playbookId}>
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
            <div className="plan-actions">
              <button className="btn ghost" onClick={() => app.setPlan([])}>
                Vaciar plan
              </button>
              <button className="btn" onClick={doPreview} disabled={busy}>
                {busy ? 'Analizando tenant…' : '1 · Previsualizar cambios'}
              </button>
              <button className="btn primary" onClick={() => setConfirm(true)} disabled={app.activeJob !== null}>
                2 · Desplegar {items.length} playbooks
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
      {confirm && <ConfirmDeploy playbookIds={items.map((i) => i.pb.id)} onConfirm={doDeploy} onCancel={() => setConfirm(false)} />}
      <p className="muted small">Fases: {catalog.phases.map((p) => `${p.phase} ${p.name}`).join(' · ')}</p>
    </div>
  );
}
