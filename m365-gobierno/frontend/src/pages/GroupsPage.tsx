import { useEffect, useMemo, useRef, useState } from 'react';
import { api, openDocument, signInWithMicrosoft } from '../api';
import { useApp } from '../store';
import { ConfirmDeploy } from '../components/ConfirmDeploy';
import {
  GROUP_KIND_LABEL,
  type EntryStatus,
  type GroupKind,
  type GroupMember,
  type GroupView,
  type MembershipMode,
  type MembershipPreview,
  type MembershipResult,
} from '../types';

const STATUS_LABEL: Record<EntryStatus, string> = {
  agregar: 'Se agregará',
  'ya-miembro': 'Ya es miembro',
  quitar: 'Se quitará',
  'no-miembro': 'No es miembro',
  'no-encontrado': 'No encontrada',
  duplicado: 'Repetida',
};
const STATUS_CLASS: Record<EntryStatus, string> = {
  agregar: 's-ok',
  quitar: 's-manual',
  'ya-miembro': 'neutral',
  'no-miembro': 'neutral',
  'no-encontrado': 's-error',
  duplicado: 'neutral',
};

type Filter = 'todos' | 'editables' | GroupKind | 'solo-lectura';
const FILTERS: { id: Filter; label: string; test: (g: GroupView) => boolean }[] = [
  { id: 'todos', label: 'Todos', test: () => true },
  { id: 'editables', label: 'Admiten carga masiva', test: (g) => g.editable },
  { id: 'asignado', label: 'Seguridad', test: (g) => g.kind === 'asignado' },
  { id: 'microsoft365', label: 'Microsoft 365', test: (g) => g.kind === 'microsoft365' },
  { id: 'dinamico', label: 'Dinámicos', test: (g) => g.kind === 'dinamico' },
  { id: 'solo-lectura', label: 'Solo lectura', test: (g) => !g.editable },
];

const ACCOUNT = /[^\s,;"'<>|()[\]]+@[^\s,;"'<>|()[\]]+\.[^\s,;"'<>|()[\]]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const extractAccounts = (text: string) => text.match(ACCOUNT) ?? [];

function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = '﻿' + [head, ...rows].map((r) => r.map(q).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 40);

function memberType(m: GroupMember): string {
  if (m.type === 'user') return m.userType === 'Guest' ? 'Invitado' : 'Miembro';
  return { group: 'Grupo anidado', device: 'Dispositivo', servicePrincipal: 'Aplicación', orgContact: 'Contacto' }[m.type] ?? m.type;
}

