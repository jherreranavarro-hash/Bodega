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
  /** Costo unitario tal como fue facturado, en `moneda` (o en la moneda de la empresa si se omite). */
  costoUnitario: number | string;
  /** Moneda de costoUnitario. Si se omite, se asume la moneda de la empresa. */
  moneda?: string;
  /** Tipo de cambio de `moneda` a la moneda de la empresa. Obligatorio si `moneda` difiere de la de la empresa. */
  tipoCambio?: number | string;
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
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: datos.empresaId } });

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

      const monedaLinea = linea.moneda ?? empresa.moneda;
      if (monedaLinea !== empresa.moneda && linea.tipoCambio == null) {
        throw new ErrorValidacion(
          `Falta el tipo de cambio de ${monedaLinea} a ${empresa.moneda} para valorizar esta línea (la empresa opera en ${empresa.moneda})`
        );
      }
      const tipoCambio = linea.tipoCambio != null ? new Prisma.Decimal(linea.tipoCambio) : new Prisma.Decimal(1);
      if (tipoCambio.lte(0)) throw new ErrorValidacion("El tipo de cambio debe ser positivo");
      // Costo tal como fue facturado se conserva en recepcion_detalle; para valorizar
      // el inventario (movimientos y capas de costo) siempre se usa la moneda base
      // de la empresa, guardando moneda original y tipo de cambio para trazabilidad.
      const costoUnitarioBase = new Prisma.Decimal(linea.costoUnitario).times(tipoCambio);

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
          costoUnitario: costoUnitarioBase,
          fechaEfectiva: datos.fechaEfectiva,
        });

        await tx.capaCosto.create({
          data: {
            productoId: linea.productoId,
            loteId,
            costoUnitario: costoUnitarioBase,
            moneda: monedaLinea,
            tipoCambio: linea.tipoCambio != null ? tipoCambio : null,
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
