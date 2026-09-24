import { useEffect, useState } from 'react';
import { api, signInWithMicrosoft } from '../api';
import { useApp } from '../store';
import { TIER_LABEL, type Environment } from '../types';

export function EnvSwitcher({ goto }: { goto: (p: string) => void }) {
  const { state, refresh, activeJob } = useApp();
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = state.environment;

  useEffect(() => {
    api<{ environments: Environment[] }>('/environments')
      .then((r) => setEnvs(r.environments))
      .catch(() => setEnvs([]));
  }, [current.id, current.connected]);

  const change = async (id: string) => {
    setError(null);
    try {
      await api(`/environments/${id}/activate`, { body: {} });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="env-switcher">
      <span className={`tier t-${current.tier}`}>{TIER_LABEL[current.tier]}</span>
      <select aria-label="Ambiente activo" value={current.id} onChange={(e) => change(e.target.value)} disabled={activeJob !== null} title={error ?? undefined}>
        {envs.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.kind === 'delegado' ? (e.connected ? ` · ${e.session?.account}` : ' · sin sesión') : ''}
          </option>
        ))}
      </select>
      {current.kind === 'delegado' && !current.connected && (
        <button className="btn primary small-btn" onClick={() => signInWithMicrosoft(current.id).catch((e) => setError(e.message))}>
          Iniciar sesión (MFA)
        </button>
      )}
      {current.kind === 'delegado' && current.connected && <span className="conn-dot" title={`Conectado como ${current.session?.account} (MFA)`} />}
      <button className="link small" onClick={() => goto('connection')}>
        Ambientes
      </button>
    </div>
  );
}
