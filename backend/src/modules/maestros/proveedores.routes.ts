import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";

export const proveedoresRouter = Router();
proveedoresRouter.use(requiereAutenticacion);

const proveedorSchema = z.object({
  codigo: z.string().min(1),
  razonSocial: z.string().min(1),
  rut: z.string().optional(),
  email: z.string().email().optional(),
  telefono: z.string().optional(),
});

proveedoresRouter.get("/", requierePermiso("proveedores", "consultar"), async (req, res) => {
  const proveedores = await prisma.proveedor.findMany({
    where: { empresaId: req.usuario!.empresaId },
    orderBy: { codigo: "asc" },
  });
  res.json(proveedores);
});

proveedoresRouter.post("/", requierePermiso("proveedores", "crear"), async (req, res) => {
  const parsed = proveedorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const proveedor = await prisma.proveedor.create({ data: { ...parsed.data, empresaId: req.usuario!.empresaId } });
  res.status(201).json(proveedor);
});

proveedoresRouter.post("/:id/desactivar", requierePermiso("proveedores", "modificar"), async (req, res) => {
  const proveedor = await prisma.proveedor.update({ where: { id: req.params.id }, data: { activo: false } });
  res.json(proveedor);
});
