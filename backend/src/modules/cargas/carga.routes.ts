import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";
import { recibirArchivo, validarYSimular, aprobarCarga, ejecutarCarga } from "./carga.service.js";

// Límite de tamaño y filtro de tipo para mitigar archivos maliciosos.
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const permitido = [".csv", ".txt", ".xlsx"].some((ext) => file.originalname.toLowerCase().endsWith(ext));
    if (!permitido) return cb(new Error("Solo se aceptan archivos .csv o .xlsx"));
    cb(null, true);
  },
});

export const cargasRouter = Router();
cargasRouter.use(requiereAutenticacion);

cargasRouter.get("/plantillas", requierePermiso("cargas", "consultar"), async (_req, res) => {
  const plantillas = await prisma.plantillaCarga.findMany({ where: { activo: true } });
  res.json(plantillas);
});

const recibirSchema = z.object({
  entidad: z.string(),
  modo: z.enum(["SOLO_CREACION", "SOLO_ACTUALIZACION", "CREACION_Y_ACTUALIZACION", "VALIDACION_SIN_APLICAR"]),
  // JSON con parámetros propios de la entidad que no vienen en el archivo
  // (p. ej. {"bodegaDestinoId":"..."} para LLEGADA_PRODUCTOS).
  contexto: z.string().optional(),
});

cargasRouter.post("/", requierePermiso("cargas", "importar"), upload.single("archivo"), async (req, res) => {
  const parsed = recibirSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.file) return res.status(400).json({ error: "Debe adjuntar un archivo" });

  let contexto: Record<string, unknown> | undefined;
  if (parsed.data.contexto) {
    try {
      contexto = JSON.parse(parsed.data.contexto);
    } catch {
      return res.status(400).json({ error: "El campo contexto no es un JSON válido" });
    }
  }

  try {
    const carga = await recibirArchivo({
      empresaId: req.usuario!.empresaId,
      entidad: parsed.data.entidad,
      modo: parsed.data.modo,
      nombreArchivo: req.file.originalname,
      contenido: req.file.buffer,
      usuarioId: req.usuario!.usuarioId,
      contexto,
    });
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "cargas.recibir",
      entidad: "cargas_datos",
      entidadId: carga.id,
      resultado: "OK",
    });
    res.status(201).json(carga);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

cargasRouter.get("/:id", requierePermiso("cargas", "consultar"), async (req, res) => {
  const carga = await prisma.cargaDatos.findFirst({
    where: { id: req.params.id, empresaId: req.usuario!.empresaId },
    include: { filas: true, errores: true, plantilla: true },
  });
  if (!carga) return res.status(404).json({ error: "Carga no encontrada" });
  res.json(carga);
});

cargasRouter.get("/", requierePermiso("cargas", "consultar"), async (req, res) => {
  const cargas = await prisma.cargaDatos.findMany({
    where: { empresaId: req.usuario!.empresaId },
    orderBy: { creadoEn: "desc" },
    include: { plantilla: true },
  });
  res.json(cargas);
});

cargasRouter.post("/:id/validar", requierePermiso("cargas", "importar"), async (req, res) => {
  try {
    const carga = await validarYSimular(req.params.id);
    res.json(carga);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

cargasRouter.post("/:id/aprobar", requierePermiso("cargas", "aprobar"), async (req, res) => {
  try {
    const carga = await aprobarCarga(req.params.id, req.usuario!.usuarioId);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "cargas.aprobar",
      entidad: "cargas_datos",
      entidadId: carga.id,
      resultado: "OK",
    });
    res.json(carga);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

cargasRouter.post("/:id/ejecutar", requierePermiso("cargas", "ejecutar"), async (req, res) => {
  try {
    const carga = await ejecutarCarga(req.params.id, req.usuario!.usuarioId);
    await registrarAuditoria({
      empresaId: req.usuario!.empresaId,
      usuarioId: req.usuario!.usuarioId,
      accion: "cargas.ejecutar",
      entidad: "cargas_datos",
      entidadId: carga.id,
      resultado: "OK",
    });
    res.json(carga);
  } catch (err) {
    res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message });
  }
});

cargasRouter.get("/:id/errores.csv", requierePermiso("cargas", "exportar"), async (req, res) => {
  const errores = await prisma.cargaError.findMany({ where: { cargaId: req.params.id }, orderBy: { numeroFila: "asc" } });
  const encabezado = "fila,campo,severidad,mensaje\n";
  const cuerpo = errores
    .map((e) => [e.numeroFila, e.campo ?? "", e.severidad, `"${e.mensaje.replace(/"/g, '""')}"`].join(","))
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="errores-${req.params.id}.csv"`);
  res.send(encabezado + cuerpo);
});
