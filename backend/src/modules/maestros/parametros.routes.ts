import { Router } from "express";
import { z } from "zod";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import { obtenerFechaCierre, definirFechaCierre } from "../inventario/periodos.service.js";

export const parametrosRouter = Router();
parametrosRouter.use(requiereAutenticacion);

parametrosRouter.get("/periodo-cierre", requierePermiso("parametros", "consultar"), async (req, res) => {
  const fechaCierre = await obtenerFechaCierre(req.usuario!.empresaId);
  res.json({ fechaCierre });
});

const definirCierreSchema = z.object({ fecha: z.coerce.date() });

// Cerrar un período es sensible: bloquea toda operación con fecha efectiva
// igual o anterior a partir de este momento. Nunca se activa automáticamente.
parametrosRouter.put("/periodo-cierre", requierePermiso("parametros", "modificar"), async (req, res) => {
  const parsed = definirCierreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const parametro = await definirFechaCierre(req.usuario!.empresaId, parsed.data.fecha);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "parametros.definir_periodo_cierre",
      entidad: "parametros",
      entidadId: parametro.id,
      resultado: "OK",
      detalle: { fecha: parsed.data.fecha },
    });
    res.json(parametro);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});
