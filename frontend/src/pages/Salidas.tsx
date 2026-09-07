import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";
import type { Producto } from "../types";

interface SolicitudSalida {
  id: string;
  folio: string;
  estado: string;
  bodegaId: string;
  detalle: { id: string; productoId: string; cantidadSolicitada: string; cantidadAtendida: string }[];
  reservas: { id: string; productoId: string; estado: string; detalle: { id: string; cantidad: string; cantidadConsumida: string }[] }[];
}

interface PreparacionDetalle {
  id: string;
  productoId: string;
  cantidadSolicitada: string;
  cantidadVerificada: string;
}
interface Preparacion {
  id: string;
  folio: string;
  solicitudId: string;
  estado: string;
  detalle: PreparacionDetalle[];
}

export function Salidas() {
  const { bodegas } = useBodegas();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudSalida[]>([]);
  const [preparaciones, setPreparaciones] = useState<Preparacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setSolicitudes(await api.get<SolicitudSalida[]>("/salidas/solicitudes"));
    setPreparaciones(await api.get<Preparacion[]>("/preparaciones"));
  }

  useEffect(() => {
    api.get<Producto[]>("/productos").then(setProductos);
    cargar();
  }, []);

  async function crearReserva(solicitudDetalleId: string, productoId: string, bodegaId: string, cantidad: number) {
    setError(null);
    try {
      await api.post("/salidas/reservas", { solicitudDetalleId, productoId, bodegaId, cantidad });
      setMensaje("Reserva creada: el stock queda comprometido, no despachado.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo reservar (stock libre insuficiente)");
    }
  }

  async function crearPreparacion(solicitudId: string) {
    setError(null);
    try {
      await api.post("/preparaciones", { folio: `PREP-${Date.now()}`, solicitudId });
      setMensaje("Lista de preparación creada: verifique cada línea antes de despachar.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo crear la preparación");
    }
  }

  async function verificarLinea(detalleId: string, cantidad: number) {
    setError(null);
    try {
      await api.post(`/preparaciones/detalle/${detalleId}/verificar`, { cantidadVerificada: cantidad });
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo registrar la verificación");
    }
  }

  async function marcarLista(preparacionId: string) {
    setError(null);
    try {
      await api.post(`/preparaciones/${preparacionId}/marcar-lista`);
      setMensaje("Preparación lista para despacho.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "Quedan líneas sin verificar por completo");
    }
  }

  async function despachar(bodegaId: string, productoId: string, reservaDetalleId: string, cantidad: number, preparacionId?: string) {
    setError(null);
    try {
      await api.post("/salidas/despachos", {
        folio: `DESP-${Date.now()}`,
        bodegaId,
        preparacionId,
        fechaEfectiva: new Date().toISOString(),
        detalle: [{ productoId, reservaDetalleId, cantidad }],
      });
      setMensaje("Despacho contabilizado: la reserva se consumió en la misma transacción.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo despachar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Solicitudes, reservas, preparación y despacho</h2>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <FormularioSolicitud bodegas={bodegas} productos={productos} onCreada={async () => { setMensaje("Solicitud creada."); await cargar(); }} onError={setError} />

      {solicitudes.map((s) => {
        const preparacion = preparaciones.find((p) => p.solicitudId === s.id);
        return (
          <div key={s.id} className="tarjeta">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{s.folio}</strong>
              <span className="badge badge-pendiente">{s.estado.replaceAll("_", " ")}</span>
            </div>
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>Producto</th><th>Solicitado</th><th>Atendido</th><th>Acción</th></tr></thead>
              <tbody>
                {s.detalle.map((d) => {
                  const producto = productos.find((p) => p.id === d.productoId);
                  const reservaLinea = s.reservas.flatMap((r) => r.detalle.map((rd) => ({ ...rd, reservaId: r.id, productoId: r.productoId }))).find((rd) => rd.productoId === d.productoId);
                  const remanenteReserva = reservaLinea ? Number(reservaLinea.cantidad) - Number(reservaLinea.cantidadConsumida) : 0;
                  const puedeDespachar = !preparacion || preparacion.estado === "LISTA";
                  return (
                    <tr key={d.id}>
                      <td>{producto?.codigo ?? d.productoId}</td>
                      <td>{d.cantidadSolicitada}</td>
                      <td>{d.cantidadAtendida}</td>
                      <td>
                        {!reservaLinea ? (
                          <button className="btn btn-secundario" onClick={() => crearReserva(d.id, d.productoId, s.bodegaId, Number(d.cantidadSolicitada))}>
                            Reservar
                          </button>
                        ) : remanenteReserva <= 0 ? (
                          <span className="badge badge-ok">Sin remanente</span>
                        ) : (
                          <button
                            className="btn"
                            disabled={!puedeDespachar}
                            title={!puedeDespachar ? "La preparación debe quedar LISTA antes de despachar" : undefined}
                            onClick={() => despachar(s.bodegaId, d.productoId, reservaLinea.id, remanenteReserva, preparacion?.id)}
                          >
                            Despachar remanente ({remanenteReserva})
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {s.reservas.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--borde)", paddingTop: 10 }}>
                <strong style={{ fontSize: "0.85rem" }}>Preparación</strong>
                {!preparacion ? (
                  <div style={{ marginTop: 6 }}>
                    <button className="btn btn-secundario" onClick={() => crearPreparacion(s.id)}>Crear lista de preparación</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 6 }}>
                    <span className={`badge ${preparacion.estado === "LISTA" ? "badge-ok" : "badge-pendiente"}`}>{preparacion.estado}</span>
                    <table style={{ marginTop: 6 }}>
                      <thead><tr><th>Producto</th><th>Solicitado</th><th>Verificado</th><th>Acción</th></tr></thead>
                      <tbody>
                        {preparacion.detalle.map((pd) => (
                          <FilaPreparacion key={pd.id} detalle={pd} productos={productos} bloqueado={preparacion.estado === "LISTA"} onVerificar={verificarLinea} />
                        ))}
                      </tbody>
                    </table>
                    {preparacion.estado !== "LISTA" && (
                      <button className="btn" style={{ marginTop: 6 }} onClick={() => marcarLista(preparacion.id)}>Marcar preparación como lista</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {solicitudes.length === 0 && <p style={{ color: "var(--texto-suave)" }}>Sin solicitudes registradas.</p>}
    </div>
  );
}

function FilaPreparacion({
  detalle,
  productos,
  bloqueado,
  onVerificar,
}: {
  detalle: PreparacionDetalle;
  productos: Producto[];
  bloqueado: boolean;
  onVerificar: (detalleId: string, cantidad: number) => void;
}) {
  const [cantidad, setCantidad] = useState(Number(detalle.cantidadVerificada));
  const producto = productos.find((p) => p.id === detalle.productoId);
  return (
    <tr>
      <td>{producto?.codigo ?? detalle.productoId}</td>
      <td>{detalle.cantidadSolicitada}</td>
      <td>{detalle.cantidadVerificada}</td>
      <td style={{ display: "flex", gap: 6 }}>
        <input type="number" min={0} max={Number(detalle.cantidadSolicitada)} value={cantidad} disabled={bloqueado} onChange={(e) => setCantidad(Number(e.target.value))} style={{ width: 80 }} />
        {!bloqueado && <button className="btn btn-secundario" onClick={() => onVerificar(detalle.id, cantidad)}>Verificar</button>}
      </td>
    </tr>
  );
}

function FormularioSolicitud({ bodegas, productos, onCreada, onError }: { bodegas: ReturnType<typeof useBodegas>["bodegas"]; productos: Producto[]; onCreada: () => void; onError: (m: string) => void }) {
  const [folio, setFolio] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(10);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/salidas/solicitudes", {
        folio,
        bodegaId,
        tipoDestino: "AREA_INTERNA",
        detalle: [{ productoId, cantidadSolicitada: cantidad }],
      });
      setFolio("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo crear la solicitud");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Nueva solicitud de salida</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega *</span>
        <select required value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Producto *</span>
        <select required value={productoId} onChange={(e) => setProductoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </select>
      </label>
      <label><span className="etiqueta">Cantidad</span><input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} /></label>
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Crear solicitud</button></div>
    </form>
  );
}
