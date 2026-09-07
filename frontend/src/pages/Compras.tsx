import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";
import type { Producto, Proveedor } from "../types";

interface OrdenCompra {
  id: string;
  folio: string;
  estado: string;
  proveedor: { razonSocial: string };
  detalle: { id: string; productoId: string; cantidadPedida: string; cantidadRecibida: string; costoUnitarioPactado: string }[];
}

interface SolicitudCompra {
  id: string;
  folio: string;
  estado: string;
  origen: string;
  detalle: { id: string; productoId: string; cantidad: string }[];
  ordenesCompra: { id: string }[];
}

export function Compras() {
  const { bodegas } = useBodegas();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudCompra[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setOrdenes(await api.get<OrdenCompra[]>("/compras/ordenes"));
    setSolicitudes(await api.get<SolicitudCompra[]>("/compras/solicitudes"));
  }

  useEffect(() => {
    api.get<Proveedor[]>("/proveedores").then(setProveedores);
    api.get<Producto[]>("/productos").then(setProductos);
    cargar();
  }, []);

  async function aprobar(id: string) {
    setError(null);
    try {
      await api.post(`/compras/solicitudes/${id}/aprobar`);
      setMensaje("Solicitud de compra aprobada.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo aprobar (¿es el mismo usuario que la solicitó?)");
    }
  }

  async function rechazar(id: string) {
    setError(null);
    try {
      await api.post(`/compras/solicitudes/${id}/rechazar`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo rechazar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Compras y recepción</h2>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <FormularioSolicitudCompra
        productos={productos}
        bodegas={bodegas}
        onCreada={async () => { setMensaje("Solicitud de compra creada, pendiente de aprobación."); await cargar(); }}
        onError={setError}
      />

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Solicitudes de compra</h3>
        <p style={{ color: "var(--texto-suave)", fontSize: "0.85rem", marginTop: -6 }}>
          Toda solicitud nace pendiente de aprobación. Quien la crea no puede aprobarla ni rechazarla.
        </p>
        <table>
          <thead><tr><th>Folio</th><th>Origen</th><th>Estado</th><th>Líneas</th><th>Acción</th></tr></thead>
          <tbody>
            {solicitudes.map((s) => (
              <tr key={s.id}>
                <td>{s.folio}</td>
                <td>{s.origen}</td>
                <td><span className={`badge ${s.estado === "APROBADA" ? "badge-ok" : s.estado === "RECHAZADA" ? "badge-alerta" : "badge-pendiente"}`}>{s.estado.replaceAll("_", " ")}</span></td>
                <td>{s.detalle.length}</td>
                <td>
                  {s.estado === "PENDIENTE_APROBACION" && (
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="btn" onClick={() => aprobar(s.id)}>Aprobar</button>
                      <button className="btn btn-secundario" onClick={() => rechazar(s.id)}>Rechazar</button>
                    </span>
                  )}
                  {s.estado === "APROBADA" && s.ordenesCompra.length === 0 && (
                    <ConvertirEnOrden solicitud={s} proveedores={proveedores} productos={productos} onConvertida={async () => { setMensaje("Solicitud convertida en orden de compra."); await cargar(); }} onError={setError} />
                  )}
                  {s.estado === "APROBADA" && s.ordenesCompra.length > 0 && <span className="badge badge-ok">Convertida en OC</span>}
                </td>
              </tr>
            ))}
            {solicitudes.length === 0 && <tr><td colSpan={5} style={{ color: "var(--texto-suave)" }}>Sin solicitudes de compra.</td></tr>}
          </tbody>
        </table>
      </div>

      <FormularioOrdenCompra
        proveedores={proveedores}
        productos={productos}
        onCreada={async () => { setMensaje("Orden de compra creada."); await cargar(); }}
        onError={setError}
      />

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Órdenes de compra</h3>
        <table>
          <thead><tr><th>Folio</th><th>Proveedor</th><th>Estado</th><th>Líneas</th></tr></thead>
          <tbody>
            {ordenes.map((o) => (
              <tr key={o.id}>
                <td>{o.folio}</td>
                <td>{o.proveedor.razonSocial}</td>
                <td><span className="badge badge-pendiente">{o.estado.replaceAll("_", " ")}</span></td>
                <td>{o.detalle.map((d) => `${d.cantidadRecibida}/${d.cantidadPedida}`).join(", ")}</td>
              </tr>
            ))}
            {ordenes.length === 0 && <tr><td colSpan={4} style={{ color: "var(--texto-suave)" }}>Sin órdenes de compra.</td></tr>}
          </tbody>
        </table>
      </div>

      <FormularioRecepcion
        bodegas={bodegas}
        ordenes={ordenes}
        productos={productos}
        onCreada={async () => { setMensaje("Recepción contabilizada."); await cargar(); }}
        onError={setError}
      />
    </div>
  );
}

function FormularioOrdenCompra({ proveedores, productos, onCreada, onError }: { proveedores: Proveedor[]; productos: Producto[]; onCreada: () => void; onError: (m: string) => void }) {
  const [folio, setFolio] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(10);
  const [costo, setCosto] = useState(100);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const producto = productos.find((p) => p.id === productoId);
      await api.post("/compras/ordenes", {
        folio,
        proveedorId,
        detalle: [{ productoId, unidadId: producto?.unidadBaseId, cantidadPedida: cantidad, costoUnitarioPactado: costo }],
      });
      setFolio("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo crear la orden de compra");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Nueva orden de compra (una línea)</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Proveedor *</span>
        <select required value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.razonSocial}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Producto *</span>
        <select required value={productoId} onChange={(e) => setProductoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
        </select>
      </label>
      <label><span className="etiqueta">Cantidad pedida</span><input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} /></label>
      <label><span className="etiqueta">Costo unitario pactado</span><input type="number" min={0} value={costo} onChange={(e) => setCosto(Number(e.target.value))} /></label>
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Crear orden</button></div>
    </form>
  );
}

