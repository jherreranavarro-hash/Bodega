import { useEffect, useState } from 'react';
import { api, getToken } from '../api';
import { useApp } from '../store';
import { ENGINE_LABEL, pillarLabel, type ItemResult, type Params, type Playbook } from '../types';
import { ParamForm, cleanParams } from './ParamForm';
import { ResultCard } from './StepList';
import { ConfirmDeploy } from './ConfirmDeploy';

const RISK_LABEL = { bajo: 'Riesgo bajo', medio: 'Riesgo medio', alto: 'Riesgo alto' };

function PlaybookCard({ pb }: { pb: Playbook }) {
  const app = useApp();
  const { state, catalog } = app;
  const initial = app.planParams(pb.id) ?? app.recommendedParams(pb.id) ?? pb.defaults;
  const [values, setValues] = useState<Params>(initial);
  const [preview, setPreview] = useState<ItemResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const deployment = state.deployments[pb.id];
  const rec = state.assessment?.recommendation.items.find((i) => i.playbookId === pb.id);
  const planned = app.inPlan(pb.id);
  const manualDone = state.manualDone[pb.id];
  const params = cleanParams(pb.params, values);
  const deps = pb.defaultDependsOn.map((d) => app.playbook(d)?.title ?? d);

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const doPreview = () =>
    act('preview', async () => {
      const r = await api<{ results: ItemResult[] }>('/plan/preview', { body: { items: [{ playbookId: pb.id, params }] } });
      setPreview(r.results);
    });

  const doDeploy = (confirmText: string) =>
    act('deploy', async () => {
      setConfirm(false);
      const r = await api<{ jobId: string }>('/deploy', { body: { items: [{ playbookId: pb.id, params }], confirm: true, confirmText } });
      app.watchJob(r.jobId);
    });

  const downloadScript = () =>
    act('script', async () => {
      const res = await fetch(`/api/playbooks/${pb.id}/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
        body: JSON.stringify({ params }),
      });
      if (!res.ok) throw new Error('No se pudo generar el script');
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pb.id}.ps1`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const toggleManual = () =>
    act('manual', async () => {
      await api(`/manual/${pb.id}`, { body: { done: !manualDone } });
      await app.refresh();
    });

  return (
    <article className="pb-card">
      <header className="pb-head">
        <h3>{pb.title}</h3>
        <div className="pb-tags">
          <span className={`pill engine-${pb.engine}`}>{ENGINE_LABEL[pb.engine]}</span>
          <span className={`pill risk-${pb.risk}`}>{RISK_LABEL[pb.risk]}</span>
          <span className="pill neutral">Fase {pb.phase} · {catalog.phases[pb.phase]?.name}</span>
          {pb.experimental && <span className="pill warn">Validar en tenant de pruebas</span>}
        </div>
      </header>

      {rec && (
        <div className={`rec-box pr-${rec.priority}`}>
          <b>{rec.priority} · Recomendado para tu empresa.</b> {rec.reason}
        </div>
      )}
      {deployment && (
        <div className={`deploy-box d-${deployment.status}`}>
          Último despliegue: {new Date(deployment.at).toLocaleString('es-CL')} — {deployment.status === 'ok' ? 'correcto' : deployment.status === 'manual' ? 'requiere pasos manuales' : 'con error'} ({deployment.summary})
        </div>
      )}

      <p>{pb.summary}</p>
      <div className="pb-cols">
        <div>
          <h4>Qué se configura</h4>
          <ul className="bullets">
            {pb.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Impacto en los usuarios</h4>
          <p className="small">{pb.userImpact}</p>
          {deps.length > 0 && (
            <>
              <h4>Requiere antes</h4>
              <p className="small">{deps.join(' · ')} (se agregan solos al plan)</p>
            </>
          )}
        </div>
      </div>

      {pb.engine !== 'manual' && (
        <details className="params" open={pb.params.length > 0}>
          <summary>Parámetros</summary>
          <ParamForm defs={pb.params} values={values} onChange={setValues} idPrefix={pb.id} />
        </details>
      )}

      {pb.manualSteps && pb.manualSteps.length > 0 && (
        <div className="manual">
          <h4>{pb.engine === 'manual' ? 'Pasos guiados (sin API pública de Microsoft)' : 'Pasos complementarios'}</h4>
          <ol>
            {pb.manualSteps.map((s) => (
              <li key={s.text}>
                {s.text}{' '}
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    Abrir ↗
                  </a>
                )}
              </li>
            ))}
          </ol>
          {pb.engine === 'manual' && (
            <button className={`btn ${manualDone ? '' : 'primary'}`} onClick={toggleManual} disabled={busy !== null}>
              {manualDone ? '✓ Completado — desmarcar' : 'Marcar como completado'}
            </button>
          )}
        </div>
      )}

      <details className="reqs">
        <summary>Requisitos y documentación</summary>
        {pb.permissions.length > 0 && <p className="small">Permisos Graph: {pb.permissions.join(', ')}</p>}
        {pb.extraRequirements?.map((r) => (
          <p className="small" key={r}>
            {r}
          </p>
        ))}
        {pb.docsUrl && (
          <a className="small" href={pb.docsUrl} target="_blank" rel="noreferrer">
            Documentación de Microsoft ↗
          </a>
        )}
      </details>

      {error && <p className="error-text">{error}</p>}

      <div className="pb-actions">
        {planned ? (
          <>
            <button className="btn" onClick={() => act('plan', () => app.upsertPlan(pb.id, params))} disabled={busy !== null}>
              Actualizar en el plan
            </button>
            <button className="btn ghost" onClick={() => act('plan', () => app.removeFromPlan(pb.id))} disabled={busy !== null}>
              Quitar del plan
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => act('plan', () => app.upsertPlan(pb.id, params))} disabled={busy !== null}>
            + Agregar al plan
          </button>
        )}
        {pb.engine !== 'manual' && (
          <>
            <button className="btn" onClick={doPreview} disabled={busy !== null}>
              {busy === 'preview' ? 'Analizando tenant…' : 'Previsualizar cambios'}
            </button>
            <button className="btn primary" onClick={() => setConfirm(true)} disabled={busy !== null || app.activeJob !== null}>
              Desplegar ahora
            </button>
          </>
        )}
        {(pb.engine === 'exo' || pb.engine === 'ipps') && (
          <button className="btn ghost" onClick={downloadScript} disabled={busy !== null}>
            Descargar script .ps1
          </button>
        )}
      </div>

      {preview && (
        <div className="preview">
          <h4>Previsualización (no se aplicó nada)</h4>
          {preview.map((r) => (
            <ResultCard key={r.playbookId} r={r} />
          ))}
        </div>
      )}
      {confirm && <ConfirmDeploy playbookIds={[pb.id]} onConfirm={doDeploy} onCancel={() => setConfirm(false)} />}
    </article>
  );
}

export function TileModal() {
  const app = useApp();
  const tile = app.catalog.tiles.find((t) => t.id === app.openTileId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && app.openTile(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  if (!tile) return null;
  const pbs = app.playbooksForTile(tile.id);
  const findings = app.state.assessment?.recommendation.findings.filter((f) => f.playbooks.some((p) => pbs.some((x) => x.id === p))) ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && app.openTile(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tile-title">
        <header className={`modal-head g-${tile.group}`}>
          <div>
            <div className="modal-kicker">
              {app.catalog.groups[tile.group]} · {pillarLabel(tile.pillar)}
            </div>
            <h2 id="tile-title">{tile.name}</h2>
          </div>
          <button className="close" onClick={() => app.openTile(null)} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <p className="lead">{tile.description}</p>
          {findings.length > 0 && (
            <div className="findings-inline">
              {findings.map((f) => (
                <div key={f.id} className={`finding sev-${f.severity}`}>
                  <span className="sev">{f.severity}</span> {f.title}
                </div>
              ))}
            </div>
          )}
          {pbs.length === 0 ? (
            <div className="info-box">
              <b>Incluido en tu licencia.</b> Esta capacidad no requiere configuración de seguridad desde esta aplicación: está disponible para
              los usuarios con licencia. Su gobierno se hereda de las políticas de identidad (Entra ID), dispositivos (Intune) y datos
              (Purview) que apliques en las demás cajas.
            </div>
          ) : (
            pbs.map((pb) => <PlaybookCard key={pb.id} pb={pb} />)
          )}
        </div>
      </div>
    </div>
  );
}
