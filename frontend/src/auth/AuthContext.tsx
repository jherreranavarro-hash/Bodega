import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { api, guardarToken, borrarToken, obtenerToken } from "../api/client";

export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  empresaId: string;
}

interface RespuestaLogin {
  token: string;
  usuario: UsuarioSesion;
}

interface AuthContextValor {
  usuario: UsuarioSesion | null;
  autenticado: boolean;
  ingresar: (email: string, password: string) => Promise<void>;
  salir: () => void;
}

const AuthContext = createContext<AuthContextValor | undefined>(undefined);

const USUARIO_KEY = "bodega_usuario";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(() => {
    const guardado = localStorage.getItem(USUARIO_KEY);
    return guardado && obtenerToken() ? (JSON.parse(guardado) as UsuarioSesion) : null;
  });

  const ingresar = useCallback(async (email: string, password: string) => {
    const respuesta = await api.post<RespuestaLogin>("/auth/login", { email, password });
    guardarToken(respuesta.token);
    localStorage.setItem(USUARIO_KEY, JSON.stringify(respuesta.usuario));
    setUsuario(respuesta.usuario);
  }, []);

  const salir = useCallback(() => {
    borrarToken();
    localStorage.removeItem(USUARIO_KEY);
    setUsuario(null);
  }, []);

  return <AuthContext.Provider value={{ usuario, autenticado: !!usuario, ingresar, salir }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValor {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
