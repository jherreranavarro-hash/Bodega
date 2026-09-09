import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion } from "../../lib/errors.js";
import {
  productosBajoPuntoReposicion,
  productosConSobrestock,
  vencimientosProximos,
} from "../indicadores/indicadores.service.js";
import { generarSolicitudDesdeReposicion } from "../compras/solicitud-compra.service.js";

/**
 * Evita reabrir la misma alerta en cada corrida: si ya existe una abierta (o
 * en revisión) para el mismo tipo+entidad, se deja como está en vez de crear
 * un duplicado. Generar alertas es una operación explícita (a pedido, no un
 * cronjob en esta iteración) pero debe poder llamarse repetidamente sin
 * acumular ruido.
 */
async function existeAlertaAbierta(empresaId: string, tipo: string, entidadId: string) {
  const existente = await prisma.alerta.findFirst({
    where: { empresaId, tipo, entidadId, estado: { in: ["ABIERTA", "EN_REVISION"] } },
  });
  return existente != null;
}

/**
 * Genera alertas a partir de los indicadores ya calculados (reposición,
 * sobrestock, vencimientos próximos). Cada alerta queda con la evidencia
 * numérica que la sustenta y una acción recomendada explícita — nunca
 * ejecuta nada por sí sola (sección 12 del encargo).
 */
export async function generarAlertas(empresaId: string) {
  const creadas: string[] = [];

  for (const r of await productosBajoPuntoReposicion(empresaId)) {
    const entidadId = `${r.productoId}:${r.bodegaId}`;
    if (await existeAlertaAbierta(empresaId, "BAJO_PUNTO_REPOSICION", entidadId)) continue;
    const faltante = new Prisma.Decimal(r.faltante);
    const puntoReposicion = new Prisma.Decimal(r.puntoReposicion);
    const severidad = puntoReposicion.gt(0) && faltante.div(puntoReposicion).gte("0.5") ? "ALTA" : "MEDIA";
    const alerta = await prisma.alerta.create({
      data: {
        empresaId,
        tipo: "BAJO_PUNTO_REPOSICION",
        entidad: "productos",
        entidadId,
        severidad,
        evidencia: r as unknown as Prisma.InputJsonValue,
        accionesRecomendadas: {
          create: [
            {
              descripcion: `Comprar ${r.productoCodigo} (${r.productoNombre}) en la bodega ${r.bodegaCodigo}: faltan ${r.faltante} unidades para cubrir el punto de reposición.`,
              impactoEstimado: { faltante: r.faltante, plazoReposicionDias: r.plazoReposicionDias } as Prisma.InputJsonValue,
            },
          ],
        },
      },
      include: { accionesRecomendadas: true },
    });
    creadas.push(alerta.id);
  }

  for (const r of await productosConSobrestock(empresaId)) {
    const entidadId = `${r.productoId}:${r.bodegaId}`;
    if (await existeAlertaAbierta(empresaId, "SOBRESTOCK", entidadId)) continue;
    const alerta = await prisma.alerta.create({
      data: {
        empresaId,
        tipo: "SOBRESTOCK",
        entidad: "productos",
        entidadId,
        severidad: "BAJA",
        evidencia: r as unknown as Prisma.InputJsonValue,
        accionesRecomendadas: {
          create: [
            {
              descripcion: `Suspender o postergar compras adicionales de ${r.productoCodigo}: excedente de ${r.excedente} unidades sobre el máximo configurado.`,
              impactoEstimado: { excedente: r.excedente } as Prisma.InputJsonValue,
            },
          ],
        },
      },
    });
    creadas.push(alerta.id);
  }

  for (const v of await vencimientosProximos(empresaId, 30)) {
    if (!v.fechaVencimiento) continue;
    const entidadId = `${v.productoId}:${v.loteCodigo}`;
    if (await existeAlertaAbierta(empresaId, "VENCIMIENTO_PROXIMO", entidadId)) continue;
    const diasParaVencer = Math.ceil((new Date(v.fechaVencimiento).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const alerta = await prisma.alerta.create({
      data: {
        empresaId,
        tipo: "VENCIMIENTO_PROXIMO",
        entidad: "lotes",
        entidadId,
        severidad: diasParaVencer <= 7 ? "ALTA" : "MEDIA",
        evidencia: v as unknown as Prisma.InputJsonValue,
        accionesRecomendadas: {
          create: [
            {
              descripcion: `Priorizar el uso o traslado del lote ${v.loteCodigo} de ${v.productoCodigo} (${v.cantidad} unidades) antes de su vencimiento el ${new Date(v.fechaVencimiento).toLocaleDateString("es-CL")}.`,
              impactoEstimado: { diasParaVencer, cantidad: v.cantidad } as Prisma.InputJsonValue,
              fechaObjetivo: v.fechaVencimiento,
            },
          ],
        },
      },
    });
    creadas.push(alerta.id);
  }

  return prisma.alerta.findMany({ where: { id: { in: creadas } }, include: { accionesRecomendadas: true } });
}

async function resolverAccion(accionId: string, estado: string, justificacion?: string, fechaObjetivo?: Date, responsableId?: string) {
  const accion = await prisma.accionRecomendada.findUniqueOrThrow({ where: { id: accionId } });
  if (accion.estado !== "PROPUESTA") throw new ErrorValidacion("Esta acción ya fue resuelta");
  return prisma.accionRecomendada.update({
    where: { id: accionId },
    data: { estado, justificacion, fechaObjetivo, responsableId },
  });
}

export async function aceptarAccion(accionId: string, responsableId: string, justificacion?: string) {
  return resolverAccion(accionId, "ACEPTADA", justificacion, undefined, responsableId);
}

export async function rechazarAccion(accionId: string, justificacion: string) {
  if (!justificacion) throw new ErrorValidacion("Rechazar una acción recomendada exige justificación");
  return resolverAccion(accionId, "RECHAZADA", justificacion);
}

export async function postergarAccion(accionId: string, nuevaFechaObjetivo: Date, justificacion?: string) {
  return resolverAccion(accionId, "POSTERGADA", justificacion, nuevaFechaObjetivo);
}

/**
 * Convierte la recomendación en una solicitud de compra real (solo aplica a
 * alertas de bajo punto de reposición). La solicitud generada sigue
 * naciendo PENDIENTE_APROBACION: esto NO ejecuta una compra, solo la
 * propone formalmente dentro del flujo ya controlado.
 */
export async function convertirAccionEnSolicitud(accionId: string, solicitanteId: string, folio: string, justificacion?: string) {
  const accion = await prisma.accionRecomendada.findUniqueOrThrow({ where: { id: accionId }, include: { alerta: true } });
  if (accion.estado !== "PROPUESTA") throw new ErrorValidacion("Esta acción ya fue resuelta");
  if (accion.alerta.tipo !== "BAJO_PUNTO_REPOSICION") {
    throw new ErrorValidacion("Solo una alerta de bajo punto de reposición puede convertirse en solicitud de compra");
  }
  const [productoId, bodegaId] = accion.alerta.entidadId!.split(":");

  const solicitud = await generarSolicitudDesdeReposicion({ productoId, bodegaId, solicitanteId, folio });

  await resolverAccion(accionId, "CONVERTIDA_SOLICITUD", justificacion, undefined, solicitanteId);
  await prisma.alerta.update({ where: { id: accion.alertaId }, data: { estado: "ATENDIDA" } });

  return solicitud;
}

export async function descartarAlerta(alertaId: string) {
  return prisma.alerta.update({ where: { id: alertaId }, data: { estado: "DESCARTADA" } });
}
