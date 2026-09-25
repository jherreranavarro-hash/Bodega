import { useState } from 'react';
import { PILLARS, type MaturityCheck, type Pillar } from '../types';

const PILLAR_TEXT: Record<Pillar, string> = {
  entra: 'Qué tan protegido está el acceso: MFA, bloqueo de protocolos antiguos, privilegios de administración y permisos de los usuarios.',
  intune: 'Qué tan controlados y sanos están los dispositivos que acceden a la información: inscripción, cumplimiento, cifrado y apps móviles.',
  defender: 'Qué tan protegidos están el correo, la colaboración y los equipos frente a phishing, malware y ransomware.',
  purview: 'Qué tan clasificada, protegida contra fugas, auditada y conservada está la información (incluidos datos personales).',
};

function Result({ c }: { c: MaturityCheck }) {
  if (c.value === null) return <span className="res res-ne">n/e · no evaluado</span>;
  const pct = Math.round(c.value * 100);
  const cls = pct >= 100 ? 'res-ok' : pct > 0 ? 'res-part' : 'res-no';
  const icon = pct >= 100 ? '✓' : pct > 0 ? '◐' : '✗';
  return (
    <span className={`res ${cls}`}>
      {icon} {pct}%
    </span>
  );
}

export function MaturityBreakdown({ checks, pillars, initial }: { checks: MaturityCheck[]; pillars: Record<Pillar, number | null>; initial?: Pillar }) {
  const [tab, setTab] = useState<Pillar>(initial ?? 'entra');
  const list = checks.filter((c) => c.pillar === tab);
  const evaluated = list.filter((c) => c.value !== null);
  const total = evaluated.reduce((a, c) => a + c.weight, 0);
  const got = evaluated.reduce((a, c) => a + c.weight * (c.value ?? 0), 0);
  return (
    <div className="card">
      <h2>¿Cómo se calcula la madurez?</h2>
      <p className="small">
        Cada módulo se evalúa con criterios que tienen un <b>peso</b> según su impacto en la seguridad. Cada criterio suma su peso multiplicado por
        su cumplimiento (0% a 100%), usando lo que <b>se leyó del tenant</b>. El % del módulo es lo obtenido sobre el total de los criterios que se
        pudieron evaluar: los <b>no evaluados (n/e)</b> no suman ni restan. La madurez global es el promedio de los módulos.
      </p>
      <div className="tabs" role="tablist">
        {PILLARS.map((p) => (
          <button key={p.id} role="tab" aria-selected={tab === p.id} className={tab === p.id ? 'on' : ''} onClick={() => setTab(p.id)} style={{ ['--chip' as string]: p.color }}>
            {p.label} · {pillars[p.id] === null ? 'n/e' : `${pillars[p.id]}%`}
          </button>
        ))}
      </div>
      <p className="small muted">{PILLAR_TEXT[tab]}</p>
      <div className="table-scroll">
        <table className="plan-table">
          <thead>
            <tr>
              <th>Criterio</th>
              <th>Peso</th>
              <th>Resultado</th>
              <th>Qué se detectó</th>
              <th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.label}</b>
                  <div className="muted small">{c.why}</div>
                </td>
                <td>{c.weight}</td>
                <td>
                  <Result c={c} />
                </td>
                <td className="small">{c.detail}</td>
                <td className="small muted">{c.source ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        Cálculo: {Math.round(got * 10) / 10} de {total} puntos evaluables = <b>{total ? Math.round((got / total) * 100) : 0}%</b>
        {list.length > evaluated.length && ` · ${list.length - evaluated.length} criterio(s) no evaluado(s)`}
      </p>
    </div>
  );
}
