import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { guardarAdjunto, listarAdjuntos, leerAdjunto, eliminarAdjunto } from "./adjuntos.service.js";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

export const adjuntosRouter = Router();
adjuntosRouter.use(requiereAutenticacion);

const subirSchema = z.object({ entidad: z.string().min(1), entidadId: z.string().min(1) });

adjuntosRouter.post("/", requierePermiso("adjuntos", "crear"), upload.single("archivo"), async (req, res) => {
  const parsed = subirSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.file) return res.status(400).json({ error: "Debe adjuntar un archivo" });

  try {
    const adjunto = await guardarAdjunto({
      entidad: parsed.data.entidad,
      entidadId: parsed.data.entidadId,
      nombreOriginal: req.file.originalname,
      contenido: req.file.buffer,
      tipo: req.file.mimetype,
    });
    res.status(201).json(adjunto);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

adjuntosRouter.get("/", requierePermiso("adjuntos", "consultar"), async (req, res) => {
  const { entidad, entidadId } = req.query as { entidad?: string; entidadId?: string };
  if (!entidad || !entidadId) return res.status(400).json({ error: "entidad y entidadId son requeridos" });
  res.json(await listarAdjuntos(entidad, entidadId));
});

adjuntosRouter.get("/:id/descargar", requierePermiso("adjuntos", "consultar"), async (req, res) => {
  try {
    const { nombre, contenido, tipo } = await leerAdjunto(req.params.id);
    res.setHeader("Content-Type", tipo ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(nombre)}"`);
    res.send(contenido);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 404).json({ error: (err as Error).message });
  }
});

adjuntosRouter.delete("/:id", requierePermiso("adjuntos", "crear"), async (req, res) => {
  try {
    await eliminarAdjunto(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status((err as { status?: number }).status ?? 404).json({ error: (err as Error).message });
  }
});
