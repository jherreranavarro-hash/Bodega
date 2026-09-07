import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";
import type { Producto } from "../types";

interface Motivo { id: string; nombre: string; requiereEvidencia: boolean }
interface ConteoDetalle { id: string; productoId: string; ubicacionId: string; cantidadEsperada?: string; cantidadContada: string | null }
interface Conteo { id: string; folio: string; estado: string; conteoCiego: boolean; detalle: ConteoDetalle[] }
interface AjusteDetalle { id: string; productoId: string; diferencia: string }
interface AjustePendiente { id: string; folio: string; estado: string; detalle: AjusteDetalle[] }

export function Ajustes() {
  const { bodegas } = useBodegas();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [motivos, setMotivos] = useState<Motivo[]>([]);
  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [ajustes, setAjustes] = useState<AjustePendiente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargarAjustes() {
    setAjustes(await api.get<AjustePendiente[]>("/ajustes"));
  }

  useEffect(() => {
    api.get<Producto[]>("/productos").then(setProductos);
    api.get<Motivo[]>("/catalogos/motivos?categoria=AJUSTE").then(setMotivos);
    cargarAjustes();
  }, []);

  async function aprobar(id: string) {
    setError(null);
    try {
      await api.post(`/ajustes/${id}/aprobar`);
      setMensaje("Ajuste aprobado: la diferencia ya se aplicó al stock.");
      await cargarAjustes();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo aprobar (¿es el mismo usuario que lo solicitó?)");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Conteos y ajustes de inventario</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Una diferencia de conteo no modifica el stock hasta que el ajuste correspondiente es aprobado, con motivo (y evidencia si el motivo lo exige).
      </p>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <FormularioConteo bodegas={bodegas} productos={productos} onCreado={(c) => setConteo(c)} onError={setError} />

      {conteo && (
        <div className="tarjeta">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{conteo.folio}</strong>
            <span className="badge badge-pendiente">{conteo.estado.replaceAll("_", " ")}</span>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Producto</th><th>Cantidad contada</th></tr></thead>
            <tbody>
              {conteo.detalle.map((d) => (
                <FilaConteo
                  key={d.id}
                  detalle={d}
                  productos={productos}
                  onRegistrada={async (cantidad) => {
                    await api.post(`/conteos/detalle/${d.id}/registrar`, { cantidadContada: cantidad });
                    const actualizado = await api.get<Conteo>(`/conteos/${conteo.id}`);
                    setConteo(actualizado);
                  }}
                />
              ))}
            </tbody>
          </table>

          <GenerarAjuste
            conteoId={conteo.id}
            motivos={motivos}
            listo={conteo.detalle.every((d) => d.cantidadContada !== null)}
            onGenerado={async (m) => { setMensaje(m); await cargarAjustes(); }}
            onError={setError}
          />
        </div>
      )}

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Ajustes pendientes de aprobación</h3>
        <p style={{ color: "var(--texto-suave)", fontSize: "0.85rem", marginTop: -6 }}>
          Separación de funciones: el servidor rechaza aprobar un ajuste al mismo usuario que lo solicitó.
        </p>
        <table>
          <thead><tr><th>Folio</th><th>Estado</th><th>Líneas con diferencia</th><th>Acción</th></tr></thead>
          <tbody>
            {ajustes.map((a) => (
              <tr key={a.id}>
                <td>{a.folio}</td>
                <td><span className={`badge ${a.estado === "APROBADO" ? "badge-ok" : "badge-pendiente"}`}>{a.estado.replaceAll("_", " ")}</span></td>
                <td>{a.detalle.length}</td>
                <td>{a.estado === "PENDIENTE_APROBACION" && <button className="btn" onClick={() => aprobar(a.id)}>Aprobar</button>}</td>
              </tr>
            ))}
            {ajustes.length === 0 && <tr><td colSpan={4} style={{ color: "var(--texto-suave)" }}>Sin ajustes registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaConteo({ detalle, productos, onRegistrada }: { detalle: ConteoDetalle; productos: Producto[]; onRegistrada: (cantidad: number) => void }) {
  const [cantidad, setCantidad] = useState<number>(detalle.cantidadContada ? Number(detalle.cantidadContada) : 0);
  const producto = productos.find((p) => p.id === detalle.productoId);
  return (
    <tr>
      <td>{producto?.codigo ?? detalle.productoId}</td>
      <td style={{ display: "flex", gap: 8 }}>
        <input type="number" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} style={{ width: 100 }} disabled={detalle.cantidadContada !== null} />
        {detalle.cantidadContada === null ? (
          <button className="btn btn-secundario" onClick={() => onRegistrada(cantidad)}>Registrar</button>
        ) : (
          <span className="badge badge-ok">Registrado</span>
        )}
      </td>
    </tr>
  );
}

function GenerarAjuste({ conteoId, motivos, listo, onGenerado, onError }: { conteoId: string; motivos: Motivo[]; listo: boolean; onGenerado: (m: string) => void; onError: (m: string) => void }) {
  const [motivoId, setMotivoId] = useState("");
  const [evidenciaUrl, setEvidenciaUrl] = useState("");
  const motivo = motivos.find((m) => m.id === motivoId);

  async function generar() {
    try {
      const ajuste = await api.post<{ id: string } | null>("/ajustes/desde-conteo", {
        conteoId,
        motivoId,
        folio: `AJ-${Date.now()}`,
        evidenciaUrl: evidenciaUrl || undefined,
      });
      if (!ajuste) return onGenerado("Sin diferencias: no fue necesario generar un ajuste.");
      onGenerado(`Ajuste ${ajuste.id} generado, pendiente de aprobación por un usuario distinto de quien lo solicitó.`);
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo generar el ajuste");
    }
  }

  if (!listo) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}>
      <label>
        <span className="etiqueta">Motivo *</span>
        <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {motivos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </label>
      {motivo?.requiereEvidencia && (
        <label>
          <span className="etiqueta">URL de evidencia *</span>
          <input value={evidenciaUrl} onChange={(e) => setEvidenciaUrl(e.target.value)} placeholder="https://..." />
        </label>
      )}
      <button className="btn" disabled={!motivoId} onClick={generar}>Generar ajuste desde diferencias</button>
    </div>
  );
}

function FormularioConteo({ bodegas, productos, onCreado, onError }: { bodegas: ReturnType<typeof useBodegas>["bodegas"]; productos: Producto[]; onCreado: (c: Conteo) => void; onError: (m: string) => void }) {
  const [folio, setFolio] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [ubicacionId, setUbicacionId] = useState("");
  const [productoId, setProductoId] = useState("");

  const ubicaciones = bodegas.find((b) => b.id === bodegaId)?.ubicaciones ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const conteo = await api.post<Conteo>("/conteos", {
        folio,
        bodegaId,
        tipo: "CICLICO",
        conteoCiego: true,
        fechaCorte: new Date().toISOString(),
        lineas: [{ productoId, ubicacionId }],
      });
      onCreado(conteo);
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo planificar el conteo");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Planificar conteo cíclico</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega *</span>
        <select required value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Ubicación *</span>
        <select required value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Producto *</span>
        <select required value={productoId} onChange={(e) => setProductoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </select>
      </label>
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Planificar conteo</button></div>
    </form>
  );
}
