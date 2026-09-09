import { useEffect, useState } from "react";
import { api, ErrorApi } from "../api/client";

interface AccionRecomendada {
  id: string;
  descripcion: string;
  impactoEstimado?: Record<string, unknown> | null;
  estado: string;
  justificacion?: string | null;
  fechaObjetivo?: string | null;
}
interface Alerta {
  id: string;
  tipo: string;
  severidad: string;
  estado: string;
  evidencia: Record<string, unknown>;
  accionesRecomendadas: AccionRecomendada[];
  creadoEn: string;
}

const TIPOS_LEGIBLES: Record<string, string> = {
  BAJO_PUNTO_REPOSICION: "Bajo punto de reposición",
  SOBRESTOCK: "Sobrestock",
  VENCIMIENTO_PROXIMO: "Vencimiento próximo",
};

export function Alertas() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  async function cargar() {
    setAlertas(await api.get<Alerta[]>("/alertas?estado=ABIERTA"));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function generar() {
    setError(null);
    setGenerando(true);
    try {
      const nuevas = await api.post<Alerta[]>("/alertas/generar");
      setMensaje(nuevas.length > 0 ? `${nuevas.length} alerta(s) nueva(s) detectada(s).` : "Sin novedades: no se detectaron nuevas condiciones de alerta.");
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo generar alertas");
    } finally {
      setGenerando(false);
    }
  }

  async function descartar(alertaId: string) {
    try {
      await api.post(`/alertas/${alertaId}/descartar`);
      await cargar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo descartar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Centro de decisiones</h2>
        <button className="btn" onClick={generar} disabled={generando}>{generando ? "Analizando..." : "Detectar alertas ahora"}</button>
      </div>
      <p style={{ marginTop: -10, color: "var(--texto-suave)" }}>
        Cada alerta muestra la evidencia que la sustenta y una acción propuesta. Ninguna recomendación ejecuta compras,
        bajas, transferencias ni ajustes por sí sola: usted decide aceptar, rechazar, postergar o convertirla en una
        solicitud formal.
      </p>
      {error && <div className="mensaje-error">{error}</div>}
      {mensaje && <div className="mensaje-ok">{mensaje}</div>}

      {alertas.map((a) => (
        <div key={a.id} className="tarjeta">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{TIPOS_LEGIBLES[a.tipo] ?? a.tipo}</strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`badge ${a.severidad === "ALTA" ? "badge-alerta" : "badge-pendiente"}`}>{a.severidad}</span>
              <button className="btn btn-secundario" onClick={() => descartar(a.id)}>Descartar alerta</button>
            </div>
          </div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--texto-suave)" }}>Ver evidencia</summary>
            <pre style={{ fontSize: "0.78rem", background: "var(--bg)", padding: 8, borderRadius: 6, overflowX: "auto" }}>
              {JSON.stringify(a.evidencia, null, 2)}
            </pre>
          </details>
          {a.accionesRecomendadas.map((acc) => (
            <AccionCard key={acc.id} accion={acc} tipoAlerta={a.tipo} onResuelta={async (m) => { setMensaje(m); await cargar(); }} onError={setError} />
          ))}
        </div>
      ))}
      {alertas.length === 0 && <p style={{ color: "var(--texto-suave)" }}>Sin alertas abiertas. Use "Detectar alertas ahora" para analizar los indicadores actuales.</p>}
    </div>
  );
}

function AccionCard({
  accion,
  tipoAlerta,
  onResuelta,
  onError,
}: {
  accion: AccionRecomendada;
  tipoAlerta: string;
  onResuelta: (mensaje: string) => void;
  onError: (m: string) => void;
}) {
  const [justificacion, setJustificacion] = useState("");
  const [folioSolicitud, setFolioSolicitud] = useState(`SC-ALERTA-${Date.now()}`);

  async function aceptar() {
    try {
      await api.post(`/alertas/acciones/${accion.id}/aceptar`, { justificacion: justificacion || undefined });
      onResuelta("Recomendación aceptada.");
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo aceptar");
    }
  }
  async function rechazar() {
    if (!justificacion) return onError("Rechazar exige justificación");
    try {
      await api.post(`/alertas/acciones/${accion.id}/rechazar`, { justificacion });
      onResuelta("Recomendación rechazada.");
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo rechazar");
    }
  }
  async function postergar() {
    const nuevaFechaObjetivo = new Date();
    nuevaFechaObjetivo.setDate(nuevaFechaObjetivo.getDate() + 7);
    try {
      await api.post(`/alertas/acciones/${accion.id}/postergar`, { nuevaFechaObjetivo: nuevaFechaObjetivo.toISOString(), justificacion: justificacion || undefined });
      onResuelta("Recomendación postergada 7 días.");
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo postergar");
    }
  }
  async function convertir() {
    try {
      await api.post(`/alertas/acciones/${accion.id}/convertir-solicitud`, { folio: folioSolicitud, justificacion: justificacion || undefined });
      onResuelta("Convertida en solicitud de compra, pendiente de aprobación.");
    } catch (err) {
      onError(err instanceof ErrorApi ? err.message : "No se pudo convertir en solicitud");
    }
  }

  if (accion.estado !== "PROPUESTA") {
    return (
      <div style={{ marginTop: 8, fontSize: "0.85rem" }}>
        {accion.descripcion} — <span className="badge badge-ok">{accion.estado.replaceAll("_", " ")}</span>
        {accion.justificacion && <div style={{ color: "var(--texto-suave)" }}>Justificación: {accion.justificacion}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--borde)", paddingTop: 8 }}>
      <div style={{ fontSize: "0.9rem" }}>{accion.descripcion}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="Justificación (opcional salvo al rechazar)" value={justificacion} onChange={(e) => setJustificacion(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        {tipoAlerta === "BAJO_PUNTO_REPOSICION" && (
          <input value={folioSolicitud} onChange={(e) => setFolioSolicitud(e.target.value)} style={{ width: 160 }} />
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="btn" onClick={aceptar}>Aceptar</button>
        <button className="btn btn-secundario" onClick={rechazar}>Rechazar</button>
        <button className="btn btn-secundario" onClick={postergar}>Postergar 7 días</button>
        {tipoAlerta === "BAJO_PUNTO_REPOSICION" && (
          <button className="btn btn-secundario" onClick={convertir}>Convertir en solicitud de compra</button>
        )}
      </div>
    </div>
  );
}
