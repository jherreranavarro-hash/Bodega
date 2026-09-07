import { Router } from "express";
import { z } from "zod";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { despacharTransferencia, recibirTransferencia } from "./transferencia.service.js";
import { prisma } from "../../lib/prisma.js";

export const transferenciasRouter = Router();
transferenciasRouter.use(requiereAutenticacion);

const crearSchema = z.object({
  folio: z.string().min(1),
  bodegaOrigenId: z.string().uuid(),
  bodegaDestinoId: z.string().uuid(),
  transportistaId: z.string().uuid().optional(),
  fechaEfectiva: z.coerce.date().default(() => new Date()),
  detalle: z.array(z.object({ productoId: z.string().uuid(), ubicacionOrigenId: z.string().uuid(), cantidad: z.number().positive() })).min(1),
});

transferenciasRouter.post("/", requierePermiso("transferencias", "ejecutar"), async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const transferencia = await despacharTransferencia({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    res.status(201).json(transferencia);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

transferenciasRouter.get("/", requierePermiso("transferencias", "consultar"), async (req, res) => {
  const transferencias = await prisma.transferencia.findMany({
    where: { bodegaOrigen: { empresaId: req.usuario!.empresaId } },
    include: { detalle: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(transferencias);
});

const recepcionSchema = z.object({
  fechaEfectiva: z.coerce.date().default(() => new Date()),
  detalle: z.array(z.object({ transferenciaDetalleId: z.string().uuid(), productoId: z.string().uuid(), cantidad: z.number().positive(), ubicacionDestinoId: z.string().uuid() })).min(1),
});

transferenciasRouter.post("/:id/recibir", requierePermiso("transferencias", "ejecutar"), async (req, res) => {
  const parsed = recepcionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const transferencia = await recibirTransferencia({
      transferenciaId: req.params.id,
      usuarioId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    res.json(transferencia);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
