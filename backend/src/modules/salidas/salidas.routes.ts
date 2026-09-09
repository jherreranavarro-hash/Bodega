import { Router } from "express";
import { z } from "zod";
import { EstadoSolicitudSalida } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { crearReserva } from "../inventario/inventario.service.js";
import { contabilizarDespacho } from "../despachos/despacho.service.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import { registrarDemandaSolicitada } from "../analitica/demanda.service.js";

export const salidasRouter = Router();
salidasRouter.use(requiereAutenticacion);

const solicitudSchema = z.object({
  folio: z.string().min(1),
  bodegaId: z.string().uuid(),
  tipoDestino: z.enum(["AREA_INTERNA", "CLIENTE"]),
  areaId: z.string().uuid().optional(),
  centroCostoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  prioridad: z.enum(["ALTA", "NORMAL", "BAJA"]).default("NORMAL"),
  fechaRequerida: z.coerce.date().optional(),
  detalle: z.array(z.object({ productoId: z.string().uuid(), cantidadSolicitada: z.number().positive() })).min(1),
});

salidasRouter.post("/solicitudes", requierePermiso("solicitudes_salida", "crear"), async (req, res) => {
  const parsed = solicitudSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const solicitud = await prisma.solicitudSalida.create({
    data: {
      empresaId: req.usuario!.empresaId,
      folio: parsed.data.folio,
      bodegaId: parsed.data.bodegaId,
      tipoDestino: parsed.data.tipoDestino,
      areaId: parsed.data.areaId,
      centroCostoId: parsed.data.centroCostoId,
      clienteId: parsed.data.clienteId,
      prioridad: parsed.data.prioridad,
      fechaRequerida: parsed.data.fechaRequerida,
      estado: EstadoSolicitudSalida.APROBADA,
      solicitanteId: req.usuario!.usuarioId,
      detalle: { create: parsed.data.detalle },
    },
    include: { detalle: true },
  });

  const fechaDemanda = new Date();
  await Promise.all(
    solicitud.detalle.map((d) =>
      registrarDemandaSolicitada(prisma, { productoId: d.productoId, bodegaId: solicitud.bodegaId, fecha: fechaDemanda, cantidad: d.cantidadSolicitada })
    )
  );

  res.status(201).json(solicitud);
});

salidasRouter.get("/solicitudes", requierePermiso("solicitudes_salida", "consultar"), async (req, res) => {
  const solicitudes = await prisma.solicitudSalida.findMany({
    where: { empresaId: req.usuario!.empresaId },
    include: { detalle: true, reservas: { include: { detalle: true } } },
    orderBy: { creadoEn: "desc" },
  });
  res.json(solicitudes);
});

const reservaSchema = z.object({
  solicitudDetalleId: z.string().uuid(),
  productoId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  cantidad: z.number().positive(),
  priorizarVencimiento: z.boolean().optional(),
});

// Crea una reserva (compromiso) sobre stock DISPONIBLE. No es una salida física.
salidasRouter.post("/reservas", requierePermiso("reservas", "crear"), async (req, res) => {
  const parsed = reservaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const reserva = await prisma.$transaction((tx) => crearReserva(tx, parsed.data));
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "reservas.crear",
      entidad: "reservas",
      entidadId: reserva.id,
      resultado: "OK",
    });
    res.status(201).json(reserva);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

const despachoSchema = z.object({
  folio: z.string().min(1),
  bodegaId: z.string().uuid(),
  preparacionId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  transportistaId: z.string().uuid().optional(),
  referenciaComercial: z.string().optional(),
  fechaEfectiva: z.coerce.date().default(() => new Date()),
  detalle: z
    .array(
      z.object({
        productoId: z.string().uuid(),
        reservaDetalleId: z.string().uuid().optional(),
        ubicacionOrigenId: z.string().uuid().optional(),
        cantidad: z.number().positive(),
      })
    )
    .min(1),
});

salidasRouter.post("/despachos", requierePermiso("despachos", "ejecutar"), async (req, res) => {
  const parsed = despachoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const despacho = await contabilizarDespacho({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "despachos.contabilizar",
      entidad: "despachos",
      entidadId: despacho.id,
      resultado: "OK",
    });
    res.status(201).json(despacho);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
