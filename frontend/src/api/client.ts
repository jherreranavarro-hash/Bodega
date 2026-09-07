const TOKEN_KEY = "bodega_token";

export function obtenerToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function guardarToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function borrarToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ErrorApi extends Error {
  status: number;
  detalle: unknown;
  constructor(status: number, mensaje: string, detalle?: unknown) {
    super(mensaje);
    this.status = status;
    this.detalle = detalle;
  }
}

async function solicitud<T>(metodo: string, ruta: string, cuerpo?: unknown, opciones?: { formData?: FormData }): Promise<T> {
  const headers: Record<string, string> = {};
  const token = obtenerToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opciones?.formData) {
    body = opciones.formData;
  } else if (cuerpo !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(cuerpo);
  }

  const respuesta = await fetch(`/api${ruta}`, { method: metodo, headers, body });
  const contentType = respuesta.headers.get("content-type") ?? "";
  const datos = contentType.includes("application/json") ? await respuesta.json() : await respuesta.text();

  if (!respuesta.ok) {
    const mensaje = typeof datos === "object" && datos && "error" in datos ? String((datos as { error: unknown }).error) : "Error inesperado";
    throw new ErrorApi(respuesta.status, mensaje, datos);
  }
  return datos as T;
}

export const api = {
  get: <T>(ruta: string) => solicitud<T>("GET", ruta),
  post: <T>(ruta: string, cuerpo?: unknown) => solicitud<T>("POST", ruta, cuerpo),
  put: <T>(ruta: string, cuerpo?: unknown) => solicitud<T>("PUT", ruta, cuerpo),
  del: <T>(ruta: string) => solicitud<T>("DELETE", ruta),
  postForm: <T>(ruta: string, formData: FormData) => solicitud<T>("POST", ruta, undefined, { formData }),
};
