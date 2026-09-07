import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { calcularPronostico, simularEscenario } from "./pronostico.service.js";

export const analiticaRouter = Router();
analiticaRouter.use(requiereAutenticacion);

const pronosticoSchema = z.object({ productoId: z.string().uuid(), bodegaId: z.string().uuid() });

analiticaRouter.post("/pronosticos", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const parsed = pronosticoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const resultado = await calcularPronostico(parsed.data.productoId, parsed.data.bodegaId);
  res.status(resultado.suficiente ? 201 : 200).json(resultado);
});

analiticaRouter.get("/pronosticos", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const { productoId, bodegaId } = req.query as { productoId?: string; bodegaId?: string };
  const pronosticos = await prisma.pronostico.findMany({
    where: { productoId, bodegaId },
    orderBy: { creadoEn: "desc" },
    take: 20,
  });
  res.json(pronosticos);
});

const escenarioSchema = z.object({
  nombre: z.string().min(1),
  productoId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  incrementoDemandaPct: z.number().optional(),
  retrasoProveedorDias: z.number().int().optional(),
  cambioStockSeguridad: z.number().optional(),
});

analiticaRouter.post("/escenarios", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const parsed = escenarioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const escenario = await simularEscenario({ ...parsed.data, creadoPorId: req.usuario!.usuarioId });
    res.status(201).json(escenario);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

analiticaRouter.get("/escenarios", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const escenarios = await prisma.escenario.findMany({ orderBy: { creadoEn: "desc" }, take: 20 });
  res.json(escenarios);
});
