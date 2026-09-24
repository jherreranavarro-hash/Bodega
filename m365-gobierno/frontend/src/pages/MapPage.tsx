import { useMemo, useState } from 'react';
import { tilesOf, useApp, type TileStatus } from '../store';
import { PILLARS, type Pillar, type Tile } from '../types';

const STATUS_BADGE: Record<TileStatus, { icon: string; label: string } | null> = {
  desplegado: { icon: '✓', label: 'Desplegado' },
  parcial: { icon: '◐', label: 'Parcialmente desplegado' },
  error: { icon: '!', label: 'Último despliegue con error' },
  'pendiente-manual': { icon: '⧗', label: 'Pendiente de pasos manuales' },
  'sin-configurar': { icon: '⚙', label: 'Configurable, aún sin aplicar' },
  informativo: null,
};

function TileButton({ tile, dim }: { tile: Tile; dim: boolean }) {
  const { tileStatus, openTile, playbooksForTile, state, inPlan } = useApp();
  const status = tileStatus(tile.id);
  const badge = STATUS_BADGE[status];
  const pbs = playbooksForTile(tile.id);
  const rec = state.assessment?.recommendation.items.filter((i) => pbs.some((p) => p.id === i.playbookId)) ?? [];
  const p1 = rec.some((r) => r.priority === 'P1');
  const planned = pbs.some((p) => inPlan(p.id));
  return (
    <button
      type="button"
      className={`tile g-${tile.group} st-${status}${dim ? ' dim' : ''}`}
      onClick={() => openTile(tile.id)}
      title={`${tile.name} — ${tile.description}`}
      aria-label={`${tile.name}. ${badge?.label ?? 'Incluido en la licencia'}${rec.length ? '. Recomendado' : ''}`}
    >
      <span className="tile-name">{tile.name}</span>
      {badge && <span className={`tile-badge b-${status}`}>{badge.icon}</span>}
      {rec.length > 0 && status !== 'desplegado' && <span className={`tile-star${p1 ? ' p1' : ''}`}>★</span>}
      {planned && <span className="tile-plan" title="En el plan de despliegue" />}
    </button>
  );
}

function Grid({ tiles, cols, filter, onlyRec, recTiles }: { tiles: Tile[]; cols: number; filter: Pillar | null; onlyRec: boolean; recTiles: Set<string> }) {
  return (
    <div className="tile-grid" style={{ ['--cols' as string]: cols }}>
      {tiles.map((t) => (
        <TileButton key={t.id} tile={t} dim={(filter !== null && t.pillar !== filter) || (onlyRec && !recTiles.has(t.id))} />
      ))}
    </div>
  );
}

