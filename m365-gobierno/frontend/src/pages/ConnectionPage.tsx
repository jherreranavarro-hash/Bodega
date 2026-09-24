import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';

interface Perms {
  required: string[];
  granted: string[] | null;
  missing: string[] | null;
  error?: string;
}

export function ConnectionPage() {
  const { status, refresh } = useApp();
  const [perms, setPerms] = useState<Perms | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    api<Perms>('/permissions').then(setPerms).catch(() => setPerms(null));
  }, []);

  if (!status) return <div className="page">Cargando…</div>;
  const real = status.mode === 'real';

  const reset = async () => {
    if (!confirm('¿Restablecer el tenant simulado y borrar el historial de despliegues simulados?')) return;
    setResetting(true);
    await api('/simulation/reset', { body: {} });
    await refresh();
    setResetting(false);
  };

  return (
    <div className="page">
      <h1>Conexión con el tenant</h1>
      <div className="stats">
        <div className={`stat ${real ? 'ok' : 'warn'}`}>
          <b>{real ? 'Tenant real' : 'Simulación'}</b>
          <span>Modo de operación</span>
        </div>
        <div className="stat">
          <b>{status.tenant?.defaultDomain ?? '—'}</b>
          <span>Dominio predeterminado</span>
        </div>
        <div className="stat">
          <b>{status.tenant?.initialDomain ?? '—'}</b>
          <span>Dominio inicial</span>
        </div>
        <div className={`stat ${status.graphConfigured ? 'ok' : 'warn'}`}>
          <b>{status.graphConfigured ? 'Configurado' : 'Falta'}</b>
          <span>Microsoft Graph (TENANT_ID, CLIENT_ID, secreto o certificado)</span>
        </div>
        <div className={`stat ${status.powershellConfigured && status.pwshAvailable ? 'ok' : 'warn'}`}>
          <b>{status.powershellConfigured ? (status.pwshAvailable ? 'Listo' : 'Falta pwsh') : 'Falta certificado'}</b>
          <span>Exchange Online / Purview PowerShell</span>
        </div>
      </div>
      {status.tenantError && <div className="card warn-card">No se pudo leer el tenant: {status.tenantError}</div>}

      {!real && (
        <div className="card">
          <h2>Estás en modo simulación</h2>
          <p>
            Todo funciona contra un tenant de demostración en memoria (una pyme chilena con Business Premium). Sirve para aprender, capacitar y
            validar el plan antes de tocar producción.
          </p>
          <button className="btn" onClick={reset} disabled={resetting}>
            Restablecer tenant simulado
          </button>
        </div>
      )}

      <div className="card">
        <h2>Cómo conectar tu tenant</h2>
        <ol className="setup">
          <li>
            Entra ID → Registros de aplicaciones → <b>Nuevo registro</b> ("Gobierno M365", un solo inquilino).
          </li>
          <li>
            Permisos de API → Microsoft Graph → <b>Permisos de aplicación</b>: agrega la lista de abajo y pulsa <b>Conceder consentimiento de administrador</b>.
          </li>
          <li>
            Para Exchange Online y Purview: Permisos de API → Office 365 Exchange Online → <code>Exchange.ManageAsApp</code>, y asigna a la app los
            roles <b>Administrador de Exchange</b> y <b>Administrador de cumplimiento</b> (Entra ID → Roles).
          </li>
          <li>
            Certificados y secretos: sube un certificado (recomendado) o crea un secreto. Exchange/Purview solo aceptan certificado (.pfx).
          </li>
          <li>
            Completa <code>backend/.env</code> (ver <code>.env.example</code>) y reinicia la aplicación. El modo cambia a <b>Tenant real</b>.
          </li>
        </ol>
      </div>

      <div className="card">
        <h2>Permisos de Microsoft Graph</h2>
        {perms?.error && <p className="error-text small">{perms.error}</p>}
        {!perms?.granted && <p className="muted small">En simulación no se validan permisos. Estos son los que necesita la app:</p>}
        <div className="perm-grid">
          {perms?.required.map((p) => {
            const ok = perms.granted ? !perms.missing?.includes(p) : null;
            return (
              <div key={p} className={`perm ${ok === null ? '' : ok ? 'ok' : 'missing'}`}>
                {ok === null ? '•' : ok ? '✓' : '✖'} <code>{p}</code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
