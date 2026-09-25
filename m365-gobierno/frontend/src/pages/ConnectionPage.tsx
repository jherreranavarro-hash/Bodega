import { useEffect, useState } from 'react';
import { api, signInWithMicrosoft } from '../api';
import { useApp } from '../store';
import { TIER_LABEL, type Environment } from '../types';

interface Perms {
  kind: Environment['kind'];
  required: string[];
  granted: string[] | null;
  missing: string[] | null;
  error?: string;
}

interface EnvForm {
  name: string;
  tier: 'dev' | 'poc' | 'prd';
  tenantId: string;
  clientId: string;
  adminUpn: string;
  orgDomain: string;
}

const EMPTY: EnvForm = { name: '', tier: 'dev', tenantId: '', clientId: '', adminUpn: '', orgDomain: '' };

function hashQuery(): URLSearchParams {
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q);
}

function EnvironmentForm({ initial, onSaved, onCancel, editingId }: { initial: EnvForm; onSaved: () => void; onCancel: () => void; editingId?: string }) {
  const [f, setF] = useState<EnvForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof EnvForm, v: string) => setF({ ...f, [k]: v });
  const submit = async () => {
    setError(null);
    try {
      await api(editingId ? `/environments/${editingId}` : '/environments', { method: editingId ? 'PUT' : 'POST', body: f });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <form
      className="card env-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{editingId ? `Editar ${initial.name}` : 'Agregar ambiente'}</h3>
      <div className="env-grid">
        <label>
          Nombre
          <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="PRD" required />
        </label>
        <label>
          Tipo
          <select value={f.tier} onChange={(e) => set('tier', e.target.value)}>
            <option value="dev">DEV · desarrollo</option>
            <option value="poc">POC · prueba de concepto / QA</option>
            <option value="prd">PRD · producción</option>
          </select>
        </label>
        <label>
          Tenant ID (Id. de directorio)
          <input value={f.tenantId} onChange={(e) => set('tenantId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required />
        </label>
        <label>
          Client ID (Id. de aplicación del registro)
          <input value={f.clientId} onChange={(e) => set('clientId', e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required />
        </label>
        <label>
          Cuenta de administrador
          <input type="email" value={f.adminUpn} onChange={(e) => set('adminUpn', e.target.value)} placeholder="admin@empresa.cl" />
        </label>
        <label>
          Dominio inicial (opcional)
          <input value={f.orgDomain} onChange={(e) => set('orgDomain', e.target.value)} placeholder="empresa.onmicrosoft.com" />
        </label>
      </div>
      <p className="muted small">
        🔒 La contraseña <b>no se escribe aquí</b>. Al iniciar sesión se abre la página oficial de Microsoft: allí ingresas la contraseña y apruebas
        el MFA. Esta aplicación solo recibe un token temporal y rechaza sesiones sin MFA. Si indicas la cuenta, solo esa podrá conectarse.
      </p>
      {error && <p className="error-text small">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primary">
          Guardar
        </button>
      </div>
    </form>
  );
}

export function ConnectionPage() {
  const { status, state, refresh } = useApp();
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [redirectUri, setRedirectUri] = useState('');
  const [perms, setPerms] = useState<Perms | null>(null);
  const [editing, setEditing] = useState<Environment | 'new' | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const r = await api<{ environments: Environment[]; redirectUri: string }>('/environments');
    setEnvs(r.environments);
    setRedirectUri(r.redirectUri);
    api<Perms>('/permissions').then(setPerms).catch(() => setPerms(null));
  };

  useEffect(() => {
    const q = hashQuery();
    if (q.get('login') === 'ok') setBanner({ ok: true, text: `Sesión iniciada como ${q.get('account')} y validada con MFA.` });
    if (q.get('login') === 'error') setBanner({ ok: false, text: q.get('msg') ?? 'No se pudo iniciar sesión' });
    if (q.get('login')) history.replaceState(null, '', '#connection');
    void load();
  }, [state.environment.id, state.environment.connected]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = () =>
    run(async () => {
      if (!confirm('¿Restablecer el tenant simulado y borrar sus despliegues?')) return;
      await api('/simulation/reset', { body: {} });
    });

  return (
    <div className="page">
      <h1>Ambientes y conexión</h1>
      <p className="muted">
        Registra tus tenants DEV, POC y PRD. Para operar un ambiente, el administrador inicia sesión con Microsoft (contraseña + MFA). Buena práctica:
        desplegar primero en DEV/POC y, cuando esté validado, promover a PRD.
      </p>
      {banner && <div className={`card ${banner.ok ? 'ok-card' : 'warn-card'}`}>{banner.text}</div>}
      {error && <div className="card warn-card">{error}</div>}

      <div className="env-list">
        {envs.map((e) => {
          const active = e.id === state.environment.id;
          return (
            <div key={e.id} className={`card env-card${active ? ' active' : ''}`}>
              <div className="env-head">
                <span className={`tier t-${e.tier}`}>{TIER_LABEL[e.tier]}</span>
                <b>{e.name}</b>
                {active && <span className="pill neutral">activo</span>}
              </div>
              {e.kind === 'simulacion' && <p className="small muted">Tenant de demostración en memoria para aprender y validar planes sin riesgo.</p>}
              {e.kind === 'aplicacion' && <p className="small muted">Registro con certificado/secreto de backend/.env (sin intervención humana).</p>}
              {e.kind === 'delegado' && (
                <dl className="env-dl small">
                  <dt>Tenant</dt>
                  <dd><code>{e.tenantId}</code></dd>
                  <dt>App</dt>
                  <dd><code>{e.clientId}</code></dd>
                  <dt>Administrador</dt>
                  <dd>{e.adminUpn ?? 'cualquier administrador del tenant'}</dd>
                  <dt>Sesión</dt>
                  <dd>
                    {e.session ? (
                      <>
                        <span className="ok-mark">●</span> {e.session.account} · MFA ✓{' '}
                        {e.session.globalAdmin ? '· Administrador global' : <span className="warn-text">· sin rol Administrador global</span>}
                        <div className="muted">Expira por inactividad: {new Date(e.session.expiresAt).toLocaleString('es-CL')}</div>
                      </>
                    ) : (
                      <span className="muted">sin sesión</span>
                    )}
                  </dd>
                </dl>
              )}
              <div className="env-actions">
                {!active && (
                  <button className="btn" onClick={() => run(() => api(`/environments/${e.id}/activate`, { body: {} }))}>
                    Usar este ambiente
                  </button>
                )}
                {e.kind === 'delegado' &&
                  (e.session ? (
                    <button className="btn ghost" onClick={() => run(() => api(`/auth/logout/${e.id}`, { body: {} }))}>
                      Cerrar sesión
                    </button>
                  ) : (
                    <button className="btn primary" onClick={() => run(() => signInWithMicrosoft(e.id))}>
                      Iniciar sesión con Microsoft (MFA)
                    </button>
                  ))}
                {e.kind === 'delegado' && (
                  <>
                    <button className="link small" onClick={() => setEditing(e)}>
                      Editar
                    </button>
                    <button
                      className="link small"
                      onClick={() => run(async () => confirm(`¿Eliminar el ambiente ${e.name}? El historial se conserva.`) && api(`/environments/${e.id}`, { method: 'DELETE' }))}
                    >
                      Eliminar
                    </button>
                  </>
                )}
                {e.kind === 'simulacion' && (
                  <button className="link small" onClick={reset}>
                    Restablecer
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {editing === null && (
          <button className="card env-add" onClick={() => setEditing('new')}>
            + Agregar ambiente (DEV / POC / PRD)
          </button>
        )}
      </div>

      {editing && (
        <EnvironmentForm
          key={editing === 'new' ? 'new' : editing.id}
          editingId={editing === 'new' ? undefined : editing.id}
          initial={
            editing === 'new'
              ? { ...EMPTY, name: ['DEV', 'POC', 'PRD'].find((n) => !envs.some((e) => e.name === n)) ?? '', tier: (['dev', 'poc', 'prd'] as const).find((t) => !envs.some((e) => e.tier === t)) ?? 'dev' }
              : {
                  name: editing.name,
                  tier: editing.tier as EnvForm['tier'],
                  tenantId: editing.tenantId ?? '',
                  clientId: editing.clientId ?? '',
                  adminUpn: editing.adminUpn ?? '',
                  orgDomain: editing.orgDomain ?? '',
                }
          }
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {status?.tenantError && <div className="card warn-card">No se pudo leer el tenant activo: {status.tenantError}</div>}

      <div className="card">
        <h2>Registro de aplicación (una vez por tenant: DEV, POC y PRD)</h2>
        <ol className="setup">
          <li>
            Entra ID → Registros de aplicaciones → <b>Nuevo registro</b>: "Gobierno M365", cuentas de este directorio únicamente.
          </li>
          <li>
            Autenticación → Agregar plataforma → <b>Aplicaciones móviles y de escritorio</b> → URI de redirección:
            <pre className="code">{redirectUri}</pre>
            (No uses la plataforma "Web" ni "SPA": la app no usa secreto y canjea el código con PKCE.)
          </li>
          <li>
            Permisos de API → Microsoft Graph → <b>Permisos delegados</b>: los de la lista de abajo + <code>offline_access</code>, y
            Office 365 Exchange Online → delegado <code>Exchange.Manage</code>. Luego <b>Conceder consentimiento de administrador</b>.
          </li>
          <li>Copia el Id. de directorio (tenant) y el Id. de aplicación (cliente) y agrégalos arriba como ambiente.</li>
          <li>
            Inicia sesión: la cuenta necesita un rol con privilegios suficientes (Administrador global, o Seguridad + Intune + Exchange + Cumplimiento) y
            MFA registrado.
          </li>
        </ol>
      </div>

      <div className="card">
        <h2>Permisos de Microsoft Graph {perms?.granted ? `en ${state.environment.name}` : ''}</h2>
        {perms?.error && <p className="warn-text small">{perms.error}</p>}
        {!perms?.granted && <p className="muted small">Inicia sesión en un ambiente para verificar los permisos concedidos. Se requieren:</p>}
        <div className="perm-grid">
          {perms?.required.map((p) => {
            const ok = perms.granted ? !perms.missing?.includes(p) : null;
            return (
              <div key={p} className={`perm ${ok === null ? '' : ok ? 'ok' : 'missing'}`}>
                {ok === null ? '•' : ok ? '✓' : '✖'} <code>{p}</code>
              </div>
            );
          })}
          {[
            'AuditLog.Read.All',
            'UserAuthenticationMethod.Read.All',
            'RoleManagement.Read.Directory',
            'DeviceManagementManagedDevices.Read.All',
            'SecurityEvents.Read.All',
            'Reports.Read.All',
            'InformationProtectionPolicy.Read',
            'RecordsManagement.Read.All',
          ].map((p) => (
            <div key={p} className="perm muted">
              • <code>{p}</code> (Assessment)
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
