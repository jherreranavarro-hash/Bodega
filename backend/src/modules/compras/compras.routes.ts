import { Router } from "express";
import { z } from "zod";
import { EstadoDocumentoCompra } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { contabilizarRecepcion } from "../recepciones/recepcion.service.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import {
  crearSolicitudCompra,
  generarSolicitudDesdeReposicion,
  aprobarSolicitudCompra,
  rechazarSolicitudCompra,
  convertirEnOrdenCompra,
} from "./solicitud-compra.service.js";

export const comprasRouter = Router();
comprasRouter.use(requiereAutenticacion);

const solicitudDetalleSchema = z.object({
  productoId: z.string().uuid(),
  cantidad: z.number().positive(),
  unidadId: z.string().uuid(),
  bodegaDestinoId: z.string().uuid(),
  fechaRequerida: z.coerce.date().optional(),
});

const solicitudCompraSchema = z.object({
  folio: z.string().min(1),
  proveedorSugeridoId: z.string().uuid().optional(),
  detalle: z.array(solicitudDetalleSchema).min(1),
});

// Toda solicitud nace PENDIENTE_APROBACION: nunca se crea ya aprobada.
comprasRouter.post("/solicitudes", requierePermiso("compras", "crear"), async (req, res) => {
  const parsed = solicitudCompraSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const solicitud = await crearSolicitudCompra({
      empresaId: req.usuario!.empresaId,
      solicitanteId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "solicitudes_compra.crear",
      entidad: "solicitudes_compra",
      entidadId: solicitud.id,
      resultado: "OK",
    });
    res.status(201).json(solicitud);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

const desdeReposicionSchema = z.object({ productoId: z.string().uuid(), bodegaId: z.string().uuid(), folio: z.string().min(1) });

// Propone una solicitud desde el indicador de reposición: respeta mínimos y múltiplos de compra.
comprasRouter.post("/solicitudes/desde-reposicion", requierePermiso("compras", "crear"), async (req, res) => {
  const parsed = desdeReposicionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const solicitud = await generarSolicitudDesdeReposicion({ ...parsed.data, solicitanteId: req.usuario!.usuarioId });
    res.status(201).json(solicitud);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

comprasRouter.get("/solicitudes", requierePermiso("compras", "consultar"), async (req, res) => {
  const solicitudes = await prisma.solicitudCompra.findMany({
    where: { empresaId: req.usuario!.empresaId },
    include: { detalle: true, ordenesCompra: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(solicitudes);
});

// Separación de funciones: quien solicita la compra no puede aprobarla ni rechazarla.
comprasRouter.post("/solicitudes/:id/aprobar", requierePermiso("compras", "aprobar"), async (req, res) => {
  try {
    const solicitud = await aprobarSolicitudCompra(req.params.id, req.usuario!.usuarioId);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "solicitudes_compra.aprobar",
      entidad: "solicitudes_compra",
      entidadId: solicitud.id,
      resultado: "OK",
    });
    res.json(solicitud);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

comprasRouter.post("/solicitudes/:id/rechazar", requierePermiso("compras", "aprobar"), async (req, res) => {
  try {
    const solicitud = await rechazarSolicitudCompra(req.params.id, req.usuario!.usuarioId);
    res.json(solicitud);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

const conversionSchema = z.object({
  folioOrdenCompra: z.string().min(1),
  proveedorId: z.string().uuid(),
  fechaCompromisoOriginal: z.coerce.date().optional(),
  costos: z.array(z.object({ solicitudDetalleId: z.string().uuid(), costoUnitarioPactado: z.number().nonnegative() })).min(1),
});

comprasRouter.post("/solicitudes/:id/convertir-orden", requierePermiso("compras", "crear"), async (req, res) => {
  const parsed = conversionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const orden = await convertirEnOrdenCompra({ solicitudId: req.params.id, ...parsed.data });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "solicitudes_compra.convertir_orden",
      entidad: "ordenes_compra",
      entidadId: orden.id,
      resultado: "OK",
    });
    res.status(201).json(orden);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

const ocDetalleSchema = z.object({
  productoId: z.string().uuid(),
  unidadId: z.string().uuid(),
  cantidadPedida: z.number().positive(),
  costoUnitarioPactado: z.number().nonnegative(),
});

const ocSchema = z.object({
  folio: z.string().min(1),
  proveedorId: z.string().uuid(),
  solicitudCompraId: z.string().uuid().optional(),
  fechaCompromisoOriginal: z.coerce.date().optional(),
  detalle: z.array(ocDetalleSchema).min(1),
});

comprasRouter.get("/ordenes", requierePermiso("compras", "consultar"), async (req, res) => {
  const ordenes = await prisma.ordenCompra.findMany({
    where: { empresaId: req.usuario!.empresaId },
    include: { detalle: true, proveedor: true },
    orderBy: { creadoEn: "desc" },
  });
  res.json(ordenes);
});

comprasRouter.post("/ordenes", requierePermiso("compras", "crear"), async (req, res) => {
  const parsed = ocSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const orden = await prisma.ordenCompra.create({
    data: {
      empresaId: req.usuario!.empresaId,
      folio: parsed.data.folio,
      proveedorId: parsed.data.proveedorId,
      solicitudCompraId: parsed.data.solicitudCompraId,
      estado: EstadoDocumentoCompra.APROBADA,
      fechaCompromisoOriginal: parsed.data.fechaCompromisoOriginal,
      fechaCompromisoActual: parsed.data.fechaCompromisoOriginal,
      aprobadaPorId: req.usuario!.usuarioId,
      detalle: { create: parsed.data.detalle },
    },
    include: { detalle: true },
  });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "ordenes_compra.crear",
    entidad: "ordenes_compra",
    entidadId: orden.id,
    resultado: "OK",
  });
  res.status(201).json(orden);
});

// Reprograma la fecha comprometida SIN perder la fecha original (trazabilidad de cumplimiento).
comprasRouter.post("/ordenes/:id/reprogramar", requierePermiso("compras", "modificar"), async (req, res) => {
  const schema = z.object({ nuevaFecha: z.coerce.date() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const orden = await prisma.ordenCompra.update({
    where: { id: req.params.id },
    data: { fechaCompromisoActual: parsed.data.nuevaFecha },
  });
  res.json(orden);
});

const recepcionSchema = z.object({
  folio: z.string().min(1),
  bodegaId: z.string().uuid(),
  ordenCompraId: z.string().uuid().optional(),
  fechaEfectiva: z.coerce.date().default(() => new Date()),
  detalle: z
    .array(
      z.object({
        ordenCompraDetalleId: z.string().uuid().optional(),
        productoId: z.string().uuid(),
        ubicacionDestinoId: z.string().uuid(),
        loteCodigo: z.string().optional(),
        fechaVencimiento: z.coerce.date().optional(),
        cantidadRecibida: z.number().positive(),
        cantidadAceptada: z.number().nonnegative(),
        cantidadRechazada: z.number().nonnegative().optional(),
        costoUnitario: z.number().nonnegative(),
        motivoRechazoId: z.string().uuid().optional(),
      })
    )
    .min(1),
});

comprasRouter.post("/recepciones", requierePermiso("recepciones", "crear"), async (req, res) => {
  const parsed = recepcionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const recepcion = await contabilizarRecepcion({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      ...parsed.data,
    });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "recepciones.contabilizar",
      entidad: "recepciones",
      entidadId: recepcion.id,
      resultado: "OK",
    });
    res.status(201).json(recepcion);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

comprasRouter.get("/recepciones/:id", requierePermiso("recepciones", "consultar"), async (req, res) => {
  const recepcion = await prisma.recepcion.findUnique({ where: { id: req.params.id }, include: { detalle: true } });
  if (!recepcion) return res.status(404).json({ error: "Recepción no encontrada" });
  res.json(recepcion);
});
