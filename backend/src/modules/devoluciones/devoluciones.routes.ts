import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import { registrarIngresoDevolucion, resolverDevolucionDetalle } from "./devolucion.service.js";

export const devolucionesRouter = Router();
devolucionesRouter.use(requiereAutenticacion);

const crearSchema = z.object({
  folio: z.string().min(1),
  bodegaId: z.string().uuid(),
  motivoId: z.string().uuid(),
  despachoOrigenId: z.string().uuid().optional(),
  fechaEfectiva: z.coerce.date().default(() => new Date()),
  detalle: z
    .array(z.object({ productoId: z.string().uuid(), cantidad: z.number().positive(), loteId: z.string().uuid().optional(), serieId: z.string().uuid().optional() }))
    .min(1),
});

devolucionesRouter.post("/", requierePermiso("devoluciones", "crear"), async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const devolucion = await registrarIngresoDevolucion({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "devoluciones.crear",
      entidad: "devoluciones",
      entidadId: devolucion.id,
      resultado: "OK",
    });
    res.status(201).json(devolucion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

devolucionesRouter.get("/", requierePermiso("devoluciones", "consultar"), async (req, res) => {
  const devoluciones = await prisma.devolucion.findMany({
    where: { bodega: { empresaId: req.usuario!.empresaId } },
    include: { detalle: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(devoluciones);
});

devolucionesRouter.get("/:id", requierePermiso("devoluciones", "consultar"), async (req, res) => {
  const devolucion = await prisma.devolucion.findFirst({
    where: { id: req.params.id, bodega: { empresaId: req.usuario!.empresaId } },
    include: { detalle: true },
  });
  if (!devolucion) return res.status(404).json({ error: "Devolución no encontrada" });
  res.json(devolucion);
});

const resolverSchema = z.object({
  resolucion: z.enum(["REINGRESO_DISPONIBLE", "CUARENTENA", "BAJA"]),
  fechaEfectiva: z.coerce.date().default(() => new Date()),
  ubicacionDestinoId: z.string().uuid().optional(),
  motivoResolucionId: z.string().uuid().optional(),
  evidenciaUrl: z.string().optional(),
});

devolucionesRouter.post("/detalle/:detalleId/resolver", requierePermiso("devoluciones", "ejecutar"), async (req, res) => {
  const parsed = resolverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const detalle = await resolverDevolucionDetalle({
      detalleId: req.params.detalleId,
      resueltoPorId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "devoluciones.resolver",
      entidad: "devoluciones_detalle",
      entidadId: detalle.id,
      resultado: "OK",
    });
    res.json(detalle);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
