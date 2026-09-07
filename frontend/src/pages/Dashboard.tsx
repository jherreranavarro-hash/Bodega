import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useBodegas } from "../hooks/useBodegas";

interface Disponibilidad {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  stockFisicoTotal: string;
  stockUtilizable: string;
  stockReservado: string;
  stockLibre: string;
  stockBloqueado: string;
  stockCuarentena: string;
  stockTransito: string;
}
interface Reposicion {
  productoCodigo: string;
  productoNombre: string;
  bodegaCodigo: string;
  stockLibre: string;
  puntoReposicion: string;
  faltante: string;
}
interface Vencimiento {
  productoCodigo: string;
  loteCodigo?: string;
  fechaVencimiento?: string;
  bodegaCodigo: string;
  ubicacionCodigo: string;
  cantidad: string;
}

export function Dashboard() {
  const { bodegas } = useBodegas();
  const [bodegaId, setBodegaId] = useState<string>("");
  const [disponibilidad, setDisponibilidad] = useState<Disponibilidad[]>([]);
  const [reposicion, setReposicion] = useState<Reposicion[]>([]);
  const [vencimientos, setVencimientos] = useState<Vencimiento[]>([]);

  useEffect(() => {
    if (bodegas.length > 0 && !bodegaId) setBodegaId(bodegas[0].id);
  }, [bodegas, bodegaId]);

  useEffect(() => {
    if (!bodegaId) return;
    api.get<Disponibilidad[]>(`/indicadores/disponibilidad?bodegaId=${bodegaId}`).then(setDisponibilidad);
    api.get<Reposicion[]>(`/indicadores/reposicion?bodegaId=${bodegaId}`).then(setReposicion);
  }, [bodegaId]);

  useEffect(() => {
    api.get<Vencimiento[]>("/indicadores/vencimientos?dias=30").then(setVencimientos);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Tablero de decisiones</h2>
        <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
          {bodegas.map((b) => (
            <option key={b.id} value={b.id}>
              {b.codigo} — {b.nombre}
            </option>
          ))}
        </select>
      </div>

      <section className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Disponibilidad por producto</h3>
        <p style={{ color: "var(--texto-suave)", fontSize: "0.85rem", marginTop: -6 }}>
          Stock libre = stock utilizable − reservas activas. Calculado en vivo desde saldos_inventario y reservas.
        </p>
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Físico total</th>
              <th>Utilizable</th>
              <th>Reservado</th>
              <th>Libre</th>
              <th>Bloqueado</th>
              <th>Cuarentena</th>
              <th>Tránsito</th>
            </tr>
          </thead>
          <tbody>
            {disponibilidad.map((d) => (
              <tr key={d.productoId}>
                <td>{d.productoCodigo} — {d.productoNombre}</td>
                <td>{d.stockFisicoTotal}</td>
                <td>{d.stockUtilizable}</td>
                <td>{d.stockReservado}</td>
                <td><strong>{d.stockLibre}</strong></td>
                <td>{d.stockBloqueado}</td>
                <td>{d.stockCuarentena}</td>
                <td>{d.stockTransito}</td>
              </tr>
            ))}
            {disponibilidad.length === 0 && (
              <tr><td colSpan={8} style={{ color: "var(--texto-suave)" }}>Sin existencias registradas en esta bodega.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Productos bajo punto de reposición</h3>
        <table>
          <thead>
            <tr><th>Producto</th><th>Bodega</th><th>Stock libre</th><th>Punto de reposición</th><th>Faltante</th></tr>
          </thead>
          <tbody>
            {reposicion.map((r, i) => (
              <tr key={i}>
                <td>{r.productoCodigo} — {r.productoNombre}</td>
                <td>{r.bodegaCodigo}</td>
                <td>{r.stockLibre}</td>
                <td>{r.puntoReposicion}</td>
                <td><span className="badge badge-alerta">{r.faltante}</span></td>
              </tr>
            ))}
            {reposicion.length === 0 && <tr><td colSpan={5} style={{ color: "var(--texto-suave)" }}>Ningún producto bajo su punto de reposición.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Vencimientos próximos (30 días)</h3>
        <table>
          <thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Bodega</th><th>Ubicación</th><th>Cantidad</th></tr></thead>
          <tbody>
            {vencimientos.map((v, i) => (
              <tr key={i}>
                <td>{v.productoCodigo}</td>
                <td>{v.loteCodigo}</td>
                <td>{v.fechaVencimiento ? new Date(v.fechaVencimiento).toLocaleDateString("es-CL") : "-"}</td>
                <td>{v.bodegaCodigo}</td>
                <td>{v.ubicacionCodigo}</td>
                <td>{v.cantidad}</td>
              </tr>
            ))}
            {vencimientos.length === 0 && <tr><td colSpan={6} style={{ color: "var(--texto-suave)" }}>Sin lotes por vencer en la ventana configurada.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
