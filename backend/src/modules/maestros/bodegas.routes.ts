import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";

export const bodegasRouter = Router();
bodegasRouter.use(requiereAutenticacion);

bodegasRouter.get("/", requierePermiso("bodegas", "consultar"), async (req, res) => {
  const bodegas = await prisma.bodega.findMany({
    where: { empresaId: req.usuario!.empresaId },
    include: { ubicaciones: true, sucursal: true },
    orderBy: { codigo: "asc" },
  });
  res.json(bodegas);
});

const bodegaSchema = z.object({ codigo: z.string().min(1), nombre: z.string().min(1), sucursalId: z.string().uuid().optional() });

bodegasRouter.post("/", requierePermiso("bodegas", "crear"), async (req, res) => {
  const parsed = bodegaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const bodega = await prisma.bodega.create({ data: { ...parsed.data, empresaId: req.usuario!.empresaId } });
  res.status(201).json(bodega);
});

const ubicacionSchema = z.object({
  bodegaId: z.string().uuid(),
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  tipo: z.enum(["RECEPCION", "ALMACENAMIENTO", "PREPARACION", "DESPACHO", "CUARENTENA", "TRANSITO", "DEVOLUCION"]),
  zona: z.string().optional(),
  pasillo: z.string().optional(),
  estanteria: z.string().optional(),
  nivel: z.string().optional(),
});

export const ubicacionesRouter = Router();
ubicacionesRouter.use(requiereAutenticacion);

ubicacionesRouter.get("/", requierePermiso("ubicaciones", "consultar"), async (req, res) => {
  const { bodegaId } = req.query as { bodegaId?: string };
  const ubicaciones = await prisma.ubicacion.findMany({
    where: { bodega: { empresaId: req.usuario!.empresaId }, bodegaId: bodegaId || undefined },
    orderBy: { codigo: "asc" },
  });
  res.json(ubicaciones);
});

ubicacionesRouter.post("/", requierePermiso("ubicaciones", "crear"), async (req, res) => {
  const parsed = ubicacionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const bodega = await prisma.bodega.findFirst({ where: { id: parsed.data.bodegaId, empresaId: req.usuario!.empresaId } });
  if (!bodega) return res.status(403).json({ error: "La bodega no pertenece a su empresa" });
  const ubicacion = await prisma.ubicacion.create({ data: parsed.data });
  res.status(201).json(ubicacion);
});
