import { Fragment, useEffect, useState } from "react";
import { api, ErrorApi } from "../api/client";

interface Permiso {
  id: string;
  recurso: string;
  accion: string;
}
interface Rol {
  id: string;
  codigo: string;
  nombre: string;
  permisos: Permiso[];
}
interface Usuario {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  rolId: string;
  rolCodigo: string;
}

export function Administracion() {
  const [roles, setRoles] = useState<Rol[]>([]);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargar() {
    setRoles(await api.get<Rol[]>("/administracion/roles"));
    setPermisos(await api.get<Permiso[]>("/administracion/permisos"));
    setUsuarios(await api.get<Usuario[]>("/administracion/usuarios"));
  }

  useEffect(() => {
    cargar().catch((err) => setError(err instanceof ErrorApi ? err.message : "No se pudo cargar administración"));
  }, []);

  async function alternarPermiso(rol: Rol, permiso: Permiso, otorgado: boolean) {
    setError(null);
    try {
      if (otorgado) {
        await api.post(`/administracion/roles/${rol.id}/permisos`, { permisoId: permiso.id });
      } else {
        await api.del(`/administracion/roles/${rol.id}/permisos/${permiso.id}`);
      }
      setMensaje(`Permiso ${permiso.recurso}.${permiso.accion} ${otorgado ? "otorgado a" : "revocado de"} ${rol.nombre}.`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo actualizar el permiso");
    }
  }

  async function cambiarRol(usuario: Usuario, rolId: string) {
    setError(null);
    try {
      await api.put(`/administracion/usuarios/${usuario.id}/rol`, { rolId });
      setMensaje(`Rol de ${usuario.nombre} actualizado.`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo cambiar el rol");
    }
  }

  const recursos = [...new Set(permisos.map((p) => p.recurso))].sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0 }}>Administración de roles y permisos</h2>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Los roles y permisos son un catálogo compartido: cambiar un permiso aquí afecta a ese rol para todos los
        usuarios que lo tengan asignado. Los permisos se verifican siempre en el servidor, no solo aquí.
      </p>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      <div className="tarjeta" style={{ overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Matriz de permisos por rol</h3>
        <table>
          <thead>
            <tr>
              <th>Recurso</th>
              {roles.map((r) => <th key={r.id}>{r.nombre}</th>)}
            </tr>
          </thead>
          <tbody>
            {recursos.map((recurso) => (
              <Fragment key={recurso}>
                {permisos.filter((p) => p.recurso === recurso).map((permiso, i) => (
                  <tr key={permiso.id}>
                    <td>
                      <strong style={{ opacity: i === 0 ? 1 : 0.35 }}>{recurso}</strong>
                      <span style={{ color: "var(--texto-suave)" }}>.{permiso.accion}</span>
                    </td>
                    {roles.map((rol) => {
                      const otorgado = rol.permisos.some((p) => p.id === permiso.id);
                      return (
                        <td key={rol.id} style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={otorgado}
                            disabled={rol.codigo === "administrador"}
                            title={rol.codigo === "administrador" ? "El administrador siempre tiene todos los permisos" : undefined}
                            onChange={(e) => alternarPermiso(rol, permiso, e.target.checked)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>Usuarios</h3>
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nombre}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.rolId} onChange={(e) => cambiarRol(u, e.target.value)}>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                </td>
                <td><span className={`badge ${u.activo ? "badge-ok" : "badge-pendiente"}`}>{u.activo ? "Activo" : "Inactivo"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
