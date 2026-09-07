import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Productos } from "./pages/Productos";
import { Bodegas } from "./pages/Bodegas";
import { Cargas } from "./pages/Cargas";
import { Compras } from "./pages/Compras";
import { Salidas } from "./pages/Salidas";
import { Transferencias } from "./pages/Transferencias";
import { Ajustes } from "./pages/Ajustes";

function RutaProtegida({ children }: { children: React.ReactNode }) {
  const { autenticado } = useAuth();
  return autenticado ? <>{children}</> : <Navigate to="/login" replace />;
}

function Rutas() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RutaProtegida>
            <Layout />
          </RutaProtegida>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/productos" element={<Productos />} />
        <Route path="/bodegas" element={<Bodegas />} />
        <Route path="/cargas" element={<Cargas />} />
        <Route path="/compras" element={<Compras />} />
        <Route path="/salidas" element={<Salidas />} />
        <Route path="/transferencias" element={<Transferencias />} />
        <Route path="/ajustes" element={<Ajustes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Rutas />
    </AuthProvider>
  );
}
