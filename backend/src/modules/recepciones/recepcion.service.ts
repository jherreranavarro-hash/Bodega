import { EstadoDocumentoCompra, EstadoRecepcion, Prisma, TipoOperacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { registrarMovimiento, crearOperacion } from "../inventario/inventario.service.js";
import { ErrorValidacion } from "../../lib/errors.js";

export interface LineaRecepcion {
  ordenCompraDetalleId?: string;
  productoId: string;
  ubicacionDestinoId: string;
  loteCodigo?: string;
  fechaVencimiento?: Date;
  cantidadRecibida: number | string;
  cantidadAceptada: number | string;
  cantidadRechazada?: number | string;
  costoUnitario: number | string;
  motivoRechazoId?: string;
}

export interface DatosRecepcion {
  empresaId: string;
  folio: string;
  bodegaId: string;
  ordenCompraId?: string;
  fechaEfectiva: Date;
  usuarioId: string;
  detalle: LineaRecepcion[];
}

/**
 * Contabiliza una recepción (total o parcial) en una única transacción:
 * crea la operación de inventario, un movimiento de entrada por línea,
 * actualiza cantidad_recibida de la orden de compra y abre una capa de
 * costo para valorización. Documentos en borrador no llegan a este método;
 * solo se invoca al confirmar la recepción.
 */
export async function contabilizarRecepcion(datos: DatosRecepcion) {
  if (datos.detalle.length === 0) throw new ErrorValidacion("La recepción no tiene líneas");

  return prisma.$transaction(async (tx) => {
    const operacion = await crearOperacion(tx, {
      empresaId: datos.empresaId,
      bodegaId: datos.bodegaId,
      tipo: TipoOperacion.RECEPCION,
      documentoOrigen: datos.folio,
      fechaEfectiva: datos.fechaEfectiva,
      usuarioId: datos.usuarioId,
    });

    const recepcion = await tx.recepcion.create({
      data: {
        folio: datos.folio,
        bodegaId: datos.bodegaId,
        ordenCompraId: datos.ordenCompraId,
        estado: EstadoRecepcion.CONTABILIZADA,
        fechaEfectiva: datos.fechaEfectiva,
        usuarioId: datos.usuarioId,
        operacionId: operacion.id,
      },
    });

    for (const linea of datos.detalle) {
      const aceptada = new Prisma.Decimal(linea.cantidadAceptada);
      if (aceptada.lt(0)) throw new ErrorValidacion("La cantidad aceptada no puede ser negativa");

      let loteId: string | undefined;
      if (linea.loteCodigo) {
        const producto = await tx.producto.findUniqueOrThrow({ where: { id: linea.productoId } });
        if (producto.controlLote && !linea.loteCodigo) {
          throw new ErrorValidacion(`El producto ${producto.codigo} exige lote en la recepción`);
        }
        const lote = await tx.lote.upsert({
          where: { productoId_codigoLote: { productoId: linea.productoId, codigoLote: linea.loteCodigo } },
          update: {},
          create: {
            productoId: linea.productoId,
            codigoLote: linea.loteCodigo,
            fechaVencimiento: linea.fechaVencimiento,
          },
        });
        loteId = lote.id;
      }

      await tx.recepcionDetalle.create({
        data: {
          recepcionId: recepcion.id,
          ordenCompraDetalleId: linea.ordenCompraDetalleId,
          productoId: linea.productoId,
          ubicacionDestinoId: linea.ubicacionDestinoId,
          loteCodigo: linea.loteCodigo,
          fechaVencimiento: linea.fechaVencimiento,
          cantidadRecibida: new Prisma.Decimal(linea.cantidadRecibida),
          cantidadAceptada: aceptada,
          cantidadRechazada: new Prisma.Decimal(linea.cantidadRechazada ?? 0),
          costoUnitario: new Prisma.Decimal(linea.costoUnitario),
          motivoRechazoId: linea.motivoRechazoId,
        },
      });

      if (aceptada.gt(0)) {
        await registrarMovimiento(tx, {
          operacionId: operacion.id,
          productoId: linea.productoId,
          ubicacionDestinoId: linea.ubicacionDestinoId,
          loteId,
          cantidad: aceptada,
          costoUnitario: linea.costoUnitario,
          fechaEfectiva: datos.fechaEfectiva,
        });

        await tx.capaCosto.create({
          data: {
            productoId: linea.productoId,
            loteId,
            costoUnitario: new Prisma.Decimal(linea.costoUnitario),
            cantidadOriginal: aceptada,
            cantidadDisponible: aceptada,
            fuenteTipo: "RECEPCION",
            fuenteId: recepcion.id,
          },
        });
      }

      if (linea.ordenCompraDetalleId) {
        await tx.ordenCompraDetalle.update({
          where: { id: linea.ordenCompraDetalleId },
          data: {
            cantidadRecibida: { increment: aceptada },
            cantidadRechazada: { increment: new Prisma.Decimal(linea.cantidadRechazada ?? 0) },
          },
        });
      }
    }

    if (datos.ordenCompraId) {
      const detalles = await tx.ordenCompraDetalle.findMany({ where: { ordenCompraId: datos.ordenCompraId } });
      const completa = detalles.every((d) => new Prisma.Decimal(d.cantidadRecibida).gte(new Prisma.Decimal(d.cantidadPedida)));
      const algunaRecibida = detalles.some((d) => new Prisma.Decimal(d.cantidadRecibida).gt(0));
      await tx.ordenCompra.update({
        where: { id: datos.ordenCompraId },
        data: {
          estado: completa
            ? EstadoDocumentoCompra.RECIBIDA_TOTAL
            : algunaRecibida
            ? EstadoDocumentoCompra.RECEPCION_PARCIAL
            : undefined,
        },
      });
    }

    return recepcion;
  });
}
