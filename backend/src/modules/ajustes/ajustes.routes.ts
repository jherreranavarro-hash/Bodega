import { Router } from "express";
import { z } from "zod";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { planificarConteo, registrarConteoFisico, generarAjusteDesdeConteo, aprobarAjuste, rechazarAjuste } from "./ajuste.service.js";
import { prisma } from "../../lib/prisma.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";

export const ajustesRouter = Router();
ajustesRouter.use(requiereAutenticacion);

const conteoSchema = z.object({
  folio: z.string().min(1),
  bodegaId: z.string().uuid(),
  tipo: z.enum(["GENERAL", "CICLICO"]),
  conteoCiego: z.boolean().default(true),
  fechaCorte: z.coerce.date(),
  lineas: z.array(z.object({ productoId: z.string().uuid(), ubicacionId: z.string().uuid(), loteId: z.string().uuid().optional(), serieId: z.string().uuid().optional() })).min(1),
});

ajustesRouter.post("/conteos", requierePermiso("conteos", "crear"), async (req, res) => {
  const parsed = conteoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const conteo = await planificarConteo({ ...parsed.data, responsableId: req.usuario!.usuarioId });
  res.status(201).json(conteo);
});

ajustesRouter.get("/conteos/:id", requierePermiso("conteos", "consultar"), async (req, res) => {
  const conteo = await prisma.conteo.findUnique({ where: { id: req.params.id }, include: { detalle: true } });
  if (!conteo) return res.status(404).json({ error: "Conteo no encontrado" });
  // Conteo ciego: no se expone cantidadEsperada mientras el conteo está en proceso.
  if (conteo.conteoCiego && conteo.estado === "EN_PROCESO") {
    return res.json({ ...conteo, detalle: conteo.detalle.map(({ cantidadEsperada: _oculto, ...resto }) => resto) });
  }
  res.json(conteo);
});

ajustesRouter.post("/conteos/detalle/:detalleId/registrar", requierePermiso("conteos", "ejecutar"), async (req, res) => {
  const schema = z.object({ cantidadContada: z.number().nonnegative() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const detalle = await registrarConteoFisico(req.params.detalleId, parsed.data.cantidadContada);
  res.json(detalle);
});

ajustesRouter.get("/ajustes", requierePermiso("ajustes", "consultar"), async (req, res) => {
  const ajustes = await prisma.ajuste.findMany({
    where: { bodega: { empresaId: req.usuario!.empresaId } },
    include: { detalle: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(ajustes);
});

const generarAjusteSchema = z.object({ conteoId: z.string().uuid(), motivoId: z.string().uuid(), folio: z.string().min(1), evidenciaUrl: z.string().optional() });

ajustesRouter.post("/ajustes/desde-conteo", requierePermiso("ajustes", "crear"), async (req, res) => {
  const parsed = generarAjusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const ajuste = await generarAjusteDesdeConteo({ ...parsed.data, solicitadoPorId: req.usuario!.usuarioId });
    res.status(201).json(ajuste);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

// Separación de funciones: quien solicitó el ajuste no debería aprobarlo.
ajustesRouter.post("/ajustes/:id/aprobar", requierePermiso("ajustes", "aprobar"), async (req, res) => {
  const ajuste = await prisma.ajuste.findUnique({ where: { id: req.params.id } });
  if (ajuste && ajuste.solicitadoPorId === req.usuario!.usuarioId) {
    return res.status(403).json({ error: "Quien solicita un ajuste no puede aprobarlo" });
  }
  try {
    const resultado = await aprobarAjuste(req.params.id, req.usuario!.empresaId, req.usuario!.usuarioId);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "ajustes.aprobar",
      entidad: "ajustes",
      entidadId: resultado.id,
      resultado: "OK",
    });
    res.json(resultado);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

ajustesRouter.post("/ajustes/:id/rechazar", requierePermiso("ajustes", "aprobar"), async (req, res) => {
  const resultado = await rechazarAjuste(req.params.id, req.usuario!.usuarioId);
  res.json(resultado);
});
