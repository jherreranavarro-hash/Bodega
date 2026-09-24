import { useState } from 'react';
import type { ItemResult, PlanStep } from '../types';
import { ENGINE_LABEL } from '../types';

const ACTION_LABEL: Record<PlanStep['action'], string> = {
  crear: 'Crear',
  actualizar: 'Actualizar',
  'sin-cambios': 'Sin cambios',
  asegurar: 'Asegurar',
  manual: 'Manual',
  aviso: 'Aviso',
};

function Step({ s }: { s: PlanStep }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`step a-${s.action}`}>
      <span className="step-action">{ACTION_LABEL[s.action]}</span>
      <div className="step-body">
        <div>{s.target}</div>
        {s.detail &&
          (s.action === 'manual' && s.detail.startsWith('http') ? (
            <a href={s.detail} target="_blank" rel="noreferrer" className="small">
              Abrir en el portal ↗
            </a>
          ) : (
            <pre className="step-detail">{s.detail}</pre>
          ))}
        {s.payload !== undefined && (
          <>
            <button className="link small" onClick={() => setOpen(!open)}>
              {open ? 'Ocultar' : 'Ver'} {typeof s.payload === 'string' ? 'script' : 'petición a Graph'}
            </button>
            {open && <pre className="code">{typeof s.payload === 'string' ? s.payload : JSON.stringify(s.payload, null, 2)}</pre>}
          </>
        )}
      </div>
    </li>
  );
}

export function ResultCard({ r }: { r: ItemResult }) {
  return (
    <div className={`result r-${r.status}`}>
      <div className="result-head">
        <strong>{r.title}</strong>
        <span className={`pill s-${r.status}`}>{r.status}</span>
        {r.autoAdded && <span className="pill neutral">dependencia agregada</span>}
        <span className="muted small">{ENGINE_LABEL[r.engine]}</span>
      </div>
      {r.error && <p className={r.status === 'manual' ? 'warn-text small' : 'error-text small'}>{r.error}</p>}
      {r.missingPermissions.length > 0 && (
        <p className="warn-text small">Permisos posiblemente faltantes: {r.missingPermissions.join(', ')}</p>
      )}
      {r.steps.length > 0 && (
        <ul className="steps">
          {r.steps.map((s, i) => (
            <Step key={i} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
