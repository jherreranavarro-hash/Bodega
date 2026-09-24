import { useEffect, useRef, useState } from 'react';
import { jobEventsUrl } from '../api';
import { useApp } from '../store';
import type { ItemResult, Job } from '../types';
import { ResultCard } from './StepList';

/** Panel flotante que sigue un despliegue en vivo (Server-Sent Events). */
export function JobMonitor() {
  const { activeJob, watchJob, refresh } = useApp();
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [status, setStatus] = useState<Job['status']>('en-curso');
  const [expanded, setExpanded] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeJob) return;
    setLog([]);
    setResults([]);
    setStatus('en-curso');
    setExpanded(true);
    const es = new EventSource(jobEventsUrl(activeJob));
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'log') setLog((l) => [...l, ev.msg]);
      if (ev.type === 'result') setResults((r) => [...r, ev.result]);
      if (ev.type === 'done') {
        setStatus(ev.status);
        es.close();
        void refresh();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [activeJob, refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  if (!activeJob) return null;
  const ok = results.filter((r) => r.status === 'ok').length;
  return (
    <aside className={`job-monitor${expanded ? '' : ' collapsed'}`} aria-live="polite">
      <header>
        <span className={`dot d-${status}`} />
        <strong>Despliegue {status === 'en-curso' ? 'en curso…' : status.replace('-', ' ')}</strong>
        <span className="muted small">
          {ok}/{results.length} OK
        </span>
        <button className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Minimizar' : 'Expandir'}
        </button>
        {status !== 'en-curso' && (
          <button className="link" onClick={() => watchJob(null)} aria-label="Cerrar">
            ✕
          </button>
        )}
      </header>
      {expanded && (
        <div className="job-body">
          <div className="job-log" ref={logRef}>
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
          <div className="job-results">
            {results.map((r) => (
              <ResultCard key={r.playbookId} r={r} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
