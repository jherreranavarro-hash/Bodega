import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import {
  generarAlertas,
  aceptarAccion,
  rechazarAccion,
  postergarAccion,
  convertirAccionEnSolicitud,
  descartarAlerta,
} from "./alertas.service.js";

export const alertasRouter = Router();
alertasRouter.use(requiereAutenticacion);

// Generar alertas es una acción explícita (a pedido): nunca crea, ejecuta ni
// aprueba nada por sí sola, solo detecta y propone (sección 12 del encargo).
alertasRouter.post("/generar", requierePermiso("alertas", "ejecutar"), async (req, res) => {
  const alertas = await generarAlertas(req.usuario!.empresaId);
  res.status(201).json(alertas);
});

alertasRouter.get("/", requierePermiso("alertas", "consultar"), async (req, res) => {
  const { estado } = req.query as { estado?: string };
  const alertas = await prisma.alerta.findMany({
    where: { empresaId: req.usuario!.empresaId, estado: estado || undefined },
    include: { accionesRecomendadas: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(alertas);
});

alertasRouter.get("/:id", requierePermiso("alertas", "consultar"), async (req, res) => {
  const alerta = await prisma.alerta.findFirst({
    where: { id: req.params.id, empresaId: req.usuario!.empresaId },
    include: { accionesRecomendadas: true },
  });
  if (!alerta) return res.status(404).json({ error: "Alerta no encontrada" });
  res.json(alerta);
});

alertasRouter.post("/:id/descartar", requierePermiso("alertas", "ejecutar"), async (req, res) => {
  const alerta = await descartarAlerta(req.params.id);
  res.json(alerta);
});

alertasRouter.post("/acciones/:id/aceptar", requierePermiso("alertas", "ejecutar"), async (req, res) => {
  const schema = z.object({ justificacion: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const accion = await aceptarAccion(req.params.id, req.usuario!.usuarioId, parsed.data.justificacion);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "acciones_recomendadas.aceptar",
      entidad: "acciones_recomendadas",
      entidadId: accion.id,
      resultado: "OK",
    });
    res.json(accion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

alertasRouter.post("/acciones/:id/rechazar", requierePermiso("alertas", "ejecutar"), async (req, res) => {
  const schema = z.object({ justificacion: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const accion = await rechazarAccion(req.params.id, parsed.data.justificacion);
    res.json(accion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

alertasRouter.post("/acciones/:id/postergar", requierePermiso("alertas", "ejecutar"), async (req, res) => {
  const schema = z.object({ nuevaFechaObjetivo: z.coerce.date(), justificacion: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const accion = await postergarAccion(req.params.id, parsed.data.nuevaFechaObjetivo, parsed.data.justificacion);
    res.json(accion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

alertasRouter.post("/acciones/:id/convertir-solicitud", requierePermiso("compras", "crear"), async (req, res) => {
  const schema = z.object({ folio: z.string().min(1), justificacion: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const solicitud = await convertirAccionEnSolicitud(req.params.id, req.usuario!.usuarioId, parsed.data.folio, parsed.data.justificacion);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "acciones_recomendadas.convertir_solicitud",
      entidad: "solicitudes_compra",
      entidadId: solicitud.id,
      resultado: "OK",
    });
    res.status(201).json(solicitud);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