export function MapPage({ goto }: { goto: (page: string) => void }) {
  const app = useApp();
  const { catalog, state } = app;
  const [filter, setFilter] = useState<Pillar | null>(null);
  const [onlyRec, setOnlyRec] = useState(false);

  const recTiles = useMemo(() => {
    const ids = new Set(state.assessment?.recommendation.items.map((i) => i.playbookId) ?? []);
    return new Set(catalog.tiles.filter((t) => app.playbooksForTile(t.id).some((p) => ids.has(p.id))).map((t) => t.id));
  }, [catalog, state.assessment, app]);

  const counts = useMemo(() => {
    const configurable = catalog.tiles.filter((t) => app.playbooksForTile(t.id).length);
    return {
      configurable: configurable.length,
      done: configurable.filter((t) => app.tileStatus(t.id) === 'desplegado').length,
      plan: state.plan.length,
    };
  }, [catalog, app, state.plan]);

  const g = (group: string) => tilesOf(catalog, group);
  const props = { filter, onlyRec, recTiles };

  return (
    <div className="map-page">
      <div className="map-heading">
        <h1>Microsoft 365 Business Premium</h1>
        <p>Cada caja es una capacidad de tu licencia. Ábrela para entender qué hace y aplicarla en tu tenant.</p>
      </div>

      <div className="map-summary">
        <div className="kpi">
          <b>{counts.done}</b>
          <span>de {counts.configurable} capacidades configurables desplegadas</span>
        </div>
        <div className="kpi">
          <b>{counts.plan}</b>
          <span>playbooks en el plan</span>
        </div>
        {!state.assessment ? (
          <button className="btn primary" onClick={() => goto('assessment')}>
            Ejecutar Assessment para recibir recomendaciones
          </button>
        ) : (
          <div className="kpi">
            <b>{state.assessment.recommendation.scores.overall}%</b>
            <span>
              madurez · perfil <em>{state.assessment.recommendation.profile}</em>
            </span>
          </div>
        )}
      </div>

      <div className="map-toolbar" role="toolbar" aria-label="Filtrar por pilar">
        <button className={`chip${filter === null ? ' on' : ''}`} onClick={() => setFilter(null)}>
          Todos
        </button>
        {PILLARS.map((p) => (
          <button
            key={p.id}
            className={`chip${filter === p.id ? ' on' : ''}`}
            style={{ ['--chip' as string]: p.color }}
            onClick={() => setFilter(filter === p.id ? null : p.id)}
          >
            {p.label}
          </button>
        ))}
        {state.assessment && (
          <label className="chip-toggle">
            <input type="checkbox" checked={onlyRec} onChange={(e) => setOnlyRec(e.target.checked)} /> Solo recomendados
          </label>
        )}
        <div className="legend">
          <span><i className="lg b-desplegado">✓</i>desplegado</span>
          <span><i className="lg b-parcial">◐</i>parcial</span>
          <span><i className="lg b-sin-configurar">⚙</i>configurable</span>
          <span><i className="lg b-pendiente-manual">⧗</i>pasos manuales</span>
          <span><i className="lg star">★</i>recomendado</span>
        </div>
      </div>

      <div className="map-scroll">
        <div className="map">
          <div className="hdr-row">
            <div className="hdr h-o365">Office 365</div>
            <div className="hdr h-ems">Enterprise Mobility + Security</div>
            <div className="hdr h-win">Windows Pro</div>
            <div />
          </div>
          <div className="map-frame">
            <div className="side">Microsoft 365 Business Premium</div>
            <div className="map-body">
              <section className="col c-o365">
                <Grid tiles={g('office365')} cols={5} {...props} />
                <div className="sub s-defender-o365">
                  <Grid tiles={g('defender-o365')} cols={5} {...props} />
                  <div className="sub-label">Defender for Office 365 Plan 1</div>
                </div>
              </section>
              <section className="col c-ems">
                <div className="sub s-entra">
                  <Grid tiles={g('entra-p1')} cols={5} {...props} />
                  <div className="sub-label">Entra ID Plan 1</div>
                </div>
                <div className="ems-row">
                  <div className="sub s-intune">
                    <Grid tiles={g('intune-p1')} cols={3} {...props} />
                    <div className="sub-label">Intune Plan 1 for Business</div>
                  </div>
                  <Grid tiles={g('ems')} cols={1} {...props} />
                </div>
              </section>
              <section className="col c-win">
                <Grid tiles={g('windows')} cols={3} {...props} />
                <p className="win-note">
                  Microsoft 365 Business Premium incluye la actualización a Windows Pro, Universal Print, Windows Autopatch y derechos de
                  virtualización de Windows.
                </p>
              </section>
              <section className="col c-dfb">
                <div className="sub s-dfb">
                  <Grid tiles={g('defender-business')} cols={2} {...props} />
                  <div className="sub-label">Defender for Business</div>
                </div>
                <div className="fasttrack">
                  <Grid tiles={g('fasttrack')} cols={1} {...props} />
                </div>
              </section>
            </div>
            <div className="side">Microsoft 365 Business Premium</div>
          </div>
          <div className="hdr-row">
            <div className="hdr h-o365">Office 365</div>
            <div className="hdr h-ems">Enterprise Mobility + Security</div>
            <div className="hdr h-win">Windows Pro</div>
            <div />
          </div>
        </div>
      </div>
      <p className="map-credit">
        Estructura basada en el mapa de licencias de <a href="https://m365maps.com/files/Microsoft-365-Business-Premium.htm" target="_blank" rel="noreferrer">m365maps.com</a>.
      </p>
    </div>
  );
}
