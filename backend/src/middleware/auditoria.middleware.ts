import { prisma } from "../lib/prisma.js";

export async function registrarAuditoria(p: {
  empresaId: string;
  usuarioId?: string;
  accion: string;
  entidad: string;
  entidadId?: string;
  resultado: "OK" | "ERROR" | "DENEGADO";
  detalle?: unknown;
  ip?: string;
}) {
  await prisma.auditoria.create({
    data: {
      empresaId: p.empresaId,
      usuarioId: p.usuarioId,
      accion: p.accion,
      entidad: p.entidad,
      entidadId: p.entidadId,
      resultado: p.resultado,
      detalle: p.detalle ? JSON.parse(JSON.stringify(p.detalle)) : undefined,
      ip: p.ip,
    },
  });
}
