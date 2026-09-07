import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";
import type { Producto } from "../types";

interface Transferencia {
  id: string;
  folio: string;
  estado: string;
  bodegaOrigenId: string;
  bodegaDestinoId: string;
  detalle: { id: string; productoId: string; cantidadEnviada: string; cantidadRecibida: string }[];
}

export function Transferencias() {
  const { bodegas } = useBodegas();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [transferencias, setTransferencias] = useState<Transferencia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setTransferencias(await api.get<Transferencia[]>("/transferencias"));
  }

  useEffect(() => {
    api.get<Producto[]>("/productos").then(setProductos);
    cargar();
  }, []);

  async function recibir(t: Transferencia, detalleId: string, productoId: string, cantidad: number) {
    setError(null);
    const bodegaDestino = bodegas.find((b) => b.id === t.bodegaDestinoId);
    const ubicacionDestinoId = bodegaDestino?.ubicaciones.find((u) => u.tipo === "ALMACENAMIENTO")?.id ?? bodegaDestino?.ubicaciones[0]?.id;
    if (!ubicacionDestinoId) return setError("La bodega destino no tiene ubicaciones configuradas");
    try {
      await api.post(`/transferencias/${t.id}/recibir`, {
        detalle: [{ transferenciaDetalleId: detalleId, productoId, cantidad, ubicacionDestinoId }],
      });
      setMensaje("Recepción de transferencia registrada.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo recibir la transferencia");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Transferencias entre bodegas</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Al despachar, la mercadería deja de estar disponible en origen y queda en tránsito. Solo aumenta en destino al recibirse.
      </p>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <FormularioTransferencia bodegas={bodegas} productos={productos} onCreada={async () => { setMensaje("Transferencia despachada."); await cargar(); }} onError={setError} />

      {transferencias.map((t) => (
        <div key={t.id} className="tarjeta">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{t.folio}</strong>
            <span className="badge badge-pendiente">{t.estado.replaceAll("_", " ")}</span>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Producto</th><th>Enviado</th><th>Recibido</th><th>Acción</th></tr></thead>
            <tbody>
              {t.detalle.map((d) => {
                const pendiente = Number(d.cantidadEnviada) - Number(d.cantidadRecibida);
                const producto = productos.find((p) => p.id === d.productoId);
                return (
                  <tr key={d.id}>
                    <td>{producto?.codigo ?? d.productoId}</td>
                    <td>{d.cantidadEnviada}</td>
                    <td>{d.cantidadRecibida}</td>
                    <td>
                      {pendiente > 0 ? (
                        <button className="btn btn-secundario" onClick={() => recibir(t, d.id, d.productoId, pendiente)}>
                          Recibir pendiente ({pendiente})
                        </button>
                      ) : (
                        <span className="badge badge-ok">Completo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {transferencias.length === 0 && <p style={{ color: "var(--texto-suave)" }}>Sin transferencias registradas.</p>}
    </div>
  );
}

function FormularioTransferencia({ bodegas, productos, onCreada, onError }: { bodegas: ReturnType<typeof useBodegas>["bodegas"]; productos: Producto[]; onCreada: () => void; onError: (m: string) => void }) {
  const [folio, setFolio] = useState("");
  const [bodegaOrigenId, setBodegaOrigenId] = useState("");
  const [bodegaDestinoId, setBodegaDestinoId] = useState("");
  const [ubicacionOrigenId, setUbicacionOrigenId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(1);

  const ubicacionesOrigen = bodegas.find((b) => b.id === bodegaOrigenId)?.ubicaciones ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/transferencias", {
        folio,
        bodegaOrigenId,
        bodegaDestinoId,
        detalle: [{ productoId, ubicacionOrigenId, cantidad }],
      });
      setFolio("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo despachar la transferencia");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Nueva transferencia</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega origen *</span>
        <select required value={bodegaOrigenId} onChange={(e) => { setBodegaOrigenId(e.target.value); setUbicacionOrigenId(""); }}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Ubicación origen *</span>
        <select required value={ubicacionOrigenId} onChange={(e) => setUbicacionOrigenId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {ubicacionesOrigen.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Bodega destino *</span>
        <select required value={bodegaDestinoId} onChange={(e) => setBodegaDestinoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.filter((b) => b.id !== bodegaOrigenId).map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
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
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Despachar transferencia</button></div>
    </form>
  );
}
