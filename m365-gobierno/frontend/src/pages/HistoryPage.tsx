import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Job } from '../types';
import { ResultCard } from '../components/StepList';

const STATUS_LABEL: Record<Job['status'], string> = {
  'en-curso': 'En curso',
  completado: 'Completado',
  'con-errores': 'Con errores',
  'con-pendientes': 'Con pasos manuales',
};

export function HistoryPage() {
  const { activeJob, state } = useApp();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<Job | null>(null);

  useEffect(() => {
    api<Job[]>('/jobs').then(setJobs).catch(() => setJobs([]));
  }, [activeJob, state]);

  const show = async (id: string) => setOpen(open?.id === id ? null : await api<Job>(`/jobs/${id}`));

  return (
    <div className="page">
      <h1>Historial de despliegues</h1>
      <p className="muted">Trazabilidad de cada ejecución: qué se creó o actualizó, en qué modo y con qué resultado.</p>
      {jobs.length === 0 && <div className="card empty">Aún no hay despliegues.</div>}
      {jobs.map((j) => (
        <div className="card job-row" key={j.id}>
          <button className="job-row-head" onClick={() => show(j.id)} aria-expanded={open?.id === j.id}>
            <span className={`dot d-${j.status}`} />
            <b>{new Date(j.createdAt).toLocaleString('es-CL')}</b>
            <span className={`pill ${j.mode === 'real' ? 'warn' : 'neutral'}`}>{j.mode === 'real' ? 'Tenant real' : 'Simulación'}</span>
            <span>{STATUS_LABEL[j.status]}</span>
            <span className="muted small">
              {j.items.length} playbooks: {j.items.slice(0, 3).map((i) => i.title).join(', ')}
              {j.items.length > 3 ? '…' : ''}
            </span>
          </button>
          {open?.id === j.id && (
            <div className="job-detail">
              <details>
                <summary>Registro ({open.log?.length ?? 0} líneas)</summary>
                <pre className="code">{open.log?.map((l) => `${l.at.slice(11, 19)}  ${l.msg}`).join('\n')}</pre>
              </details>
              {open.results.map((r) => (
                <ResultCard key={r.playbookId} r={r} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
