import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const ENLACES = [
  { ruta: "/", etiqueta: "Tablero" },
  { ruta: "/alertas", etiqueta: "Centro de Decisiones" },
  { ruta: "/productos", etiqueta: "Productos" },
  { ruta: "/bodegas", etiqueta: "Bodegas y Ubicaciones" },
  { ruta: "/cargas", etiqueta: "Centro de Cargas" },
  { ruta: "/compras", etiqueta: "Compras y Recepción" },
  { ruta: "/salidas", etiqueta: "Solicitudes, Reservas y Despacho" },
  { ruta: "/transferencias", etiqueta: "Transferencias" },
  { ruta: "/devoluciones", etiqueta: "Devoluciones" },
  { ruta: "/ajustes", etiqueta: "Conteos y Ajustes" },
];

export function Layout() {
  const { usuario, salir } = useAuth();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: 250, background: "#101828", color: "#fff", padding: "18px 14px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>Bodega Demo</div>
        <div style={{ fontSize: "0.75rem", color: "#9aa4b2", marginBottom: 20 }}>Sistema de Bodega e Inventario</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {ENLACES.map((e) => (
            <NavLink
              key={e.ruta}
              to={e.ruta}
              end={e.ruta === "/"}
              style={({ isActive }) => ({
                padding: "9px 10px",
                borderRadius: 6,
                color: isActive ? "#fff" : "#c2c9d6",
                background: isActive ? "#1d4ed8" : "transparent",
                textDecoration: "none",
                fontSize: "0.88rem",
              })}
            >
              {e.etiqueta}
            </NavLink>
          ))}
        </nav>
        <div style={{ borderTop: "1px solid #22304a", paddingTop: 12, fontSize: "0.82rem" }}>
          <div style={{ fontWeight: 600 }}>{usuario?.nombre}</div>
          <div style={{ color: "#9aa4b2" }}>{usuario?.rol}</div>
          <button className="btn btn-secundario" style={{ marginTop: 8, width: "100%", background: "transparent", color: "#fff", borderColor: "#3a4a66" }} onClick={salir}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: "24px 28px", maxWidth: 1200 }}>
        <Outlet />
      </main>
    </div>
  );
}
