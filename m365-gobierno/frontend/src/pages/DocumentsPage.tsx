import { useEffect, useState } from 'react';
import { api, downloadFile, openDocument } from '../api';
import { useApp } from '../store';
import { PILLARS, TIER_LABEL, type Job } from '../types';

const POLICIES = [
  { pillar: 'entra', code: 'GOB-POL-IAM', title: 'Gestión de identidades y control de acceso' },
  { pillar: 'intune', code: 'GOB-POL-END', title: 'Gestión y seguridad de dispositivos' },
  { pillar: 'defender', code: 'GOB-POL-THR', title: 'Protección contra amenazas' },
  { pillar: 'purview', code: 'GOB-POL-DAT', title: 'Clasificación, protección y ciclo de vida de la información' },
];

export function DocumentsPage({ goto }: { goto: (p: string) => void }) {
  const app = useApp();
  const { state, catalog } = app;
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [weeks, setWeeks] = useState([1, 2, 4, 6, 8]);
  const [author, setAuthor] = useState(state.environment.session?.account ?? '');
  const [approver, setApprover] = useState('');
  const [onlyPlan, setOnlyPlan] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Job[]>('/jobs')
      .then((j) => setJobs(j.filter((x) => x.evidenceHash)))
      .catch(() => setJobs([]));
  }, [state.deployments]);

  const open = (path: string, q: Record<string, string | undefined> = {}) =>
    openDocument(path, { author: author || undefined, approver: approver || undefined, ...q }).catch((e) => setError(e.message));

  const planIds = new Set([...state.plan.map((p) => p.playbookId), ...(state.assessment?.recommendation.items.map((i) => i.playbookId) ?? [])]);
  const playbooks = catalog.playbooks.filter((p) => !onlyPlan || planIds.has(p.id) || state.deployments[p.id]);

  return (
    <div className="page">
      <h1>Documentos de gobierno</h1>
      <p className="muted">
        Documentos formales generados desde el Assessment, el plan y los despliegues del ambiente <b>{state.environment.name}</b>. Se abren listos
        para imprimir o guardar como PDF, con tabla de aprobaciones para firma.
      </p>
      {error && <div className="card warn-card">{error}</div>}

      <div className="card">
        <label className="doc-field">
          Elaborado por
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Nombre y cargo" />
        </label>
        <label className="doc-field">
          Aprobado por
          <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Gerencia / Comité de seguridad" />
        </label>
      </div>

      <div className="card">
        <h2>Declaración de aplicabilidad y hoja de ruta · GOB-DEC-01</h2>
        <p className="small">
          Declaración formal del plan de despliegue: hallazgos del Assessment, hoja de ruta con fechas por fase, Declaración de Aplicabilidad (SoA)
          de ISO/IEC 27001:2022 con el estado de cada control, y matriz de cumplimiento de la Ley 21.719.
        </p>
        {!state.assessment ? (
          <p className="warn-text small">
            Requiere un Assessment en este ambiente.{' '}
            <button className="link" onClick={() => goto('assessment')}>
              Ejecutar Assessment
            </button>
          </p>
        ) : (
          <>
            <div className="doc-form">
              <label>
                Inicio del plan
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              {catalog.phases.map((ph, i) => (
                <label key={ph.phase}>
                  Fase {ph.phase} (semanas)
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={weeks[i]}
                    onChange={(e) => setWeeks(weeks.map((w, j) => (j === i ? Number(e.target.value) : w)))}
                  />
                </label>
              ))}
            </div>
            <button className="btn primary" onClick={() => open('/docs/roadmap', { start, weeks: weeks.join(',') })}>
              Generar declaración y hoja de ruta
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Políticas por módulo</h2>
        <p className="small">Cada política incluye objetivo, alcance, referencias ISO 27001 / Ley 21.719, roles, declaraciones con los valores configurados, excepciones y revisión.</p>
        <div className="doc-grid">
          {POLICIES.map((p) => {
            const pl = PILLARS.find((x) => x.id === p.pillar)!;
            return (
              <div key={p.pillar} className="doc-card" style={{ borderTopColor: pl.color }}>
                <span className="muted small">
                  {p.code} · {pl.label}
                </span>
                <b>{p.title}</b>
                <button className="btn" onClick={() => open(`/docs/policy/${p.pillar}`)}>
                  Generar política
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="page-head">
          <h2>Procedimientos de ejecución por acción · GOB-PRC</h2>
          <label className="chip-toggle">
            <input type="checkbox" checked={onlyPlan} onChange={(e) => setOnlyPlan(e.target.checked)} /> Solo acciones del plan / recomendadas
          </label>
        </div>
        <p className="small">Objetivo, justificación, configuración, impacto, prerrequisitos, pasos, criterios de aceptación, plan de reversa y controles cubiertos.</p>
        {PILLARS.map((pl) => {
          const list = playbooks.filter((p) => p.pillar === pl.id);
          if (!list.length) return null;
          return (
            <div key={pl.id}>
              <h3>{pl.label}</h3>
              <ul className="doc-list">
                {list.map((pb) => (
                  <li key={pb.id}>
                    <span>
                      {pb.title} <span className="muted small">· fase {pb.phase}</span>
                      {state.deployments[pb.id]?.status === 'ok' && <span className="ok-mark"> ✓</span>}
                    </span>
                    <button className="link small" onClick={() => open(`/docs/playbook/${pb.id}`)}>
                      Procedimiento
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Actas de evidencia de despliegue · GOB-EVD</h2>
        <p className="small">
          Por cada despliegue: cómo estaba y cómo quedó cada configuración, métricas antes/después, controles ISO 27001 y deberes de la Ley 21.719, con
          huella SHA-256 para verificar que no fue alterada.
        </p>
        {jobs.length === 0 ? (
          <p className="muted small">Aún no hay despliegues con evidencia.</p>
        ) : (
          <ul className="doc-list">
            {jobs.map((j) => (
              <li key={j.id}>
                <span>
                  <span className={`tier t-${j.tier ?? 'sim'}`}>{TIER_LABEL[j.tier ?? 'sim']}</span> {new Date(j.createdAt).toLocaleString('es-CL')} · {j.items.length}{' '}
                  acciones {j.account ? `· ${j.account}` : ''}
                </span>
                <span className="doc-actions">
                  <button className="link small" onClick={() => open(`/docs/evidence/${j.id}`)}>
                    Acta
                  </button>
                  <button className="link small" onClick={() => downloadFile(`/docs/evidence/${j.id}?format=json`, `evidencia-${j.id}.json`).catch((e) => setError(e.message))}>
                    JSON
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
