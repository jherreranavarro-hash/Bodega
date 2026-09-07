import type { NextFunction, Request, Response } from "express";
import { verificarToken, TokenPayload } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { registrarAuditoria } from "./auditoria.middleware.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: TokenPayload;
    }
  }
}

export function requiereAutenticacion(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  try {
    req.usuario = verificarToken(header.slice("Bearer ".length));
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/**
 * Exige que el rol del usuario tenga el permiso (recurso, accion). Además de
 * este control de servidor, el cliente puede ocultar acciones en la UI, pero
 * la autorización real siempre se valida aquí.
 */
export function requierePermiso(recurso: string, accion: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) return res.status(401).json({ error: "No autenticado" });
    const tienePermiso = await prisma.rolPermiso.findFirst({
      where: {
        rol: { codigo: req.usuario.rolCodigo },
        permiso: { recurso, accion },
      },
    });
    if (!tienePermiso) {
      await registrarAuditoria({
        empresaId: req.usuario.empresaId,
        usuarioId: req.usuario.usuarioId,
        accion: `${recurso}.${accion}`,
        entidad: recurso,
        resultado: "DENEGADO",
      });
      return res.status(403).json({ error: `No tiene permiso para ${accion} en ${recurso}` });
    }
    next();
  };
}

/** Verifica que la bodega solicitada pertenezca a la empresa del usuario autenticado. */
export async function requiereBodegaDeEmpresa(req: Request, res: Response, next: NextFunction) {
  const bodegaId = (req.params.bodegaId ?? req.body.bodegaId) as string | undefined;
  if (!bodegaId || !req.usuario) return next();
  const bodega = await prisma.bodega.findUnique({ where: { id: bodegaId } });
  if (!bodega || bodega.empresaId !== req.usuario.empresaId) {
    return res.status(403).json({ error: "La bodega no pertenece a su empresa" });
  }
  next();
}
