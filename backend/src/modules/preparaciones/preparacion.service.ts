import { EstadoPreparacion, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion } from "../../lib/errors.js";

export interface DatosCrearPreparacion {
  folio: string;
  solicitudId: string;
  responsableId: string;
}

/**
 * Crea la lista de preparación de una solicitud de salida, con una línea por
 * cada línea de la solicitud. La preparación es el paso de validación física
 * (embalaje/verificación de productos) que debe completarse antes de poder
 * despachar: el despacho exige `estado = LISTA` cuando referencia una
 * preparación (ver `despacho.service.ts`).
 */
export async function crearPreparacion(datos: DatosCrearPreparacion) {
  const solicitud = await prisma.solicitudSalida.findUniqueOrThrow({
    where: { id: datos.solicitudId },
    include: { detalle: true },
  });
  if (solicitud.detalle.length === 0) throw new ErrorValidacion("La solicitud no tiene líneas para preparar");

  return prisma.preparacion.create({
    data: {
      folio: datos.folio,
      solicitudId: datos.solicitudId,
      responsableId: datos.responsableId,
      estado: EstadoPreparacion.PENDIENTE,
      detalle: {
        create: solicitud.detalle.map((d) => ({ productoId: d.productoId, cantidadSolicitada: d.cantidadSolicitada })),
      },
    },
    include: { detalle: true },
  });
}

/** Registra la cantidad verificada (embalada/validada) de una línea de preparación. */
export async function registrarVerificacion(detalleId: string, cantidadVerificada: number) {
  return prisma.$transaction(async (tx) => {
    const detalle = await tx.preparacionDetalle.findUniqueOrThrow({ where: { id: detalleId }, include: { preparacion: true } });
    if (detalle.preparacion.estado === EstadoPreparacion.LISTA || detalle.preparacion.estado === EstadoPreparacion.ANULADA) {
      throw new ErrorValidacion("No se puede modificar una preparación ya lista o anulada");
    }
    const cantidad = new Prisma.Decimal(cantidadVerificada);
    if (cantidad.lt(0) || cantidad.gt(detalle.cantidadSolicitada)) {
      throw new ErrorValidacion(`La cantidad verificada debe estar entre 0 y ${detalle.cantidadSolicitada.toString()}`);
    }

    const actualizado = await tx.preparacionDetalle.update({ where: { id: detalleId }, data: { cantidadVerificada: cantidad } });

    if (detalle.preparacion.estado === EstadoPreparacion.PENDIENTE) {
      await tx.preparacion.update({ where: { id: detalle.preparacionId }, data: { estado: EstadoPreparacion.EN_PROCESO } });
    }

    return actualizado;
  });
}

/** Marca la preparación como lista para despacho: exige que toda línea esté completamente verificada. */
export async function marcarPreparacionLista(preparacionId: string) {
  return prisma.$transaction(async (tx) => {
    const preparacion = await tx.preparacion.findUniqueOrThrow({ where: { id: preparacionId }, include: { detalle: true } });
    if (preparacion.estado === EstadoPreparacion.LISTA) throw new ErrorValidacion("La preparación ya está lista");
    if (preparacion.estado === EstadoPreparacion.ANULADA) throw new ErrorValidacion("La preparación está anulada");

    const incompleta = preparacion.detalle.find((d) => new Prisma.Decimal(d.cantidadVerificada).lt(new Prisma.Decimal(d.cantidadSolicitada)));
    if (incompleta) {
      throw new ErrorValidacion(
        `No se puede marcar lista: quedan productos sin verificar por completo (producto ${incompleta.productoId})`
      );
    }

    return tx.preparacion.update({ where: { id: preparacionId }, data: { estado: EstadoPreparacion.LISTA } });
  });
}

export async function anularPreparacion(preparacionId: string) {
  const despachosVinculados = await prisma.despacho.count({ where: { preparacionId } });
  if (despachosVinculados > 0) throw new ErrorValidacion("No se puede anular una preparación que ya tiene despachos asociados");
  return prisma.preparacion.update({ where: { id: preparacionId }, data: { estado: EstadoPreparacion.ANULADA } });
}
