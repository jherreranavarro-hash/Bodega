import { useEffect, useState } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";
import type { Producto } from "../types";

interface ResultadoPronostico {
  suficiente: boolean;
  diasDisponibles?: number;
  diasRequeridos?: number;
  mensaje?: string;
  demandaEstimada?: string;
  errorAbsolutoMedio?: string | null;
  diasHistoriaUsados?: number;
  ventanaDias?: number;
  limitaciones?: string[];
}

interface Escenario {
  id: string;
  nombre: string;
  supuestos: Record<string, unknown>;
  resultado: { puntoReposicionActual: string; puntoReposicionSimulado: string; diferencia: string; coberturaDiasActual: string | null; coberturaDiasSimulada: string | null } | null;
  creadoEn: string;
}

export function Pronosticos() {
  const { bodegas } = useBodegas();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [bodegaId, setBodegaId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [resultado, setResultado] = useState<ResultadoPronostico | null>(null);
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Producto[]>("/productos").then(setProductos);
    api.get<Escenario[]>("/analitica/escenarios").then(setEscenarios);
  }, []);

  async function calcular() {
    setError(null);
    setResultado(null);
    try {
      const r = await api.post<ResultadoPronostico>("/analitica/pronosticos", { productoId, bodegaId });
      setResultado(r);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo calcular el pronóstico");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Pronósticos y escenarios de simulación</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        El pronóstico se calcula solo con demanda real registrada (solicitudes y despachos). Si no hay suficiente
        historia, el sistema lo declara explícitamente en vez de inventar una cifra.
      </p>
      {error && <div className="mensaje-error">{error}</div>}

      <div className="tarjeta grid-form">
        <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Calcular pronóstico de demanda diaria</span>
        <label>
          <span className="etiqueta">Bodega *</span>
          <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
            <option value="" disabled>Seleccione...</option>
            {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
          </select>
        </label>
        <label>
          <span className="etiqueta">Producto *</span>
          <select value={productoId} onChange={(e) => setProductoId(e.target.value)}>
            <option value="" disabled>Seleccione...</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
          </select>
        </label>
        <div style={{ alignSelf: "end" }}>
          <button className="btn" disabled={!bodegaId || !productoId} onClick={calcular}>Calcular</button>
        </div>
      </div>

      {resultado && !resultado.suficiente && (
        <div className="tarjeta">
          <span className="badge badge-pendiente">Datos insuficientes</span>
          <p style={{ marginTop: 8 }}>{resultado.mensaje}</p>
          <p style={{ color: "var(--texto-suave)", fontSize: "0.85rem" }}>
            Días disponibles: {resultado.diasDisponibles} — mínimo requerido: {resultado.diasRequeridos}
          </p>
        </div>
      )}
      {resultado && resultado.suficiente && (
        <div className="tarjeta">
          <span className="badge badge-ok">Pronóstico calculado</span>
          <p style={{ marginTop: 8 }}>
            Demanda diaria estimada: <strong>{resultado.demandaEstimada}</strong> unidades
            {resultado.errorAbsolutoMedio && ` (error absoluto medio del método: ${resultado.errorAbsolutoMedio})`}
          </p>
          <p style={{ color: "var(--texto-suave)", fontSize: "0.85rem" }}>
            Calculado sobre {resultado.diasHistoriaUsados} día(s) de historia real, ventana de {resultado.ventanaDias} días.
          </p>
          <ul style={{ fontSize: "0.85rem", color: "var(--texto-suave)" }}>
            {resultado.limitaciones?.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <FormularioEscenario
        bodegas={bodegas}
        productos={productos}
        onCreado={async (e) => { setEscenarios([e, ...escenarios]); }}
        onError={setError}
      />

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Escenarios simulados (no son datos reales)</h3>
        <table>
          <thead><tr><th>Nombre</th><th>Punto reposición actual</th><th>Punto reposición simulado</th><th>Cobertura actual (días)</th><th>Cobertura simulada (días)</th></tr></thead>
          <tbody>
            {escenarios.map((es) => (
              <tr key={es.id}>
                <td>{es.nombre}</td>
                <td>{es.resultado?.puntoReposicionActual}</td>
                <td><strong>{es.resultado?.puntoReposicionSimulado}</strong></td>
                <td>{es.resultado?.coberturaDiasActual ?? "—"}</td>
                <td>{es.resultado?.coberturaDiasSimulada ?? "—"}</td>
              </tr>
            ))}
            {escenarios.length === 0 && <tr><td colSpan={5} style={{ color: "var(--texto-suave)" }}>Sin escenarios simulados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormularioEscenario({
  bodegas,
  productos,
  onCreado,
  onError,
}: {
  bodegas: ReturnType<typeof useBodegas>["bodegas"];
  productos: Producto[];
  onCreado: (e: Escenario) => void;
  onError: (m: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [incrementoDemandaPct, setIncrementoDemandaPct] = useState(0);
  const [retrasoProveedorDias, setRetrasoProveedorDias] = useState(0);
  const [cambioStockSeguridad, setCambioStockSeguridad] = useState(0);

  async function simular() {
    try {
      const escenario = await api.post<Escenario>("/analitica/escenarios", {
        nombre,
        bodegaId,
        productoId,
        incrementoDemandaPct,
        retrasoProveedorDias,
        cambioStockSeguridad,
      });
      onCreado(escenario);
      setNombre("");
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo simular (¿tiene parámetros de reposición configurados?)");
    }
  }

  return (
    <div className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Simular un escenario</span>
      <label><span className="etiqueta">Nombre *</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega *</span>
        <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Producto *</span>
        <select value={productoId} onChange={(e) => setProductoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </select>
      </label>
      <label><span className="etiqueta">Aumento de demanda (%)</span><input type="number" value={incrementoDemandaPct} onChange={(e) => setIncrementoDemandaPct(Number(e.target.value))} /></label>
      <label><span className="etiqueta">Atraso del proveedor (días)</span><input type="number" value={retrasoProveedorDias} onChange={(e) => setRetrasoProveedorDias(Number(e.target.value))} /></label>
      <label><span className="etiqueta">Cambio en stock de seguridad</span><input type="number" value={cambioStockSeguridad} onChange={(e) => setCambioStockSeguridad(Number(e.target.value))} /></label>
      <div style={{ alignSelf: "end" }}>
        <button className="btn" disabled={!nombre || !bodegaId || !productoId} onClick={simular}>Simular</button>
      </div>
    </div>
  );
}
