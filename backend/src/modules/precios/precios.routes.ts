import { Router } from "express";
import { z } from "zod";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import { listarPrecios, actualizarPrecio } from "./precios.service.js";

export const preciosRouter = Router();
preciosRouter.use(requiereAutenticacion);

preciosRouter.get("/", requierePermiso("precios", "consultar"), async (req, res) => {
  res.json(await listarPrecios(req.usuario!.empresaId));
});

const actualizarSchema = z.object({
  modo: z.enum(["FIJO", "PORCENTAJE"]),
  precioFijoClp: z.union([z.number(), z.string()]).optional(),
  porcentajeMargen: z.union([z.number(), z.string()]).optional(),
  afectoIva: z.boolean().optional(),
});

preciosRouter.put("/:productoId", requierePermiso("precios", "modificar"), async (req, res) => {
  const parsed = actualizarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const precio = await actualizarPrecio(req.params.productoId, req.usuario!.empresaId, parsed.data, req.usuario!.usuarioId);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "precios.actualizar",
      entidad: "precios_venta",
      entidadId: precio.id,
      resultado: "OK",
    });
    res.json(precio);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