export function GroupsPage() {
  const { state } = useApp();
  const env = state.environment;
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups((await api<{ groups: GroupView[] }>('/groups')).groups);
    } catch (e: any) {
      setError(e.message);
      setGroups(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedId(null);
    void load();
  }, [env.id, env.connected]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, (groups ?? []).filter(f.test).length])), [groups]);
  const visible = (groups ?? [])
    .filter(FILTERS.find((f) => f.id === filter)!.test)
    .filter((g) => !search || `${g.displayName} ${g.description ?? ''} ${g.mail ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const selected = groups?.find((g) => g.id === selectedId);
  const replace = (g: GroupView) => setGroups((list) => list?.map((x) => (x.id === g.id ? { ...x, ...g } : x)) ?? list);

  return (
    <div className="page">
      <h1>Grupos de seguridad</h1>
      <p className="muted">
        Consulta los grupos de seguridad de <b>{env.name}</b> y agrega o quita cuentas de forma masiva. Antes de aplicar ves qué pasará con cada
        cuenta; cada cambio queda en el Historial con un acta de evidencia (miembros antes y después).
      </p>

      {env.kind === 'delegado' && !env.connected && (
        <div className="card warn-card">
          No hay sesión de administrador en {env.name}.{' '}
          <button className="btn primary" onClick={() => signInWithMicrosoft(env.id)}>
            Iniciar sesión con Microsoft (contraseña + MFA)
          </button>
        </div>
      )}
      {error && !(env.kind === 'delegado' && !env.connected) && (
        <div className="card warn-card">
          <b>No se pudieron leer los grupos:</b> {error}
        </div>
      )}

      <div className="groups-layout">
        <aside className="card group-list">
          <div className="select-bar">
            <input type="search" placeholder="Buscar grupo…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar grupo" />
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? 'Leyendo…' : 'Actualizar'}
            </button>
          </div>
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                {f.label} · {counts[f.id] ?? 0}
              </button>
            ))}
          </div>
          {loading && !groups && <p className="muted small">Leyendo grupos del tenant…</p>}
          {groups && visible.length === 0 && <p className="muted small">Ningún grupo coincide con la búsqueda.</p>}
          <ul>
            {visible.map((g) => (
              <li key={g.id}>
                <button className={g.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(g.id)} aria-current={g.id === selectedId}>
                  <span className="g-name">
                    <b>{g.displayName}</b>
                    <span className="muted small">
                      {GROUP_KIND_LABEL[g.kind]}
                      {g.synced ? ' · AD local' : ''}
                      {g.roleAssignable ? ' · roles de Entra' : ''}
                      {g.licenses.length ? ' · licencias' : ''}
                    </span>
                  </span>
                  <span className="g-count">
                    {g.members ?? '—'}
                    <small>miembros</small>
                  </span>
                  <span className="g-flag" title={g.blockedReason ?? g.warnings.join('\n')}>
                    {!g.editable ? '🔒' : g.warnings.length ? '⚠' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {groups && (
            <p className="muted small">
              {visible.length} de {groups.length} grupos con seguridad habilitada · 🔒 solo lectura · ⚠ con advertencias
            </p>
          )}
        </aside>

        <section>
          {selected ? (
            <GroupDetail key={selected.id} group={selected} onChanged={replace} />
          ) : (
            <div className="card empty">Selecciona un grupo para ver sus miembros y asignar cuentas.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function GroupDetail({ group, onChanged }: { group: GroupView; onChanged: (g: GroupView) => void }) {
  const app = useApp();
  const env = app.state.environment;
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [mode, setMode] = useState<MembershipMode>('agregar');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<MembershipPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ackRisk, setAckRisk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<MembershipResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMembers = async () => {
    setMemberError(null);
    try {
      const r = await api<{ group: GroupView; members: GroupMember[] }>(`/groups/${group.id}`);
      setMembers(r.members);
      onChanged(r.group);
    } catch (e: any) {
      setMemberError(e.message);
    }
  };
  useEffect(() => {
    void loadMembers();
  }, [group.id]);

  const edit = (next: string) => {
    setText(next);
    setPreview(null);
    setAckRisk(false);
  };
  const switchMode = (m: MembershipMode) => {
    setMode(m);
    setPreview(null);
    setAckRisk(false);
    setActionError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setActionError(null);
    if (file.size > 5_000_000) return setActionError('El archivo supera 5 MB');
    const found = extractAccounts(await file.text());
    if (!found.length) return setActionError(`"${file.name}" no contiene correos ni identificadores de usuario`);
    edit([text.trim(), ...found].filter(Boolean).join('\n'));
  };

  const runPreview = async () => {
    setBusy('preview');
    setActionError(null);
    setResult(null);
    try {
      setPreview(await api<MembershipPreview>(`/groups/${group.id}/members/preview`, { body: { accounts: text, mode } }));
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const apply = async (confirmText: string) => {
    setConfirming(false);
    setBusy('apply');
    setActionError(null);
    try {
      const r = await api<MembershipResult>(`/groups/${group.id}/members/apply`, { body: { accounts: text, mode, confirm: true, confirmText, ackRisk } });
      setResult(r);
      setPreview(null);
      setText('');
      setAckRisk(false);
      onChanged(r.group);
      await loadMembers();
      void app.refresh();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const prepareRevert = () => {
    if (!result) return;
    switchMode(result.mode === 'agregar' ? 'quitar' : 'agregar');
    setText(result.changes.filter((c) => c.status !== 'error').map((c) => c.upn).join('\n'));
    setResult(null);
  };

  const shownMembers = (members ?? []).filter(
    (m) => !memberSearch || `${m.displayName ?? ''} ${m.userPrincipalName ?? ''} ${m.mail ?? ''}`.toLowerCase().includes(memberSearch.toLowerCase()),
  );
  const pending = preview ? (mode === 'agregar' ? preview.counts.agregar : preview.counts.quitar) : 0;
  const riskNeeded = mode === 'agregar' && group.conditionalAccess.exclude.length > 0;
  const detected = useMemo(() => extractAccounts(text).length, [text]);
  const guests = preview?.entries.filter((e) => (e.status === 'agregar' || e.status === 'quitar') && e.notes.includes('Invitado externo')).length ?? 0;
  const disabled = preview?.entries.filter((e) => (e.status === 'agregar' || e.status === 'quitar') && e.notes.includes('Cuenta deshabilitada')).length ?? 0;
  const ca = group.conditionalAccess;
  const okChanges = result?.changes.filter((c) => c.status !== 'error') ?? [];
  const failed = result?.changes.filter((c) => c.status === 'error') ?? [];

  return (
    <>
      <div className="card group-head">
        <div className="group-title">
          <h2>{group.displayName}</h2>
          <span className="pill">{GROUP_KIND_LABEL[group.kind]}</span>
          {group.managedByApp && <span className="pill engine-graph">Gobierno M365</span>}
          {!group.editable && <span className="pill warn">Solo lectura</span>}
        </div>
        {group.description && <p>{group.description}</p>}
        <ul className="kv">
          <li>
            <span>Miembros directos</span>
            <b>{members?.length ?? group.members ?? '—'}</b>
          </li>
          <li>
            <span>Id. de objeto</span>
            <code className="small">{group.id}</code>
          </li>
          {group.mail && (
            <li>
              <span>Correo</span>
              <span>{group.mail}</span>
            </li>
          )}
          {group.membershipRule && (
            <li>
              <span>Regla dinámica</span>
              <code className="small">{group.membershipRule}</code>
            </li>
          )}
          {group.licenses.length > 0 && (
            <li>
              <span>Licencias que asigna</span>
              <span>{group.licenses.join(', ')}</span>
            </li>
          )}
          <li>
            <span>Acceso Condicional</span>
            <span className="small">
              {ca.include.length || ca.exclude.length
                ? [ca.include.length && `incluido en ${ca.include.join(', ')}`, ca.exclude.length && `excluido de ${ca.exclude.join(', ')}`].filter(Boolean).join(' · ')
                : 'No lo usa ninguna política'}
            </span>
          </li>
        </ul>
        {group.blockedReason && <p className="warn-text small">🔒 {group.blockedReason}</p>}
        {group.warnings.map((w) => (
          <p key={w} className="warn-text small">
            ⚠ {w}
          </p>
        ))}
      </div>

      {result && (
        <div className={`card${failed.length ? ' warn-card' : ' ok-card'}`} role="status">
          <h3>
            {failed.length ? '⚠ Cambio aplicado con errores' : '✓ Cambio aplicado'} en {env.name}
          </h3>
          <p>
            {okChanges.length} {okChanges.length === 1 ? 'cuenta' : 'cuentas'} {result.mode === 'agregar' ? 'agregada' : 'quitada'}
            {okChanges.length === 1 ? '' : 's'} · miembros{' '}
            {result.before} → {result.after}
            {failed.length ? ` · ${failed.length} con error` : ''}
            {okChanges.some((c) => !c.verified) ? ' · algunas aún no visibles (replicación de Entra ID)' : ''}
          </p>
          {failed.length > 0 && (
            <ul className="bullets small">
              {failed.slice(0, 20).map((c) => (
                <li key={c.userId}>
                  <b>{c.upn}</b>: {c.error}
                </li>
              ))}
            </ul>
          )}
          <div className="select-bar">
            <button className="btn" onClick={() => openDocument(`/docs/evidence/${result.jobId}`).catch((e) => setActionError(e.message))}>
              Acta de evidencia
            </button>
            <button
              className="btn"
              onClick={() =>
                downloadCsv(
                  `resultado-${slug(group.displayName)}.csv`,
                  ['Cuenta', 'Nombre', 'Resultado', 'Verificado', 'Error'],
                  result.changes.map((c) => [c.upn, c.displayName, c.status, c.verified ? 'Sí' : 'No', c.error]),
                )
              }
            >
              Descargar resultado (CSV)
            </button>
            {okChanges.length > 0 && (
              <button className="btn" onClick={prepareRevert}>
                Preparar reversión
              </button>
            )}
            <span className="muted small">SHA-256 {result.evidenceHash.slice(0, 16)}…</span>
          </div>
        </div>
      )}

      {group.editable && (
        <div className="card bulk">
          <h3>Asignación masiva</h3>
          <div className="tabs" role="group" aria-label="Operación">
            <button className={mode === 'agregar' ? 'on' : ''} onClick={() => switchMode('agregar')}>
              Agregar cuentas
            </button>
            <button className={mode === 'quitar' ? 'on' : ''} onClick={() => switchMode('quitar')}>
              Quitar cuentas
            </button>
          </div>
          <label className="bulk-input">
            Correos, UPN o identificadores de objeto: uno por línea, o separados por coma o punto y coma. También puedes cargar un CSV exportado de Entra
            ID o Excel: se toman los correos de cualquier columna.
            <textarea
              rows={7}
              value={text}
              onChange={(e) => edit(e.target.value)}
              placeholder={'ana.perez@empresa.cl\njuan.soto@empresa.cl'}
              spellCheck={false}
            />
          </label>
          <div className="select-bar">
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Cargar CSV o TXT
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              hidden
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <span className="muted small">
              {detected} {detected === 1 ? 'cuenta detectada' : 'cuentas detectadas'}
            </span>
            <button className="btn primary" disabled={!text.trim() || busy !== null} onClick={runPreview}>
              {busy === 'preview' ? 'Revisando en el directorio…' : 'Previsualizar'}
            </button>
          </div>
          {actionError && <p className="error-text small">{actionError}</p>}

          {preview && (
            <div className="bulk-preview">
              <div className="stats">
                <div className={`stat ${pending ? 'ok' : ''}`}>
                  <b>{pending}</b>
                  <span>{mode === 'agregar' ? 'Se agregarán' : 'Se quitarán'}</span>
                </div>
                <div className="stat">
                  <b>{mode === 'agregar' ? preview.counts['ya-miembro'] : preview.counts['no-miembro']}</b>
                  <span>{mode === 'agregar' ? 'Ya eran miembros' : 'No eran miembros'}</span>
                </div>
                <div className={`stat ${preview.counts['no-encontrado'] ? 'warn' : ''}`}>
                  <b>{preview.counts['no-encontrado']}</b>
                  <span>No encontradas</span>
                </div>
                <div className="stat">
                  <b>{preview.counts.duplicado}</b>
                  <span>Repetidas</span>
                </div>
                <div className="stat">
                  <b>
                    {preview.memberCount} → {preview.memberCount + (mode === 'agregar' ? pending : -pending)}
                  </b>
                  <span>Miembros del grupo</span>
                </div>
              </div>
              {(guests > 0 || disabled > 0) && (
                <p className="warn-text small">
                  {guests > 0 && `${guests} ${guests === 1 ? 'cuenta es de un invitado externo' : 'cuentas son de invitados externos'}. `}
                  {disabled > 0 && `${disabled} ${disabled === 1 ? 'cuenta está deshabilitada' : 'cuentas están deshabilitadas'}. `}Revisa que corresponda.
                </p>
              )}
              {preview.ignored.length > 0 && (
                <p className="muted small">
                  {preview.ignored.length === 1
                    ? 'Se ignoró 1 texto que no es correo ni identificador: '
                    : `Se ignoraron ${preview.ignored.length} textos que no son correo ni identificador: `}
                  {preview.ignored.slice(0, 8).join(', ')}
                  {preview.ignored.length > 8 ? '…' : ''}
                </p>
              )}
              <div className="table-scroll people-table">
                <table className="plan-table keep-cols">
                  <thead>
                    <tr>
                      <th>Ingresado</th>
                      <th>Cuenta en el directorio</th>
                      <th>Resultado</th>
                      <th>Observaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.slice(0, 500).map((e, i) => (
                      <tr key={`${e.input}-${i}`}>
                        <td className="small">{e.input}</td>
                        <td>
                          {e.user ? (
                            <>
                              {e.user.userPrincipalName}
                              {e.user.displayName && <div className="muted small">{e.user.displayName}</div>}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className={`pill ${STATUS_CLASS[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                        </td>
                        <td className="small">{e.notes.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.entries.length > 500 && <p className="small muted">Se muestran 500 de {preview.entries.length}; descarga el CSV para ver todas.</p>}
              </div>
              {riskNeeded && pending > 0 && (
                <label className="ack">
                  <input type="checkbox" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} />
                  <span>
                    Entiendo que estas {pending} cuentas quedarán <b>excluidas</b> de: {ca.exclude.join(', ')}.
                  </span>
                </label>
              )}
              <div className="select-bar">
                <button className="btn primary" disabled={pending === 0 || (riskNeeded && !ackRisk) || busy !== null} onClick={() => setConfirming(true)}>
                  {busy === 'apply'
                    ? 'Aplicando…'
                    : `${mode === 'agregar' ? 'Agregar' : 'Quitar'} ${pending} ${pending === 1 ? 'cuenta' : 'cuentas'} en ${env.name}`}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    downloadCsv(
                      `previsualizacion-${slug(group.displayName)}.csv`,
                      ['Ingresado', 'Cuenta', 'Nombre', 'Resultado', 'Observaciones'],
                      preview.entries.map((e) => [e.input, e.user?.userPrincipalName, e.user?.displayName, STATUS_LABEL[e.status], e.notes.join(' · ')]),
                    )
                  }
                >
                  Descargar previsualización (CSV)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="select-bar">
          <h3 className="grow">Miembros {members ? `(${members.length})` : ''}</h3>
          <input type="search" placeholder="Buscar miembro…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} aria-label="Buscar miembro" />
          <button
            className="btn"
            disabled={!members?.length}
            onClick={() =>
              downloadCsv(
                `miembros-${slug(group.displayName)}.csv`,
                ['Cuenta', 'Nombre', 'Tipo', 'Estado', 'Id. de objeto'],
                (members ?? []).map((m) => [m.userPrincipalName ?? m.mail, m.displayName, memberType(m), m.accountEnabled === false ? 'Deshabilitada' : 'Activa', m.id]),
              )
            }
          >
            Descargar CSV
          </button>
        </div>
        {memberError && <p className="error-text small">{memberError}</p>}
        {!members && !memberError && <p className="muted small">Leyendo miembros…</p>}
        {members && members.length === 0 && <p className="muted small">El grupo no tiene miembros.</p>}
        {members && members.length > 0 && (
          <div className="table-scroll people-table">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Cuenta</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {shownMembers.slice(0, 300).map((m) => (
                  <tr key={m.id}>
                    <td>{m.displayName ?? '—'}</td>
                    <td className="small">{m.userPrincipalName ?? m.mail ?? m.id}</td>
                    <td className="small">{memberType(m)}</td>
                    <td className="small">{m.type !== 'user' ? '—' : m.accountEnabled === false ? 'Deshabilitada' : 'Activa'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shownMembers.length > 300 && <p className="small muted">Se muestran 300 de {shownMembers.length}; usa la búsqueda o descarga el CSV.</p>}
          </div>
        )}
      </div>

      {confirming && preview && (
        <ConfirmDeploy
          verb="Aplicar cambio"
          summary={
            <p>
              Se {mode === 'agregar' ? 'agregarán' : 'quitarán'} <b>{pending}</b> {pending === 1 ? 'cuenta' : 'cuentas'} {mode === 'agregar' ? 'al' : 'del'} grupo{' '}
              <b>{group.displayName}</b>. La lista se vuelve a validar contra el directorio antes de aplicar y el resultado queda en el Historial con
              acta de evidencia.
            </p>
          }
          onConfirm={apply}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
