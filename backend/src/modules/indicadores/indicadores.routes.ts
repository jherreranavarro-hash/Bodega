import { Router } from "express";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import {
  productosBajoPuntoReposicion,
  productosConSobrestock,
  vencimientosProximos,
  resumenDisponibilidad,
  exactitudInventario,
} from "./indicadores.service.js";

export const indicadoresRouter = Router();
indicadoresRouter.use(requiereAutenticacion);

indicadoresRouter.get("/reposicion", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const { bodegaId } = req.query as { bodegaId?: string };
  res.json(await productosBajoPuntoReposicion(req.usuario!.empresaId, bodegaId));
});

indicadoresRouter.get("/sobrestock", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const { bodegaId } = req.query as { bodegaId?: string };
  res.json(await productosConSobrestock(req.usuario!.empresaId, bodegaId));
});

indicadoresRouter.get("/vencimientos", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const dias = Number(req.query.dias ?? 30);
  res.json(await vencimientosProximos(req.usuario!.empresaId, dias));
});

indicadoresRouter.get("/disponibilidad", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const { bodegaId } = req.query as { bodegaId?: string };
  if (!bodegaId) return res.status(400).json({ error: "bodegaId es requerido" });
  res.json(await resumenDisponibilidad(req.usuario!.empresaId, bodegaId));
});

indicadoresRouter.get("/exactitud", requierePermiso("indicadores", "consultar"), async (req, res) => {
  const { bodegaId } = req.query as { bodegaId?: string };
  if (!bodegaId) return res.status(400).json({ error: "bodegaId es requerido" });
  res.json(await exactitudInventario(bodegaId));
});
