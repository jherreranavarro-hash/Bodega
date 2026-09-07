import { useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";

const TIPOS_UBICACION = ["RECEPCION", "ALMACENAMIENTO", "PREPARACION", "DESPACHO", "CUARENTENA", "DEVOLUCION"];

export function Bodegas() {
  const { bodegas, cargando } = useBodegas();
  const [recargar, setRecargar] = useState(0);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Bodegas y ubicaciones</h2>
      {error && <div className="mensaje-error">{error}</div>}

      <FormularioBodega onCreada={() => setRecargar((v) => v + 1)} onError={setError} key={`bodega-${recargar}`} />

      {!cargando &&
        bodegas.map((b) => (
          <div key={b.id} className="tarjeta">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{b.codigo} — {b.nombre}</h3>
            </div>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th></tr></thead>
              <tbody>
                {b.ubicaciones.map((u) => (
                  <tr key={u.id}><td>{u.codigo}</td><td>{u.nombre}</td><td>{u.tipo}</td></tr>
                ))}
                {b.ubicaciones.length === 0 && <tr><td colSpan={3} style={{ color: "var(--texto-suave)" }}>Sin ubicaciones registradas.</td></tr>}
              </tbody>
            </table>
            <FormularioUbicacion bodegaId={b.id} onCreada={() => setRecargar((v) => v + 1)} onError={setError} />
          </div>
        ))}
    </div>
  );
}

function FormularioBodega({ onCreada, onError }: { onCreada: () => void; onError: (m: string) => void }) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/bodegas", { codigo, nombre });
      setCodigo("");
      setNombre("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo crear la bodega");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <label><span className="etiqueta">Código de bodega *</span><input required value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
      <label><span className="etiqueta">Nombre *</span><input required value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
      <button className="btn" type="submit">+ Nueva bodega</button>
    </form>
  );
}

function FormularioUbicacion({ bodegaId, onCreada, onError }: { bodegaId: string; onCreada: () => void; onError: (m: string) => void }) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState(TIPOS_UBICACION[0]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/ubicaciones", { bodegaId, codigo, nombre, tipo });
      setCodigo("");
      setNombre("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo crear la ubicación");
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
      <label><span className="etiqueta">Código</span><input required value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
      <label><span className="etiqueta">Nombre</span><input required value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Tipo</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_UBICACION.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <button className="btn btn-secundario" type="submit">+ Ubicación</button>
    </form>
  );
}
