import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { HOSTS } from '../podcast/content';
import { audioScript, buildEpisodes, transcript, type Speaker } from '../podcast/episodes';
import { playLines, spanishVoices } from '../podcast/speech';

const KEY = 'gob-podcast-progreso';

function loadProgress(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveProgress(p: Record<string, number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: el progreso dura la sesión */
  }
}

function download(name: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PodcastPage() {
  const app = useApp();
  const episodes = useMemo(() => buildEpisodes(app.catalog), [app.catalog]);
  const [epIndex, setEpIndex] = useState(0);
  const [line, setLine] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceA, setVoiceA] = useState('');
  const [voiceB, setVoiceB] = useState('');
  const [progress, setProgress] = useState<Record<string, number>>(loadProgress);
  const stopRef = useRef<() => void>(() => {});
  const lineRef = useRef<HTMLLIElement>(null);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const ep = episodes[epIndex];
  const current = ep.lines[line];
  const tile = current?.tileId ? app.catalog.tiles.find((t) => t.id === current.tileId) : undefined;

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const v = spanishVoices();
      setVoices(v);
      setVoiceA((x) => x || v[0]?.name || '');
      setVoiceB((x) => x || v.find((y) => y.name !== v[0]?.name)?.name || v[0]?.name || '');
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load);
      stopRef.current();
    };
  }, [supported]);

  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [line, epIndex]);

  const stop = () => {
    stopRef.current();
    setPlaying(false);
  };

  const play = (from = line, idx = epIndex) => {
    const e = episodes[idx];
    const pick = (n: string) => voices.find((v) => v.name === n);
    stopRef.current();
    setPlaying(true);
    stopRef.current = playLines(e.lines, from, {
      voices: { A: pick(voiceA), B: pick(voiceB) } as Record<Speaker, SpeechSynthesisVoice | undefined>,
      rate,
      onLine: (i) => {
        setLine(i);
        setProgress((p) => {
          const next = { ...p, [e.id]: Math.max(p[e.id] ?? 0, Math.round(((i + 1) / e.lines.length) * 100)) };
          saveProgress(next);
          return next;
        });
      },
      onEnd: () => {
        setPlaying(false);
        if (idx + 1 < episodes.length) {
          setEpIndex(idx + 1);
          setLine(0);
          play(0, idx + 1);
        }
      },
    });
  };

  const choose = (i: number) => {
    stop();
    setEpIndex(i);
    setLine(0);
  };
  const jump = (i: number) => {
    const target = Math.max(0, Math.min(ep.lines.length - 1, i));
    setLine(target);
    if (playing) play(target);
  };

  const totalTiles = new Set(episodes.flatMap((e) => e.tiles)).size;
  const minutes = (n: number) => Math.max(1, Math.round((n * 14) / 60 / rate));

  return (
    <div className="page">
      <h1>Podcast: el mapa caja por caja</h1>
      <p className="muted">
        {HOSTS.A} y {HOSTS.B} recorren las {totalTiles} cajas del mapa de Microsoft 365 Business Premium: qué es cada una, un ejemplo real y cómo se activa
        en Gobierno M365. Se reproduce con las voces en español de tu equipo.
      </p>

      {!supported && <div className="card warn-card">Este navegador no permite síntesis de voz. Usa Edge o Chrome, o descarga el guion.</div>}
      {supported && voices.length === 0 && (
        <div className="card warn-card small">
          No se encontraron voces en español. En Windows: Configuración → Hora e idioma → Voz → Agregar voces (Español). En Edge se incluyen voces
          naturales en línea.
        </div>
      )}

      <div className="podcast-layout">
        <aside className="card episode-list">
          <h2>Episodios</h2>
          <ol>
            {episodes.map((e, i) => (
              <li key={e.id}>
                <button className={i === epIndex ? 'on' : ''} onClick={() => choose(i)}>
                  <span className="ep-num">{e.number}</span>
                  <span>
                    <b>{e.title}</b>
                    <span className="muted small">
                      {e.tiles.length ? `${e.tiles.length} cajas · ` : ''}≈{minutes(e.lines.length)} min
                    </span>
                    <span className="ep-bar">
                      <i style={{ width: `${progress[e.id] ?? 0}%` }} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="podcast-downloads">
            <button className="btn" onClick={() => download('podcast-m365-guion.txt', transcript(episodes))}>
              Descargar guion (.txt)
            </button>
            <button className="btn" onClick={() => download('podcast-m365.ps1', audioScript(episodes))}>
              Generar audio en Windows (.ps1)
            </button>
            <p className="muted small">
              El script crea un archivo .wav por episodio con las voces de Windows, sin internet, para escucharlo en el celular:
              <code> powershell -ExecutionPolicy Bypass -File .\podcast-m365.ps1</code>
            </p>
          </div>
        </aside>

        <section>
          <div className="card player">
            <div className="now">
              <span className="muted small">
                Episodio {ep.number} · línea {line + 1} de {ep.lines.length}
              </span>
              <h2>{ep.title}</h2>
              <p className="muted small">{ep.summary}</p>
            </div>
            {tile ? (
              <div className={`now-tile g-${tile.group}`}>
                <div>
                  <span className="small">{app.catalog.groups[tile.group]}</span>
                  <b>{tile.name}</b>
                </div>
                <button className="btn" onClick={() => app.openTile(tile.id)}>
                  Abrir en el mapa
                </button>
              </div>
            ) : (
              <div className="now-tile neutral">
                <b>Introducción</b>
              </div>
            )}
            <div className="controls">
              <button className="btn" onClick={() => jump(line - 1)} aria-label="Línea anterior">
                ⏮
              </button>
              {playing ? (
                <button className="btn primary big" onClick={stop}>
                  ⏸ Pausa
                </button>
              ) : (
                <button className="btn primary big" onClick={() => play()} disabled={!supported}>
                  ▶ {line > 0 ? 'Continuar' : 'Reproducir'}
                </button>
              )}
              <button className="btn" onClick={() => jump(line + 1)} aria-label="Línea siguiente">
                ⏭
              </button>
              <label className="small">
                Velocidad
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
              {voices.length > 0 && (
                <>
                  <label className="small">
                    Voz de {HOSTS.A}
                    <select value={voiceA} onChange={(e) => setVoiceA(e.target.value)}>
                      {voices.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="small">
                    Voz de {HOSTS.B}
                    <select value={voiceB} onChange={(e) => setVoiceB(e.target.value)}>
                      {voices.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="card transcript">
            <h3>Transcripción</h3>
            <ol>
              {ep.lines.map((l, i) => (
                <li key={i} ref={i === line ? lineRef : undefined} className={`${i === line ? 'current' : ''} sp-${l.speaker}`} onClick={() => jump(i)}>
                  <b>{HOSTS[l.speaker]}:</b> {l.text}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
