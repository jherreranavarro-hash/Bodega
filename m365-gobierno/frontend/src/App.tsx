import { useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { AppProvider, useApp } from './store';
import { MapPage } from './pages/MapPage';
import { AssessmentPage } from './pages/AssessmentPage';
import { PlanPage } from './pages/PlanPage';
import { HistoryPage } from './pages/HistoryPage';
import { ConnectionPage } from './pages/ConnectionPage';
import { TileModal } from './components/TileModal';
import { JobMonitor } from './components/JobMonitor';
import { EnvSwitcher } from './components/EnvSwitcher';

const PAGES = [
  ['map', 'Mapa'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan de despliegue'],
  ['history', 'Historial'],
  ['connection', 'Conexión'],
] as const;
type Page = (typeof PAGES)[number][0];

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="login">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<{ token: string }>('/login', { body: { password } });
            setToken(r.token);
            onLogin();
          } catch (err: any) {
            setError(err.message);
          }
        }}
      >
        <div className="brand-mark" aria-hidden>
          <i /><i /><i /><i />
        </div>
        <h1>Gobierno M365</h1>
        <p className="muted">Activa Entra ID, Intune, Defender y Purview de Business Premium desde un solo lugar.</p>
        <label>
          Contraseña de la aplicación
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary" type="submit">
          Ingresar
        </button>
      </form>
    </div>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { state } = useApp();
  const initial = (window.location.hash.slice(1).split('?')[0] as Page) || 'map';
  const [page, setPage] = useState<Page>(PAGES.some(([p]) => p === initial) ? initial : 'map');
  const goto = (p: string) => {
    setPage(p as Page);
    window.location.hash = p;
    window.scrollTo(0, 0);
  };
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark small" aria-hidden>
            <i /><i /><i /><i />
          </div>
          <span>Gobierno M365</span>
        </div>
        <nav>
          {PAGES.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => goto(id)} aria-current={page === id ? 'page' : undefined}>
              {label}
              {id === 'plan' && state.plan.length > 0 && <span className="count">{state.plan.length}</span>}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <EnvSwitcher goto={goto} />
          <button className="link" onClick={onLogout}>
            Salir
          </button>
        </div>
      </header>
      <main>
        {page === 'map' && <MapPage goto={goto} />}
        {page === 'assessment' && <AssessmentPage goto={goto} />}
        {page === 'plan' && <PlanPage goto={goto} />}
        {page === 'history' && <HistoryPage />}
        {page === 'connection' && <ConnectionPage />}
      </main>
      <TileModal />
      <JobMonitor />
    </>
  );
}

export function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  useEffect(() => setUnauthorizedHandler(() => setAuthed(false)), []);
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return (
    <AppProvider>
      <Shell
        onLogout={() => {
          setToken(null);
          setAuthed(false);
        }}
      />
    </AppProvider>
  );
}
