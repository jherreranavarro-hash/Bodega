import { EstadoDespacho, EstadoReserva, MetodoValorizacion, Prisma, TipoOperacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { registrarMovimiento, crearOperacion } from "../inventario/inventario.service.js";
import { ErrorValidacion, ErrorStockInsuficiente } from "../../lib/errors.js";

export interface LineaDespacho {
  productoId: string;
  reservaDetalleId?: string;
  /** Requerido si no viene reservaDetalleId (despacho directo sin reserva previa). */
  ubicacionOrigenId?: string;
  cantidad: number | string;
}

export interface DatosDespacho {
  bodegaId: string;
  folio: string;
  empresaId: string;
  preparacionId?: string;
  clienteId?: string;
  transportistaId?: string;
  referenciaComercial?: string;
  fechaEfectiva: Date;
  usuarioId: string;
  detalle: LineaDespacho[];
}

/** Consume capas de costo FIFO y retorna el costo unitario promedio ponderado del retiro. */
async function consumirCostoFifo(tx: Prisma.TransactionClient, productoId: string, cantidad: Prisma.Decimal) {
  const capas = await tx.$queryRaw<{ id: string; cantidad_disponible: string; costo_unitario: string }[]>`
    SELECT id, cantidad_disponible, costo_unitario FROM capas_costo
    WHERE producto_id = ${productoId} AND cantidad_disponible > 0
    ORDER BY creado_en ASC
    FOR UPDATE
  `;
  let restante = cantidad;
  let costoTotal = new Prisma.Decimal(0);
  for (const capa of capas) {
    if (restante.lte(0)) break;
    const disponible = new Prisma.Decimal(capa.cantidad_disponible);
    const aTomar = Prisma.Decimal.min(disponible, restante);
    await tx.capaCosto.update({
      where: { id: capa.id },
      data: { cantidadDisponible: disponible.minus(aTomar) },
    });
    costoTotal = costoTotal.plus(aTomar.times(new Prisma.Decimal(capa.costo_unitario)));
    restante = restante.minus(aTomar);
  }
  // Si no hay capas suficientes (dato histórico/carga inicial sin costo), el
  // costo de lo no cubierto queda indeterminado en vez de asumirse cero.
  const cubierta = cantidad.minus(restante);
  return { costoTotal, costoPromedio: cubierta.gt(0) ? costoTotal.div(cubierta) : null, sinCostoCompleto: restante.gt(0) };
}

/**
 * Contabiliza un despacho. Si la línea trae reservaDetalleId, la salida y el
 * consumo de la reserva se registran en la misma transacción (la reserva es
 * un compromiso, no una salida física hasta este momento). Impide despachar
 * desde saldos que no estén en estado DISPONIBLE (bloqueados, en cuarentena
 * o vencidos quedan en otros estados y no aparecen aquí).
 */
export async function contabilizarDespacho(datos: DatosDespacho) {
  if (datos.detalle.length === 0) throw new ErrorValidacion("El despacho no tiene líneas");

  return prisma.$transaction(async (tx) => {
    const operacion = await crearOperacion(tx, {
      empresaId: datos.empresaId,
      bodegaId: datos.bodegaId,
      tipo: TipoOperacion.DESPACHO,
      documentoOrigen: datos.folio,
      fechaEfectiva: datos.fechaEfectiva,
      usuarioId: datos.usuarioId,
    });

    const despacho = await tx.despacho.create({
      data: {
        folio: datos.folio,
        bodegaId: datos.bodegaId,
        preparacionId: datos.preparacionId,
        clienteId: datos.clienteId,
        transportistaId: datos.transportistaId,
        referenciaComercial: datos.referenciaComercial,
        estado: EstadoDespacho.CONTABILIZADO,
        fechaEfectiva: datos.fechaEfectiva,
        usuarioId: datos.usuarioId,
        operacionId: operacion.id,
      },
    });

    for (const linea of datos.detalle) {
      const cantidad = new Prisma.Decimal(linea.cantidad);
      if (cantidad.lte(0)) throw new ErrorValidacion("La cantidad despachada debe ser positiva");

      let ubicacionOrigenId = linea.ubicacionOrigenId;
      let loteId: string | undefined;
      let serieId: string | undefined;

      if (linea.reservaDetalleId) {
        const rd = await tx.reservaDetalle.findUniqueOrThrow({
          where: { id: linea.reservaDetalleId },
          include: { reserva: true, saldo: true },
        });
        const remanente = new Prisma.Decimal(rd.cantidad).minus(new Prisma.Decimal(rd.cantidadConsumida));
        if (cantidad.gt(remanente)) {
          throw new ErrorStockInsuficiente(
            `La cantidad a despachar (${cantidad.toString()}) excede el remanente reservado (${remanente.toString()})`
          );
        }
        ubicacionOrigenId = rd.saldo.ubicacionId;
        loteId = rd.saldo.loteId ?? undefined;
        serieId = rd.saldo.serieId ?? undefined;

        const nuevoConsumido = new Prisma.Decimal(rd.cantidadConsumida).plus(cantidad);
        await tx.reservaDetalle.update({ where: { id: rd.id }, data: { cantidadConsumida: nuevoConsumido } });

        const detallesReserva = await tx.reservaDetalle.findMany({ where: { reservaId: rd.reservaId } });
        const totalReservado = detallesReserva.reduce((acc, d) => acc.plus(new Prisma.Decimal(d.cantidad)), new Prisma.Decimal(0));
        const totalConsumido = detallesReserva.reduce(
          (acc, d) => acc.plus(d.id === rd.id ? nuevoConsumido : new Prisma.Decimal(d.cantidadConsumida)),
          new Prisma.Decimal(0)
        );
        await tx.reserva.update({
          where: { id: rd.reservaId },
          data: {
            estado: totalConsumido.gte(totalReservado) ? EstadoReserva.CONSUMIDA_TOTAL : EstadoReserva.CONSUMIDA_PARCIAL,
          },
        });
      }

      if (!ubicacionOrigenId) {
        throw new ErrorValidacion("Debe indicar reservaDetalleId o ubicacionOrigenId para el despacho");
      }

      const producto = await tx.producto.findUniqueOrThrow({ where: { id: linea.productoId } });
      const { costoPromedio } =
        producto.metodoValorizacion === MetodoValorizacion.FIFO
          ? await consumirCostoFifo(tx, linea.productoId, cantidad)
          : { costoPromedio: null };

      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: linea.productoId,
        ubicacionOrigenId,
        loteId,
        serieId,
        cantidad,
        costoUnitario: costoPromedio,
        fechaEfectiva: datos.fechaEfectiva,
      });

      await tx.despachoDetalle.create({
        data: {
          despachoId: despacho.id,
          productoId: linea.productoId,
          reservaDetalleId: linea.reservaDetalleId,
          ubicacionOrigenId,
          loteId,
          serieId,
          cantidad,
        },
      });
    }

    return despacho;
  });
}
