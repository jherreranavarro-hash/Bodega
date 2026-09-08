import { useEffect, useState } from "react";
import { api, ErrorApi } from "../api/client";

interface Precio {
  modo: "FIJO" | "PORCENTAJE";
  precioFijoClp: string | null;
  porcentajeMargen: string | null;
  valorReferenciaClp: string | null;
  valorReferenciaUsd: string | null;
  precioVentaCalculado: string | null;
}

interface FilaPrecio {
  productoId: string;
  codigo: string;
  nombre: string;
  grupo: string | null;
  precio: Precio | null;
}

const formatoClp = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export function PreciosVenta() {
  const [filas, setFilas] = useState<FilaPrecio[]>([]);
  const [edicion, setEdicion] = useState<Record<string, { modo: "FIJO" | "PORCENTAJE"; valor: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    const datos = await api.get<FilaPrecio[]>("/precios");
    setFilas(datos);
    setEdicion((previo) => {
      const siguiente = { ...previo };
      for (const f of datos) {
        if (siguiente[f.productoId]) continue;
        const modo = f.precio?.modo ?? "PORCENTAJE";
        const valor = modo === "FIJO" ? f.precio?.precioFijoClp ?? "" : f.precio?.porcentajeMargen ?? "";
        siguiente[f.productoId] = { modo, valor: valor ?? "" };
      }
      return siguiente;
    });
  }

  useEffect(() => {
    cargar().catch((err) => setError(err instanceof ErrorApi ? err.message : "No se pudo cargar el mantenedor de precios"));
  }, []);

  function actualizarEdicion(productoId: string, cambio: Partial<{ modo: "FIJO" | "PORCENTAJE"; valor: string }>) {
    setEdicion((previo) => ({ ...previo, [productoId]: { ...previo[productoId], ...cambio } }));
  }

  async function guardar(productoId: string) {
    setError(null);
    setMensaje(null);
    const e = edicion[productoId];
    if (!e || e.valor.trim() === "") return setError("Ingrese un valor antes de guardar");
    try {
      await api.put(`/precios/${productoId}`, {
        modo: e.modo,
        precioFijoClp: e.modo === "FIJO" ? Number(e.valor) : undefined,
        porcentajeMargen: e.modo === "PORCENTAJE" ? Number(e.valor) : undefined,
      });
      setMensaje("Precio actualizado.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo actualizar el precio");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Precios de venta</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Define el precio de venta de cada producto en pesos (fijo) o como porcentaje de margen sobre el último valor
        declarado en su llegada (Mercado Libre / liquidación). Sin valor de referencia todavía, el modo porcentaje no
        calcula un precio — nunca se inventa una cifra.
      </p>

      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Grupo</th>
              <th>Valor referencia</th>
              <th>Modo</th>
              <th>Valor</th>
              <th>Precio de venta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const e = edicion[f.productoId] ?? { modo: "PORCENTAJE" as const, valor: "" };
              return (
                <tr key={f.productoId}>
                  <td>{f.codigo}</td>
                  <td>{f.nombre}</td>
                  <td>{f.grupo ?? "—"}</td>
                  <td>{f.precio?.valorReferenciaClp ? formatoClp.format(Number(f.precio.valorReferenciaClp)) : "—"}</td>
                  <td>
                    <select value={e.modo} onChange={(ev) => actualizarEdicion(f.productoId, { modo: ev.target.value as "FIJO" | "PORCENTAJE" })}>
                      <option value="PORCENTAJE">Porcentaje</option>
                      <option value="FIJO">Fijo (CLP)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      style={{ width: 100 }}
                      value={e.valor}
                      onChange={(ev) => actualizarEdicion(f.productoId, { valor: ev.target.value })}
                      placeholder={e.modo === "FIJO" ? "CLP" : "%"}
                    />
                  </td>
                  <td>
                    <strong>{f.precio?.precioVentaCalculado ? formatoClp.format(Number(f.precio.precioVentaCalculado)) : "Sin calcular"}</strong>
                  </td>
                  <td>
                    <button className="btn btn-secundario" onClick={() => guardar(f.productoId)}>Guardar</button>
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={8} style={{ color: "var(--texto-suave)" }}>Sin productos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
