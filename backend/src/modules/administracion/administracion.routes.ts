import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requiereAutenticacion, requierePermiso } from "../../middleware/auth.middleware.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";

// Los roles y permisos son un catálogo compartido entre empresas (no hay una
// tabla de roles por empresa en este modelo): administrar permisos aquí
// afecta a ese rol en todas las empresas que lo usan. Es una simplificación
// documentada en docs/plan-implementacion.md, no un descuido.
export const administracionRouter = Router();
administracionRouter.use(requiereAutenticacion);

administracionRouter.get("/roles", requierePermiso("administracion", "consultar"), async (_req, res) => {
  const roles = await prisma.rol.findMany({
    include: { permisos: { include: { permiso: true } } },
    orderBy: { codigo: "asc" },
  });
  res.json(
    roles.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      nombre: r.nombre,
      permisos: r.permisos.map((rp) => ({ id: rp.permiso.id, recurso: rp.permiso.recurso, accion: rp.permiso.accion })),
    }))
  );
});

administracionRouter.get("/permisos", requierePermiso("administracion", "consultar"), async (_req, res) => {
  const permisos = await prisma.permiso.findMany({ orderBy: [{ recurso: "asc" }, { accion: "asc" }] });
  res.json(permisos);
});

const permisoBodySchema = z.object({ permisoId: z.string().uuid() });

administracionRouter.post("/roles/:rolId/permisos", requierePermiso("administracion", "modificar"), async (req, res) => {
  const parsed = permisoBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rolPermiso = await prisma.rolPermiso.upsert({
    where: { rolId_permisoId: { rolId: req.params.rolId, permisoId: parsed.data.permisoId } },
    update: {},
    create: { rolId: req.params.rolId, permisoId: parsed.data.permisoId },
  });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "administracion.otorgar_permiso",
    entidad: "rol_permisos",
    entidadId: `${req.params.rolId}:${parsed.data.permisoId}`,
    resultado: "OK",
  });
  res.status(201).json(rolPermiso);
});

administracionRouter.delete("/roles/:rolId/permisos/:permisoId", requierePermiso("administracion", "modificar"), async (req, res) => {
  await prisma.rolPermiso.deleteMany({ where: { rolId: req.params.rolId, permisoId: req.params.permisoId } });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "administracion.revocar_permiso",
    entidad: "rol_permisos",
    entidadId: `${req.params.rolId}:${req.params.permisoId}`,
    resultado: "OK",
  });
  res.status(204).send();
});

administracionRouter.get("/usuarios", requierePermiso("administracion", "consultar"), async (req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { empresaId: req.usuario!.empresaId },
    include: { rol: true },
    orderBy: { nombre: "asc" },
  });
  res.json(usuarios.map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, activo: u.activo, rolId: u.rolId, rolCodigo: u.rol.codigo })));
});

const cambiarRolSchema = z.object({ rolId: z.string().uuid() });

administracionRouter.put("/usuarios/:id/rol", requierePermiso("administracion", "modificar"), async (req, res) => {
  const parsed = cambiarRolSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const usuario = await prisma.usuario.findFirst({ where: { id: req.params.id, empresaId: req.usuario!.empresaId } });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

  const actualizado = await prisma.usuario.update({ where: { id: usuario.id }, data: { rolId: parsed.data.rolId }, include: { rol: true } });
  await registrarAuditoria({
    empresaId: req.usuario!.empresaId,
    usuarioId: req.usuario!.usuarioId,
    accion: "administracion.cambiar_rol_usuario",
    entidad: "usuarios",
    entidadId: usuario.id,
    resultado: "OK",
    detalle: { nuevoRol: actualizado.rol.codigo },
  });
  res.json({ id: actualizado.id, nombre: actualizado.nombre, email: actualizado.email, rolId: actualizado.rolId, rolCodigo: actualizado.rol.codigo });
});
