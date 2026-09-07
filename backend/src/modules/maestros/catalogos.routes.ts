import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion } from "../../middleware/auth.middleware.js";

export const catalogosRouter = Router();
catalogosRouter.use(requiereAutenticacion);

catalogosRouter.get("/unidades-medida", async (req, res) => {
  res.json(await prisma.unidadMedida.findMany({ where: { empresaId: req.usuario!.empresaId, activo: true }, orderBy: { codigo: "asc" } }));
});

catalogosRouter.get("/categorias", async (req, res) => {
  res.json(await prisma.categoria.findMany({ where: { empresaId: req.usuario!.empresaId, activo: true }, orderBy: { codigo: "asc" } }));
});

catalogosRouter.get("/marcas", async (req, res) => {
  res.json(await prisma.marca.findMany({ where: { empresaId: req.usuario!.empresaId, activo: true }, orderBy: { codigo: "asc" } }));
});

catalogosRouter.get("/motivos", async (req, res) => {
  const { categoria } = req.query as { categoria?: string };
  res.json(await prisma.motivo.findMany({ where: { empresaId: req.usuario!.empresaId, activo: true, categoria }, orderBy: { codigo: "asc" } }));
});
