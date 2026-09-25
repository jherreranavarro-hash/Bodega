import { useMemo, useState } from 'react';

interface Person {
  upn: string;
  name?: string;
  registered: boolean;
  strong: boolean;
  methods: string[];
  signIns: number | null;
  mfaSignIns: number | null;
  lastSignIn?: string;
}

type Filter = 'todos' | 'sin-registro' | 'solo-telefono' | 'sin-mfa-uso' | 'parcial' | 'con-mfa';

const FILTERS: { id: Filter; label: string; test: (p: Person) => boolean }[] = [
  { id: 'todos', label: 'Todas', test: () => true },
  { id: 'sin-registro', label: 'Sin MFA registrado', test: (p) => !p.registered },
  { id: 'solo-telefono', label: 'Solo teléfono/SMS', test: (p) => p.registered && !p.strong },
  { id: 'sin-mfa-uso', label: 'Inician sesión sin MFA', test: (p) => (p.signIns ?? 0) > 0 && p.mfaSignIns === 0 },
  { id: 'parcial', label: 'MFA solo a veces', test: (p) => (p.mfaSignIns ?? 0) > 0 && (p.mfaSignIns ?? 0) < (p.signIns ?? 0) },
  { id: 'con-mfa', label: 'Siempre con MFA', test: (p) => (p.signIns ?? 0) > 0 && p.mfaSignIns === p.signIns },
];

const METHOD: Record<string, string> = {
  microsoftAuthenticatorPush: 'Authenticator',
  microsoftAuthenticatorPasswordless: 'Authenticator sin contraseña',
  softwareOneTimePasscode: 'Código OTP',
  hardwareOneTimePasscode: 'Token físico',
  fido2SecurityKey: 'FIDO2',
  windowsHelloForBusiness: 'Windows Hello',
  mobilePhone: 'SMS/teléfono',
  alternateMobilePhone: 'Teléfono alternativo',
  officePhone: 'Teléfono de oficina',
};

function csv(rows: Person[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Usuario', 'Nombre', 'MFA registrado', 'Método robusto', 'Métodos', 'Inicios de sesión', 'Con MFA exigido', 'Último inicio'];
  const lines = rows.map((p) =>
    [p.upn, p.name, p.registered ? 'Sí' : 'No', p.strong ? 'Sí' : 'No', p.methods.map((m) => METHOD[m] ?? m).join(' | '), p.signIns ?? '', p.mfaSignIns ?? '', p.lastSignIn ?? '']
      .map(q)
      .join(';'),
  );
  return '﻿' + [head.map(q).join(';'), ...lines].join('\r\n');
}

export function PeopleMfa({ people, days }: { people: Person[]; days?: number }) {
  const [filter, setFilter] = useState<Filter>('sin-mfa-uso');
  const [search, setSearch] = useState('');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, people.filter(f.test).length])), [people]);
  const rows = people
    .filter(FILTERS.find((f) => f.id === filter)!.test)
    .filter((p) => !search || `${p.upn} ${p.name ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.upn.localeCompare(b.upn));

  const download = () => {
    const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mfa-personas-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="people-mfa">
      <div className="select-bar">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label} · {counts[f.id]}
          </button>
        ))}
      </div>
      <div className="select-bar">
        <input type="search" placeholder="Buscar persona…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar persona" />
        <button className="btn" onClick={download}>
          Descargar CSV ({rows.length})
        </button>
      </div>
      <div className="table-scroll people-table">
        <table className="plan-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>MFA registrado</th>
              <th>Métodos</th>
              <th>Inicios de sesión ({days ?? 7} días)</th>
              <th>Con MFA exigido</th>
              <th>Último inicio</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((p) => (
              <tr key={p.upn}>
                <td>
                  {p.upn}
                  {p.name && <div className="muted small">{p.name}</div>}
                </td>
                <td>{p.registered ? (p.strong ? '✓ robusto' : '◐ solo teléfono') : '✗ no'}</td>
                <td className="small">{p.methods.map((m) => METHOD[m] ?? m).join(', ') || '—'}</td>
                <td>{p.signIns ?? 'n/e'}</td>
                <td>{p.mfaSignIns === null ? 'n/e' : `${p.mfaSignIns} de ${p.signIns}`}</td>
                <td className="small">{p.lastSignIn ? new Date(p.lastSignIn).toLocaleString('es-CL') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 500 && <p className="small muted">Se muestran 500 de {rows.length}; descarga el CSV para ver todas.</p>}
      </div>
    </div>
  );
}
