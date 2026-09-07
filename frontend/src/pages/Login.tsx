import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorApi } from "../api/client";

export function Login() {
  const { ingresar } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@bodegademo.cl");
  const [password, setPassword] = useState("Demo1234!");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await ingresar(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo iniciar sesión");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#101828" }}>
      <form onSubmit={onSubmit} className="tarjeta" style={{ width: 360, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Bodega Demo</h2>
          <p style={{ margin: "4px 0 0", color: "var(--texto-suave)", fontSize: "0.85rem" }}>
            Sistema Integral de Bodega, Inventario y Toma de Decisiones
          </p>
        </div>
        {error && <div className="mensaje-error">{error}</div>}
        <label>
          <span className="etiqueta">Correo electrónico</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <span className="etiqueta">Contraseña</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button className="btn" type="submit" disabled={cargando}>
          {cargando ? "Ingresando..." : "Ingresar"}
        </button>
        <p style={{ fontSize: "0.75rem", color: "var(--texto-suave)" }}>
          Usuarios demo: admin@bodegademo.cl · jefe.bodega@bodegademo.cl · operador@bodegademo.cl (contraseña Demo1234!)
        </p>
      </form>
    </div>
  );
}
