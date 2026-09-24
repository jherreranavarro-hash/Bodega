import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { PILLARS, type Assessment, type Profile, type Questionnaire } from '../types';

const INDUSTRIES = [
  ['retail', 'Retail / comercio'],
  ['servicios', 'Servicios profesionales'],
  ['financiero', 'Financiero / seguros'],
  ['salud', 'Salud'],
  ['manufactura', 'Manufactura / logística'],
  ['educacion', 'Educación'],
  ['publico', 'Sector público'],
  ['tecnologia', 'Tecnología'],
  ['otro', 'Otro'],
];
const DATA = [
  ['personales', 'Datos personales (clientes, colaboradores)'],
  ['tarjetas', 'Datos de tarjetas de pago'],
  ['salud', 'Datos de salud'],
  ['financieros', 'Información financiera / bancaria'],
  ['propiedad', 'Propiedad intelectual / secretos comerciales'],
];
const FRAMEWORKS = [
  ['ley21719', 'Ley 21.719 Protección de datos personales (Chile)'],
  ['ley21663', 'Ley 21.663 Marco de ciberseguridad (Chile)'],
  ['iso27001', 'ISO 27001'],
  ['pci', 'PCI DSS'],
];
const SEV_LABEL = { critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja' };
const PROFILE_TEXT: Record<Profile, string> = {
  esencial: 'Controles de alto impacto y bajo mantenimiento. Ideal sin equipo de TI dedicado.',
  recomendado: 'La línea base de Microsoft para Business Premium: Zero Trust gradual con modo informe primero.',
  estricto: 'Para datos regulados o sensibles: MFA resistente a phishing, bloqueo ASR, DLP aplicada y cifrado.',
};

function toggle(list: string[], v: string, on: boolean) {
  return on ? [...new Set([...list, v])] : list.filter((x) => x !== v);
}

export function AssessmentPage({ goto }: { goto: (p: string) => void }) {
  const app = useApp();
  const prev = app.state.assessment;
  const [q, setQ] = useState<Questionnaire>(
    prev?.questionnaire ?? {
      company: '',
      employees: 50,
      industry: 'servicios',
      countries: ['CL'],
      byod: 'movil',
      sensitiveData: ['personales'],
      itTeam: 'externo',
      tolerance: 'media',
      frameworks: ['ley21719'],
      onPremAD: false,
    },
  );
  const [profile, setProfile] = useState<'' | Profile>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upToPhase, setUpToPhase] = useState(4);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<Assessment>('/assessment', { body: { questionnaire: q, profile: profile || undefined } });
      await app.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const loadPlan = async () => {
    if (!prev) return;
    const items = prev.recommendation.items.filter((i) => i.phase <= upToPhase).map((i) => ({ playbookId: i.playbookId, params: i.params }));
    await app.setPlan(items);
    goto('plan');
  };

  const rec = prev?.recommendation;
  const scan = prev?.scan;

  return (
    <div className="page">
      <h1>Assessment de gobierno</h1>
      <p className="muted">
        Lee el estado actual del tenant (solo lectura) y combina el resultado con el contexto de tu empresa para proponer el perfil de
        gobierno y la hoja de ruta más adecuados.
      </p>

      <div className="assessment-layout">
        <form
          className="card questionnaire"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <h2>Contexto de la empresa</h2>
          <label>
            Nombre de la empresa
            <input value={q.company} onChange={(e) => setQ({ ...q, company: e.target.value })} placeholder="Ej: Comercial Andes SpA" />
          </label>
          <div className="two">
            <label>
              Colaboradores
              <input type="number" min={1} max={300} value={q.employees} onChange={(e) => setQ({ ...q, employees: Number(e.target.value) })} />
            </label>
            <label>
              Industria
              <select value={q.industry} onChange={(e) => setQ({ ...q, industry: e.target.value })}>
                {INDUSTRIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Países donde opera o viajan (códigos ISO, separados por coma)
            <input
              value={q.countries.join(', ')}
              onChange={(e) => setQ({ ...q, countries: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })}
            />
          </label>
          <fieldset>
            <legend>¿Usan equipos personales (BYOD)?</legend>
            {[
              ['no', 'No, solo equipos de la empresa'],
              ['movil', 'Solo celulares personales'],
              ['todo', 'Celulares y computadores personales'],
            ].map(([v, l]) => (
              <label key={v} className="radio">
                <input type="radio" name="byod" checked={q.byod === v} onChange={() => setQ({ ...q, byod: v as Questionnaire['byod'] })} /> {l}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Información que manejan</legend>
            {DATA.map(([v, l]) => (
              <label key={v} className="radio">
                <input type="checkbox" checked={q.sensitiveData.includes(v)} onChange={(e) => setQ({ ...q, sensitiveData: toggle(q.sensitiveData, v, e.target.checked) })} /> {l}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Normativas aplicables</legend>
            {FRAMEWORKS.map(([v, l]) => (
              <label key={v} className="radio">
                <input type="checkbox" checked={q.frameworks.includes(v)} onChange={(e) => setQ({ ...q, frameworks: toggle(q.frameworks, v, e.target.checked) })} /> {l}
              </label>
            ))}
          </fieldset>
          <div className="two">
            <label>
              Equipo de TI
              <select value={q.itTeam} onChange={(e) => setQ({ ...q, itTeam: e.target.value as Questionnaire['itTeam'] })}>
                <option value="interno">Interno</option>
                <option value="externo">Externo / proveedor</option>
                <option value="ninguno">No hay</option>
              </select>
            </label>
            <label>
              Tolerancia de usuarios al cambio
              <select value={q.tolerance} onChange={(e) => setQ({ ...q, tolerance: e.target.value as Questionnaire['tolerance'] })}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </select>
            </label>
          </div>
          <label className="radio">
            <input type="checkbox" checked={q.onPremAD} onChange={(e) => setQ({ ...q, onPremAD: e.target.checked })} /> Tienen Active Directory local sincronizado
          </label>
          <label>
            Perfil de gobierno
            <select value={profile} onChange={(e) => setProfile(e.target.value as Profile | '')}>
              <option value="">Automático (lo decide el assessment)</option>
              <option value="esencial">Esencial</option>
              <option value="recomendado">Recomendado</option>
              <option value="estricto">Estricto</option>
            </select>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Analizando tenant…' : prev ? 'Volver a ejecutar assessment' : 'Ejecutar assessment'}
          </button>
        </form>

        <div className="results">
          {!rec ? (
            <div className="card empty">Completa el contexto y ejecuta el assessment para ver el diagnóstico y el plan recomendado.</div>
          ) : (
            <>
              <div className="card score-card">
                <div className="score-ring" style={{ ['--p' as string]: rec.scores.overall }}>
                  <span>{rec.scores.overall}%</span>
                  <small>madurez</small>
                </div>
                <div className="pillar-bars">
                  {PILLARS.map((p) => {
                    const v = rec.scores.pillars[p.id];
                    return (
                      <div key={p.id} className="pbar">
                        <span>{p.label}</span>
                        <div className="bar">
                          <i style={{ width: `${v ?? 0}%`, background: p.color }} />
                        </div>
                        <b>{v === null ? 'n/e' : `${v}%`}</b>
                      </div>
                    );
                  })}
                  <p className="muted small">Evaluado el {new Date(prev!.at).toLocaleString('es-CL')} · n/e = no evaluable con los permisos actuales</p>
                </div>
              </div>

              <div className="card profile-card">
                <h2>
                  Perfil recomendado: <span className={`profile p-${rec.profile}`}>{rec.profile}</span>
                </h2>
                <p>{PROFILE_TEXT[rec.profile]}</p>
                <details>
                  <summary>¿Por qué este perfil?</summary>
                  <ul className="bullets small">
                    {rec.profileReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              </div>

              {scan && (
                <div className="stats">
                  <Stat label="Licencias Business Premium" value={scan.license ? `${scan.license.assigned}/${scan.license.purchased}` : 'n/e'} />
                  <Stat label="Usuarios / invitados" value={scan.users ? `${scan.users.members} / ${scan.users.guests}` : 'n/e'} />
                  <Stat label="Administradores globales" value={scan.globalAdmins ?? 'n/e'} warn={scan.globalAdmins > 4} />
                  <Stat label="Usuarios con MFA" value={scan.mfa ? `${scan.mfa.pct}%` : 'n/e'} warn={scan.mfa?.pct < 90} />
                  <Stat label="Security defaults" value={scan.securityDefaults === undefined ? 'n/e' : scan.securityDefaults ? 'Activos' : 'Inactivos'} />
                  <Stat label="Políticas de Acceso Condicional" value={scan.ca ? `${scan.ca.enabled} activas / ${scan.ca.total}` : 'n/e'} />
                  <Stat label="Dispositivos administrados" value={scan.devices ? scan.devices.total : 'n/e'} />
                  <Stat label="Dispositivos cifrados" value={scan.devices?.total ? `${Math.round((scan.devices.encrypted / scan.devices.total) * 100)}%` : 'n/e'} />
                  <Stat label="Secure Score" value={scan.secureScore ? `${scan.secureScore.pct}%` : 'n/e'} warn={scan.secureScore?.pct < 60} />
                </div>
              )}
              {scan?.errors?.length > 0 && (
                <div className="card warn-card small">
                  <b>Áreas no evaluadas:</b> {scan.errors.map((e: any) => `${e.area} (${e.message})`).join(' · ')}
                </div>
              )}

              <div className="card">
                <h2>Hallazgos ({rec.findings.length})</h2>
                <div className="findings">
                  {rec.findings.map((f) => (
                    <div key={f.id} className={`finding sev-${f.severity}`}>
                      <div className="finding-head">
                        <span className="sev">{SEV_LABEL[f.severity]}</span>
                        <b>{f.title}</b>
                        <span className="muted small">{PILLARS.find((p) => p.id === f.pillar)?.label}</span>
                      </div>
                      <p className="small">{f.detail}</p>
                      {f.playbooks.length > 0 && (
                        <div className="finding-links">
                          {f.playbooks.map((id) => {
                            const pb = app.playbook(id);
                            return pb ? (
                              <button key={id} className="link small" onClick={() => app.openTile(pb.tiles[0])}>
                                {pb.title} →
                              </button>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h2>Hoja de ruta de gobierno</h2>
                <div className="roadmap">
                  {rec.roadmap.map((ph) => (
                    <div key={ph.phase} className="phase">
                      <div className="phase-head">
                        <span className="phase-num">{ph.phase}</span>
                        <div>
                          <b>{ph.name}</b>
                          <p className="muted small">{ph.description}</p>
                        </div>
                      </div>
                      <ul>
                        {ph.playbooks.map((id) => {
                          const item = rec.items.find((i) => i.playbookId === id)!;
                          const pb = app.playbook(id)!;
                          const done = app.state.deployments[id]?.status === 'ok' || app.state.manualDone[id];
                          return (
                            <li key={id}>
                              <span className={`prio ${item.priority}`}>{item.priority}</span>
                              <button className="link" onClick={() => app.openTile(pb.tiles[0])}>
                                {pb.title}
                              </button>
                              {done && <span className="ok-mark">✓</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="load-plan">
                  <label>
                    Cargar al plan hasta la fase
                    <select value={upToPhase} onChange={(e) => setUpToPhase(Number(e.target.value))}>
                      {rec.roadmap.map((ph) => (
                        <option key={ph.phase} value={ph.phase}>
                          {ph.phase} · {ph.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" onClick={loadPlan}>
                    Cargar plan recomendado
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`stat${warn ? ' warn' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