function FormularioRecepcion({
  bodegas,
  ordenes,
  productos,
  onCreada,
  onError,
}: {
  bodegas: ReturnType<typeof useBodegas>["bodegas"];
  ordenes: OrdenCompra[];
  productos: Producto[];
  onCreada: () => void;
  onError: (m: string) => void;
}) {
  const [folio, setFolio] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [ubicacionId, setUbicacionId] = useState("");
  const [ordenCompraId, setOrdenCompraId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(10);
  const [costo, setCosto] = useState(100);
  const [loteCodigo, setLoteCodigo] = useState("");

  const ubicacionesDeBodega = bodegas.find((b) => b.id === bodegaId)?.ubicaciones ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const orden = ordenes.find((o) => o.id === ordenCompraId);
      const lineaOc = orden?.detalle.find((d) => d.productoId === productoId);
      await api.post("/compras/recepciones", {
        folio,
        bodegaId,
        ordenCompraId: ordenCompraId || undefined,
        detalle: [
          {
            ordenCompraDetalleId: lineaOc?.id,
            productoId,
            ubicacionDestinoId: ubicacionId,
            loteCodigo: loteCodigo || undefined,
            cantidadRecibida: cantidad,
            cantidadAceptada: cantidad,
            costoUnitario: costo,
          },
        ],
      });
      setFolio("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo contabilizar la recepción");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Registrar recepción (total o parcial)</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega *</span>
        <select required value={bodegaId} onChange={(e) => { setBodegaId(e.target.value); setUbicacionId(""); }}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Ubicación destino *</span>
        <select required value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {ubicacionesDeBodega.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Orden de compra (opcional)</span>
        <select value={ordenCompraId} onChange={(e) => setOrdenCompraId(e.target.value)}>
          <option value="">Sin orden asociada</option>
          {ordenes.map((o) => <option key={o.id} value={o.id}>{o.folio}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Producto *</span>
        <select required value={productoId} onChange={(e) => setProductoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
        </select>
      </label>
      <label><span className="etiqueta">Cantidad aceptada</span><input type="number" min={0} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} /></label>
      <label><span className="etiqueta">Costo unitario</span><input type="number" min={0} value={costo} onChange={(e) => setCosto(Number(e.target.value))} /></label>
      <label><span className="etiqueta">Lote (si aplica)</span><input value={loteCodigo} onChange={(e) => setLoteCodigo(e.target.value)} /></label>
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Contabilizar recepción</button></div>
    </form>
  );
}

function FormularioSolicitudCompra({
  productos,
  bodegas,
  onCreada,
  onError,
}: {
  productos: Producto[];
  bodegas: ReturnType<typeof useBodegas>["bodegas"];
  onCreada: () => void;
  onError: (m: string) => void;
}) {
  const [folio, setFolio] = useState("");
  const [productoId, setProductoId] = useState("");
  const [bodegaDestinoId, setBodegaDestinoId] = useState("");
  const [cantidad, setCantidad] = useState(10);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const producto = productos.find((p) => p.id === productoId);
      await api.post("/compras/solicitudes", {
        folio,
        detalle: [{ productoId, cantidad, unidadId: producto?.unidadBaseId, bodegaDestinoId }],
      });
      setFolio("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo crear la solicitud de compra");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Nueva solicitud de compra</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega destino *</span>
        <select required value={bodegaDestinoId} onChange={(e) => setBodegaDestinoId(e.target.value)}>
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
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Solicitar compra</button></div>
    </form>
  );
}

function ConvertirEnOrden({
  solicitud,
  proveedores,
  productos,
  onConvertida,
  onError,
}: {
  solicitud: SolicitudCompra;
  proveedores: Proveedor[];
  productos: Producto[];
  onConvertida: () => void;
  onError: (m: string) => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [costos, setCostos] = useState<Record<string, number>>({});

  async function convertir() {
    try {
      await api.post(`/compras/solicitudes/${solicitud.id}/convertir-orden`, {
        folioOrdenCompra: `OC-${solicitud.folio}`,
        proveedorId,
        costos: solicitud.detalle.map((d) => ({ solicitudDetalleId: d.id, costoUnitarioPactado: costos[d.id] ?? 0 })),
      });
      onConvertida();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo convertir en orden de compra");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
        <option value="" disabled>Proveedor...</option>
        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
      </select>
      {solicitud.detalle.map((d) => {
        const producto = productos.find((p) => p.id === d.productoId);
        return (
          <input
            key={d.id}
            type="number"
            placeholder={`Costo ${producto?.codigo ?? d.productoId}`}
            value={costos[d.id] ?? ""}
            onChange={(e) => setCostos({ ...costos, [d.id]: Number(e.target.value) })}
          />
        );
      })}
      <button className="btn btn-secundario" disabled={!proveedorId} onClick={convertir}>Convertir en orden de compra</button>
    </div>
  );
}
