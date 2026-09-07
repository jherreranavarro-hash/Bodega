import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";
import type { Producto } from "../types";

interface Motivo { id: string; nombre: string; requiereEvidencia: boolean }
interface DevolucionDetalle {
  id: string;
  productoId: string;
  cantidad: string;
  resolucion: string | null;
}
interface Devolucion {
  id: string;
  folio: string;
  estado: string;
  bodegaId: string;
  detalle: DevolucionDetalle[];
}

const RESOLUCIONES = [
  ["REINGRESO_DISPONIBLE", "Reingresar a disponible"],
  ["CUARENTENA", "Mantener en cuarentena"],
  ["BAJA", "Dar de baja"],
] as const;

export function Devoluciones() {
  const { bodegas } = useBodegas();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [motivosDevolucion, setMotivosDevolucion] = useState<Motivo[]>([]);
  const [motivosBaja, setMotivosBaja] = useState<Motivo[]>([]);
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setDevoluciones(await api.get<Devolucion[]>("/devoluciones"));
  }

  useEffect(() => {
    api.get<Producto[]>("/productos").then(setProductos);
    api.get<Motivo[]>("/catalogos/motivos?categoria=DEVOLUCION").then(setMotivosDevolucion);
    api.get<Motivo[]>("/catalogos/motivos?categoria=BAJA").then(setMotivosBaja);
    cargar();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Devoluciones y excepciones</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Toda devolución ingresa primero a cuarentena: nunca vuelve automáticamente al stock disponible.
        Requiere una resolución explícita (reingreso, cuarentena definitiva o baja con motivo y evidencia).
      </p>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <FormularioDevolucion
        bodegas={bodegas}
        productos={productos}
        motivos={motivosDevolucion}
        onCreada={async () => { setMensaje("Devolución ingresada a cuarentena, pendiente de inspección."); await cargar(); }}
        onError={setError}
      />

      {devoluciones.map((d) => (
        <div key={d.id} className="tarjeta">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{d.folio}</strong>
            <span className={`badge ${d.estado === "RESUELTA" ? "badge-ok" : "badge-pendiente"}`}>{d.estado.replaceAll("_", " ")}</span>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Resolución</th></tr></thead>
            <tbody>
              {d.detalle.map((det) => (
                <FilaDevolucion
                  key={det.id}
                  detalle={det}
                  productos={productos}
                  bodegaId={d.bodegaId}
                  bodegas={bodegas}
                  motivosBaja={motivosBaja}
                  onResuelta={async () => { setMensaje("Línea resuelta."); await cargar(); }}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {devoluciones.length === 0 && <p style={{ color: "var(--texto-suave)" }}>Sin devoluciones registradas.</p>}
    </div>
  );
}

function FilaDevolucion({
  detalle,
  productos,
  bodegaId,
  bodegas,
  motivosBaja,
  onResuelta,
  onError,
}: {
  detalle: DevolucionDetalle;
  productos: Producto[];
  bodegaId: string;
  bodegas: ReturnType<typeof useBodegas>["bodegas"];
  motivosBaja: Motivo[];
  onResuelta: () => void;
  onError: (m: string) => void;
}) {
  const [resolucion, setResolucion] = useState<(typeof RESOLUCIONES)[number][0]>("REINGRESO_DISPONIBLE");
  const [ubicacionDestinoId, setUbicacionDestinoId] = useState("");
  const [motivoResolucionId, setMotivoResolucionId] = useState("");
  const [evidenciaUrl, setEvidenciaUrl] = useState("");
  const producto = productos.find((p) => p.id === detalle.productoId);
  const ubicaciones = bodegas.find((b) => b.id === bodegaId)?.ubicaciones ?? [];
  const motivo = motivosBaja.find((m) => m.id === motivoResolucionId);

  async function resolver() {
    try {
      await api.post(`/devoluciones/detalle/${detalle.id}/resolver`, {
        resolucion,
        ubicacionDestinoId: resolucion === "REINGRESO_DISPONIBLE" ? ubicacionDestinoId : undefined,
        motivoResolucionId: resolucion === "BAJA" ? motivoResolucionId : undefined,
        evidenciaUrl: resolucion === "BAJA" ? evidenciaUrl : undefined,
      });
      onResuelta();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo resolver la línea");
    }
  }

  if (detalle.resolucion) {
    return (
      <tr>
        <td>{producto?.codigo ?? detalle.productoId}</td>
        <td>{detalle.cantidad}</td>
        <td><span className="badge badge-ok">{detalle.resolucion.replaceAll("_", " ")}</span></td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{producto?.codigo ?? detalle.productoId}</td>
      <td>{detalle.cantidad}</td>
      <td style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select value={resolucion} onChange={(e) => setResolucion(e.target.value as typeof resolucion)}>
          {RESOLUCIONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {resolucion === "REINGRESO_DISPONIBLE" && (
          <select value={ubicacionDestinoId} onChange={(e) => setUbicacionDestinoId(e.target.value)}>
            <option value="" disabled>Ubicación destino...</option>
            {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}
          </select>
        )}
        {resolucion === "BAJA" && (
          <>
            <select value={motivoResolucionId} onChange={(e) => setMotivoResolucionId(e.target.value)}>
              <option value="" disabled>Motivo de baja...</option>
              {motivosBaja.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
            {motivo?.requiereEvidencia && (
              <input placeholder="URL de evidencia" value={evidenciaUrl} onChange={(e) => setEvidenciaUrl(e.target.value)} />
            )}
          </>
        )}
        <button className="btn btn-secundario" onClick={resolver}>Resolver</button>
      </td>
    </tr>
  );
}

function FormularioDevolucion({
  bodegas,
  productos,
  motivos,
  onCreada,
  onError,
}: {
  bodegas: ReturnType<typeof useBodegas>["bodegas"];
  productos: Producto[];
  motivos: Motivo[];
  onCreada: () => void;
  onError: (m: string) => void;
}) {
  const [folio, setFolio] = useState("");
  const [bodegaId, setBodegaId] = useState("");
  const [motivoId, setMotivoId] = useState("");
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(1);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/devoluciones", {
        folio,
        bodegaId,
        motivoId,
        detalle: [{ productoId, cantidad }],
      });
      setFolio("");
      onCreada();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo registrar la devolución");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <span style={{ gridColumn: "1 / -1", fontWeight: 600 }}>Registrar ingreso de devolución</span>
      <label><span className="etiqueta">Folio *</span><input required value={folio} onChange={(e) => setFolio(e.target.value)} /></label>
      <label>
        <span className="etiqueta">Bodega *</span>
        <select required value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}
        </select>
      </label>
      <label>
        <span className="etiqueta">Motivo de la devolución *</span>
        <select required value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {motivos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
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
      <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Registrar ingreso</button></div>
    </form>
  );
}
