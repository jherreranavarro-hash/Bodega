import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { crearPreparacion, registrarVerificacion, marcarPreparacionLista, anularPreparacion } from "./preparacion.service.js";

export const preparacionesRouter = Router();
preparacionesRouter.use(requiereAutenticacion);

const crearSchema = z.object({ folio: z.string().min(1), solicitudId: z.string().uuid() });

preparacionesRouter.post("/", requierePermiso("preparaciones", "crear"), async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const preparacion = await crearPreparacion({ ...parsed.data, responsableId: req.usuario!.usuarioId });
    res.status(201).json(preparacion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

preparacionesRouter.get("/", requierePermiso("preparaciones", "consultar"), async (req, res) => {
  const preparaciones = await prisma.preparacion.findMany({
    where: { solicitud: { empresaId: req.usuario!.empresaId } },
    include: { detalle: true, solicitud: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(preparaciones);
});

preparacionesRouter.get("/:id", requierePermiso("preparaciones", "consultar"), async (req, res) => {
  const preparacion = await prisma.preparacion.findFirst({
    where: { id: req.params.id, solicitud: { empresaId: req.usuario!.empresaId } },
    include: { detalle: true },
  });
  if (!preparacion) return res.status(404).json({ error: "Preparación no encontrada" });
  res.json(preparacion);
});

const verificarSchema = z.object({ cantidadVerificada: z.number().nonnegative() });

preparacionesRouter.post("/detalle/:detalleId/verificar", requierePermiso("preparaciones", "ejecutar"), async (req, res) => {
  const parsed = verificarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const detalle = await registrarVerificacion(req.params.detalleId, parsed.data.cantidadVerificada);
    res.json(detalle);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

preparacionesRouter.post("/:id/marcar-lista", requierePermiso("preparaciones", "ejecutar"), async (req, res) => {
  try {
    const preparacion = await marcarPreparacionLista(req.params.id);
    res.json(preparacion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

preparacionesRouter.post("/:id/anular", requierePermiso("preparaciones", "ejecutar"), async (req, res) => {
  try {
    const preparacion = await anularPreparacion(req.params.id);
    res.json(preparacion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
