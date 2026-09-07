import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { compararPassword, firmarToken } from "../../lib/auth.js";
import { registrarAuditoria } from "../../middleware/auditoria.middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Credenciales inválidas" });

  const { email, password } = parsed.data;
  const usuario = await prisma.usuario.findUnique({ where: { email }, include: { rol: true } });
  if (!usuario || !usuario.activo || !(await compararPassword(password, usuario.passwordHash))) {
    if (usuario) {
      await registrarAuditoria({
        empresaId: usuario.empresaId,
        usuarioId: usuario.id,
        accion: "auth.login",
        entidad: "usuarios",
        entidadId: usuario.id,
        resultado: "DENEGADO",
      });
    }
    return res.status(401).json({ error: "Correo o contraseña incorrectos" });
  }

  const token = firmarToken({
    usuarioId: usuario.id,
    empresaId: usuario.empresaId,
    rolCodigo: usuario.rol.codigo,
    email: usuario.email,
  });

  await registrarAuditoria({
    empresaId: usuario.empresaId,
    usuarioId: usuario.id,
    accion: "auth.login",
    entidad: "usuarios",
    entidadId: usuario.id,
    resultado: "OK",
  });

  res.json({
    token,
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol.codigo, empresaId: usuario.empresaId },
  });
});
