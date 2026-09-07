import { useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi, obtenerToken } from "../api/client";

interface CargaDatos {
  id: string;
  nombreArchivo: string;
  modo: string;
  estado: string;
  totalFilas: number;
  filasCrear: number;
  filasActualizar: number;
  filasRechazar: number;
  filasSinCambio: number;
  plantilla: { entidad: string };
  creadoEn: string;
}

const ENTIDADES = ["PRODUCTOS", "INVENTARIO_INICIAL"];
const MODOS = [
  ["CREACION_Y_ACTUALIZACION", "Creación y actualización"],
  ["SOLO_CREACION", "Solo creación"],
  ["SOLO_ACTUALIZACION", "Solo actualización"],
  ["VALIDACION_SIN_APLICAR", "Solo validar (no aplica)"],
];

export function Cargas() {
  const [cargas, setCargas] = useState<CargaDatos[]>([]);
  const [entidad, setEntidad] = useState(ENTIDADES[0]);
  const [modo, setModo] = useState(MODOS[0][0]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargarLista() {
    setCargas(await api.get<CargaDatos[]>("/cargas"));
  }

  useEffect(() => {
    cargarLista();
  }, []);

  async function onSubirArchivo(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!archivo) return setError("Debe seleccionar un archivo .csv");
    const formData = new FormData();
    formData.append("archivo", archivo);
    formData.append("entidad", entidad);
    formData.append("modo", modo);
    try {
      await api.postForm("/cargas", formData);
      setMensaje("Archivo recibido en el área de preparación. Valide y simule antes de aprobar.");
      setArchivo(null);
      await cargarLista();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo recibir el archivo");
    }
  }

  async function accion(id: string, ruta: "validar" | "aprobar" | "ejecutar") {
    setError(null);
    try {
      await api.post(`/cargas/${id}/${ruta}`);
      await cargarLista();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "La operación no se pudo completar");
    }
  }

  function descargarErrores(id: string) {
    const token = obtenerToken();
    fetch(`/api/cargas/${id}/errores.csv`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `errores-${id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Centro de cargas de datos</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Sube un archivo CSV, valida y simula el resultado, y solo después de aprobarlo se ejecuta contra los datos operativos.
        Subir un archivo nunca modifica datos por sí solo.
      </p>

      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <form onSubmit={onSubirArchivo} className="tarjeta grid-form">
        <label>
          <span className="etiqueta">Entidad</span>
          <select value={entidad} onChange={(e) => setEntidad(e.target.value)}>
            {ENTIDADES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label>
          <span className="etiqueta">Modo de carga</span>
          <select value={modo} onChange={(e) => setModo(e.target.value)}>
            {MODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="etiqueta">Archivo CSV</span>
          <input type="file" accept=".csv,.txt" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        </label>
        <div style={{ alignSelf: "end" }}>
          <button className="btn" type="submit">Subir a preparación</button>
        </div>
      </form>

      <div className="tarjeta">
        <table>
          <thead>
            <tr><th>Archivo</th><th>Entidad</th><th>Modo</th><th>Estado</th><th>Crear</th><th>Actualizar</th><th>Rechazar</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {cargas.map((c) => (
              <tr key={c.id}>
                <td>{c.nombreArchivo}</td>
                <td>{c.plantilla.entidad}</td>
                <td>{c.modo}</td>
                <td><EstadoBadge estado={c.estado} /></td>
                <td>{c.filasCrear}</td>
                <td>{c.filasActualizar}</td>
                <td>{c.filasRechazar}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {c.estado === "RECIBIDA" && <button className="btn btn-secundario" onClick={() => accion(c.id, "validar")}>Validar y simular</button>}
                  {c.estado === "VALIDADA_CON_ERRORES" && <button className="btn btn-secundario" onClick={() => descargarErrores(c.id)}>Descargar errores</button>}
                  {c.estado === "SIMULADA" && <button className="btn" onClick={() => accion(c.id, "aprobar")}>Aprobar</button>}
                  {c.estado === "APROBADA" && <button className="btn" onClick={() => accion(c.id, "ejecutar")}>Ejecutar</button>}
                  {c.estado === "EJECUTADA" && <span className="badge badge-ok">Completada</span>}
                </td>
              </tr>
            ))}
            {cargas.length === 0 && <tr><td colSpan={8} style={{ color: "var(--texto-suave)" }}>Sin cargas registradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const clase = estado === "EJECUTADA" ? "badge-ok" : estado === "VALIDADA_CON_ERRORES" || estado === "RECHAZADA" ? "badge-alerta" : "badge-pendiente";
  return <span className={`badge ${clase}`}>{estado.replaceAll("_", " ")}</span>;
}
