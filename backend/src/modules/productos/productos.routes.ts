import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";

export const productosRouter = Router();
productosRouter.use(requiereAutenticacion);

const productoSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  codigoBarras: z.string().optional(),
  categoriaId: z.string().uuid().optional(),
  marcaId: z.string().uuid().optional(),
  unidadBaseId: z.string().uuid(),
  controlLote: z.boolean().default(false),
  controlSerie: z.boolean().default(false),
  controlVencimiento: z.boolean().default(false),
  vidaUtilMinimaDias: z.number().int().positive().optional(),
  metodoValorizacion: z.enum(["PROMEDIO_PONDERADO", "FIFO"]).default("PROMEDIO_PONDERADO"),
  cantidadMinimaCompra: z.number().positive().optional(),
  multiploPedido: z.number().positive().optional(),
  plazoReposicionDias: z.number().int().positive().optional(),
});

// Campos declarados en la llegada más reciente de cada producto (Grupo, Condición,
// Status, Sub Status, Grade) para poder filtrar/mostrar en el catálogo sin promoverlos
// a columnas propias de Producto — decisión explícita del usuario: solo agregar
// filtros/columnas en pantallas existentes referenciando la última llegada.
const CAMPOS_LLEGADA = ["grupo", "condicion", "status", "subStatus", "grade"] as const;

// Se registra antes de "/:id" para que Express no confunda "filtros" con un id de producto.
productosRouter.get("/filtros/llegada", requierePermiso("productos", "consultar"), async (req, res) => {
  const llegadas = await prisma.llegadaProducto.findMany({
    where: { empresaId: req.usuario!.empresaId },
    select: { grupo: true, condicion: true, status: true, subStatus: true, grade: true },
  });
  const distinto = (campo: (typeof CAMPOS_LLEGADA)[number]) =>
    [...new Set(llegadas.map((l) => l[campo]).filter((v): v is string => !!v))].sort();
  res.json(Object.fromEntries(CAMPOS_LLEGADA.map((campo) => [campo, distinto(campo)])));
});

// Consultar: catálogo con búsqueda por código/nombre/código de barras, filtro por
// activo, y filtro por los campos de la llegada más reciente de cada producto.
productosRouter.get("/", requierePermiso("productos", "consultar"), async (req, res) => {
  const { q, activo, categoriaId, grupo, condicion, status, subStatus, grade } = req.query as Record<string, string | undefined>;

  let idsPorLlegada: string[] | undefined;
  if (grupo || condicion || status || subStatus || grade) {
    const llegadas = await prisma.llegadaProducto.findMany({
      where: { empresaId: req.usuario!.empresaId },
      orderBy: { fechaLlegada: "desc" },
      select: { productoId: true, grupo: true, condicion: true, status: true, subStatus: true, grade: true },
    });
    const ultimaPorProducto = new Map<string, (typeof llegadas)[number]>();
    for (const l of llegadas) {
      if (!ultimaPorProducto.has(l.productoId)) ultimaPorProducto.set(l.productoId, l);
    }
    idsPorLlegada = [...ultimaPorProducto.values()]
      .filter(
        (l) =>
          (!grupo || l.grupo === grupo) &&
          (!condicion || l.condicion === condicion) &&
          (!status || l.status === status) &&
          (!subStatus || l.subStatus === subStatus) &&
          (!grade || l.grade === grade)
      )
      .map((l) => l.productoId);
  }

  const productos = await prisma.producto.findMany({
    where: {
      empresaId: req.usuario!.empresaId,
      activo: activo !== undefined ? activo === "true" : undefined,
      categoriaId: categoriaId || undefined,
      id: idsPorLlegada ? { in: idsPorLlegada } : undefined,
      OR: q
        ? [
            { codigo: { contains: q, mode: "insensitive" } },
            { nombre: { contains: q, mode: "insensitive" } },
            { codigoBarras: { contains: q, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      categoria: true,
      marca: true,
      unidadBase: true,
      llegadas: { orderBy: { fechaLlegada: "desc" }, take: 1 },
    },
    orderBy: { codigo: "asc" },
    take: 200,
  });
  res.json(productos.map(({ llegadas, ...producto }) => ({ ...producto, ultimaLlegada: llegadas[0] ?? null })));
});

productosRouter.get("/:id", requierePermiso("productos", "consultar"), async (req, res) => {
  const producto = await prisma.producto.findFirst({
    where: { id: req.params.id, empresaId: req.usuario!.empresaId },
    include: {
      categoria: true,
      marca: true,
      unidadBase: true,
      conversiones: true,
      proveedores: { include: { proveedor: true } },
      parametrosReposicion: { include: { bodega: true } },
    },
  });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(producto);
});

productosRouter.post("/", requierePermiso("productos", "crear"), async (req, res) => {
  const parsed = productoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existente = await prisma.producto.findFirst({
    where: { empresaId: req.usuario!.empresaId, codigo: parsed.data.codigo },
  });
  if (existente) return res.status(409).json({ error: `Ya existe un producto con código ${parsed.data.codigo}` });

  const producto = await prisma.producto.create({
    data: {
      ...parsed.data,
      empresaId: req.usuario!.empresaId,
      creadoPorId: req.usuario!.usuarioId,
    },
  });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "productos.crear",
    entidad: "productos",
    entidadId: producto.id,
    resultado: "OK",
  });
  res.status(201).json(producto);
});

productosRouter.put("/:id", requierePermiso("productos", "modificar"), async (req, res) => {
  const parsed = productoSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const producto = await prisma.producto.findFirst({
    where: { id: req.params.id, empresaId: req.usuario!.empresaId },
  });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  const actualizado = await prisma.producto.update({
    where: { id: producto.id },
    data: { ...parsed.data, actualizadoPorId: req.usuario!.usuarioId },
  });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "productos.modificar",
    entidad: "productos",
    entidadId: producto.id,
    resultado: "OK",
  });
  res.json(actualizado);
});

// Desactivación controlada: nunca se elimina un producto con historial de movimientos.
productosRouter.post("/:id/desactivar", requierePermiso("productos", "modificar"), async (req, res) => {
  const producto = await prisma.producto.findFirst({
    where: { id: req.params.id, empresaId: req.usuario!.empresaId },
  });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  const actualizado = await prisma.producto.update({ where: { id: producto.id }, data: { activo: false } });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "productos.desactivar",
    entidad: "productos",
    entidadId: producto.id,
    resultado: "OK",
  });
  res.json(actualizado);
});

productosRouter.post("/:id/activar", requierePermiso("productos", "modificar"), async (req, res) => {
  const producto = await prisma.producto.update({
    where: { id: req.params.id },
    data: { activo: true },
  });
  res.json(producto);
});
