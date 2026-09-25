import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { LineChart } from '../components/LineChart';
import type { Job, MetricDef, MetricSnapshot } from '../types';

const SOURCE: Record<MetricSnapshot['source'], string> = {
  assessment: 'Assessment',
  'antes-despliegue': 'Antes de desplegar',
  'despues-despliegue': 'Después de desplegar',
  manual: 'Medición manual',
};

const shortDate = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });

function Delta({ def, from, to }: { def: MetricDef; from?: number | null; to?: number | null }) {
  if (from == null || to == null) return <span className="delta neutral">sin comparación</span>;
  const d = to - from;
  if (d === 0) return <span className="delta neutral">= sin cambio</span>;
  const better = d > 0 === def.higherIsBetter;
  return (
    <span className={`delta ${better ? 'better' : 'worse'}`}>
      {d > 0 ? '▲' : '▼'} {d > 0 ? '+' : ''}
      {d}
      {def.unit} · {better ? 'mejora' : 'empeora'}
    </span>
  );
}

export function MetricsPage() {
  const { state } = useApp();
  const [defs, setDefs] = useState<MetricDef[]>([]);
  const [snaps, setSnaps] = useState<MetricSnapshot[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const load = async () => {
    const [m, j] = await Promise.all([api<{ defs: MetricDef[]; snapshots: MetricSnapshot[] }>('/metrics'), api<Job[]>('/jobs')]);
    setDefs(m.defs);
    setSnaps(m.snapshots);
    setJobs(j.filter((x) => x.envId === state.environment.id && x.metrics?.before && x.metrics?.after));
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [state.environment.id, state.deployments]);

  const measure = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/metrics/snapshot', { body: {} });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const baseline = snaps[0];
  const current = snaps[snaps.length - 1];
  const labels = useMemo(() => snaps.map((s) => shortDate(s.at)), [snaps]);
  const serie = (k: string) => snaps.map((s) => (s.values[k] ?? null) as number | null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Métricas de avance</h1>
          <p className="muted">
            Cada Assessment y cada despliegue (antes y después) toma una medición del tenant {state.environment.name}. Aquí se compara la línea
            base con el estado actual.
          </p>
        </div>
        <button className="btn primary" onClick={measure} disabled={busy}>
          {busy ? 'Midiendo…' : 'Tomar medición ahora'}
        </button>
      </div>
      {error && <div className="card warn-card">{error}</div>}

      {!current ? (
        <div className="card empty">Aún no hay mediciones. Ejecuta el Assessment o pulsa "Tomar medición ahora".</div>
      ) : (
        <>
          <p className="muted small">
            Línea base: {new Date(baseline.at).toLocaleString('es-CL')} ({SOURCE[baseline.source]}) · Actual: {new Date(current.at).toLocaleString('es-CL')} (
            {SOURCE[current.source]}) · {snaps.length} mediciones
          </p>
          <div className="metric-grid">
            {defs.map((d) => (
              <div className="metric-tile" key={d.key}>
                <span className="metric-label">{d.label}</span>
                <b className="metric-value">
                  {current.values[d.key] ?? 'n/e'}
                  {current.values[d.key] != null ? d.unit : ''}
                </b>
                <span className="muted small">
                  línea base {baseline.values[d.key] ?? 'n/e'}
                  {baseline.values[d.key] != null ? d.unit : ''}
                </span>
                <Delta def={d} from={baseline.values[d.key]} to={current.values[d.key]} />
              </div>
            ))}
          </div>

          <div className="card chart-card">
            <h2>Madurez global</h2>
            <LineChart labels={labels} yMax={100} unit="%" ariaLabel="Evolución de la madurez global" series={[{ name: 'Madurez global', color: '--series-1', values: serie('overall') }]} />
          </div>
          <div className="card chart-card">
            <h2>Madurez por módulo</h2>
            <LineChart
              labels={labels}
              yMax={100}
              unit="%"
              ariaLabel="Evolución de la madurez por módulo"
              series={[
                { name: 'Entra ID', color: '--series-1', values: serie('entra') },
                { name: 'Intune', color: '--series-2', values: serie('intune') },
                { name: 'Defender', color: '--series-3', values: serie('defender') },
                { name: 'Purview', color: '--series-4', values: serie('purview') },
              ]}
            />
            <button className="link small" onClick={() => setShowTable(!showTable)}>
              {showTable ? 'Ocultar' : 'Ver'} tabla de datos
            </button>
            {showTable && (
              <div className="table-scroll">
                <table className="plan-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Origen</th>
                      {defs.map((d) => (
                        <th key={d.key}>{d.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snaps.map((s, i) => (
                      <tr key={i}>
                        <td>{new Date(s.at).toLocaleString('es-CL')}</td>
                        <td>{SOURCE[s.source]}</td>
                        {defs.map((d) => (
                          <td key={d.key}>{s.values[d.key] ?? 'n/e'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="card">
        <h2>Antes y después de cada despliegue</h2>
        {jobs.length === 0 ? (
          <p className="muted">Aún no hay despliegues con medición en este ambiente.</p>
        ) : (
          <div className="table-scroll">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>Despliegue</th>
                  <th>Acciones</th>
                  {['overall', 'secureScore', 'caEnabled', 'findingsHigh', 'controlsDeployed'].map((k) => (
                    <th key={k}>{defs.find((d) => d.key === k)?.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {new Date(j.createdAt).toLocaleString('es-CL')}
                      <div className="muted small">{j.account ?? j.envName}</div>
                    </td>
                    <td>{j.items.length}</td>
                    {['overall', 'secureScore', 'caEnabled', 'findingsHigh', 'controlsDeployed'].map((k) => {
                      const d = defs.find((x) => x.key === k)!;
                      const b = j.metrics?.before?.[k];
                      const a = j.metrics?.after?.[k];
                      return (
                        <td key={k}>
                          {b ?? 'n/e'} → <b>{a ?? 'n/e'}</b>
                          {d && <div><Delta def={d} from={b} to={a} /></div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
