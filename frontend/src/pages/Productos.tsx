import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api/client";
import type { Producto, UnidadMedida } from "../types";

interface FiltrosLlegada {
  grupo: string[];
  condicion: string[];
  status: string[];
  subStatus: string[];
  grade: string[];
}

const FILTROS_VACIOS: FiltrosLlegada = { grupo: [], condicion: [], status: [], subStatus: [], grade: [] };

export function Productos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedida[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [opcionesFiltro, setOpcionesFiltro] = useState<FiltrosLlegada>(FILTROS_VACIOS);
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroCondicion, setFiltroCondicion] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroSubStatus, setFiltroSubStatus] = useState("");
  const [filtroGrade, setFiltroGrade] = useState("");
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    const params = new URLSearchParams();
    if (busqueda) params.set("q", busqueda);
    if (filtroGrupo) params.set("grupo", filtroGrupo);
    if (filtroCondicion) params.set("condicion", filtroCondicion);
    if (filtroStatus) params.set("status", filtroStatus);
    if (filtroSubStatus) params.set("subStatus", filtroSubStatus);
    if (filtroGrade) params.set("grade", filtroGrade);
    const query = params.toString();
    setProductos(await api.get<Producto[]>(`/productos${query ? `?${query}` : ""}`));
  }

  useEffect(() => {
    api.get<UnidadMedida[]>("/catalogos/unidades-medida").then(setUnidades);
    api.get<FiltrosLlegada>("/productos/filtros/llegada").then(setOpcionesFiltro);
  }, []);

  // Corre también en el montaje inicial (con los filtros vacíos) y cada vez que
  // cambia alguno de los filtros de la llegada más reciente.
  useEffect(() => {
    cargar();
  }, [filtroGrupo, filtroCondicion, filtroStatus, filtroSubStatus, filtroGrade]);

  async function onBuscar(e: FormEvent) {
    e.preventDefault();
    await cargar();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Productos</h2>
        <button className="btn" onClick={() => setMostrarFormulario((v) => !v)}>
          {mostrarFormulario ? "Cerrar" : "+ Nuevo producto"}
        </button>
      </div>

      {error && <div className="mensaje-error">{error}</div>}

      {mostrarFormulario && (
        <FormularioProducto
          unidades={unidades}
          onCreado={async () => {
            setMostrarFormulario(false);
            await cargar();
          }}
          onError={setError}
        />
      )}

      <form onSubmit={onBuscar} className="tarjeta" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <input placeholder="Buscar por código, nombre o código de barras" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <SelectFiltro etiqueta="Grupo" valor={filtroGrupo} opciones={opcionesFiltro.grupo} onCambiar={(v) => { setFiltroGrupo(v); }} />
        <SelectFiltro etiqueta="Condición" valor={filtroCondicion} opciones={opcionesFiltro.condicion} onCambiar={(v) => { setFiltroCondicion(v); }} />
        <SelectFiltro etiqueta="Status" valor={filtroStatus} opciones={opcionesFiltro.status} onCambiar={(v) => { setFiltroStatus(v); }} />
        <SelectFiltro etiqueta="Sub Status" valor={filtroSubStatus} opciones={opcionesFiltro.subStatus} onCambiar={(v) => { setFiltroSubStatus(v); }} />
        <SelectFiltro etiqueta="Grade" valor={filtroGrade} opciones={opcionesFiltro.grade} onCambiar={(v) => { setFiltroGrade(v); }} />
        <button className="btn btn-secundario" type="submit">Buscar</button>
      </form>
      <p style={{ margin: "-10px 0 0", fontSize: 13, color: "var(--texto-suave)" }}>
        Los filtros de Grupo, Condición, Status, Sub Status y Grade se aplican sobre la última llegada
        registrada de cada producto (carga "Llegada de productos").
      </p>

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Nombre</th><th>Unidad base</th><th>Lote</th><th>Serie</th><th>Vencimiento</th>
              <th>Valorización</th><th>Grupo</th><th>Condición</th><th>Status</th><th>Sub Status</th><th>Grade</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id}>
                <td>{p.codigo}</td>
                <td>{p.nombre}</td>
                <td>{p.unidadBase?.codigo}</td>
                <td>{p.controlLote ? "Sí" : "No"}</td>
                <td>{p.controlSerie ? "Sí" : "No"}</td>
                <td>{p.controlVencimiento ? "Sí" : "No"}</td>
                <td>{p.metodoValorizacion}</td>
                <td>{p.ultimaLlegada?.grupo ?? "—"}</td>
                <td>{p.ultimaLlegada?.condicion ?? "—"}</td>
                <td>{p.ultimaLlegada?.status ?? "—"}</td>
                <td>{p.ultimaLlegada?.subStatus ?? "—"}</td>
                <td>{p.ultimaLlegada?.grade ?? "—"}</td>
                <td><span className={`badge ${p.activo ? "badge-ok" : "badge-pendiente"}`}>{p.activo ? "Activo" : "Inactivo"}</span></td>
              </tr>
            ))}
            {productos.length === 0 && <tr><td colSpan={13} style={{ color: "var(--texto-suave)" }}>Sin resultados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectFiltro({ etiqueta, valor, opciones, onCambiar }: { etiqueta: string; valor: string; opciones: string[]; onCambiar: (v: string) => void }) {
  return (
    <select value={valor} onChange={(e) => onCambiar(e.target.value)} style={{ minWidth: 130 }}>
      <option value="">{etiqueta} (todos)</option>
      {opciones.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function FormularioProducto({ unidades, onCreado, onError }: { unidades: UnidadMedida[]; onCreado: () => void; onError: (m: string) => void }) {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [unidadBaseId, setUnidadBaseId] = useState(unidades[0]?.id ?? "");
  const [controlLote, setControlLote] = useState(false);
  const [controlVencimiento, setControlVencimiento] = useState(false);
  const [controlSerie, setControlSerie] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    onError("");
    try {
      await api.post("/productos", { codigo, nombre, unidadBaseId, controlLote, controlVencimiento, controlSerie });
      onCreado();
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo crear el producto");
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta grid-form">
      <label>
        <span className="etiqueta">Código interno *</span>
        <input required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
      </label>
      <label>
        <span className="etiqueta">Nombre *</span>
        <input required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      <label>
        <span className="etiqueta">Unidad base *</span>
        <select required value={unidadBaseId} onChange={(e) => setUnidadBaseId(e.target.value)}>
          <option value="" disabled>Seleccione...</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>{u.codigo} — {u.nombre}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
        <input type="checkbox" checked={controlLote} onChange={(e) => setControlLote(e.target.checked)} /> Controla lote
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
        <input type="checkbox" checked={controlVencimiento} onChange={(e) => setControlVencimiento(e.target.checked)} /> Controla vencimiento
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
        <input type="checkbox" checked={controlSerie} onChange={(e) => setControlSerie(e.target.checked)} /> Controla serie
      </label>
      <div style={{ gridColumn: "1 / -1" }}>
        <button className="btn" type="submit">Guardar producto</button>
      </div>
    </form>
  );
}
