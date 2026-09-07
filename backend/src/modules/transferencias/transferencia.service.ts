import { EstadoInventario, EstadoTransferencia, Prisma, TipoOperacion, TipoUbicacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { registrarMovimiento, crearOperacion } from "../inventario/inventario.service.js";
import { ErrorValidacion } from "../../lib/errors.js";

type Tx = Prisma.TransactionClient;

/** Ubicación técnica de tránsito de una bodega (una por bodega, autoprovisionada). */
async function obtenerUbicacionTransito(tx: Tx, bodegaId: string) {
  const existente = await tx.ubicacion.findFirst({ where: { bodegaId, tipo: TipoUbicacion.TRANSITO } });
  if (existente) return existente;
  return tx.ubicacion.create({
    data: { bodegaId, codigo: "TRANSITO", nombre: "Tránsito entre bodegas", tipo: TipoUbicacion.TRANSITO },
  });
}

export interface LineaTransferencia {
  productoId: string;
  ubicacionOrigenId: string;
  cantidad: number | string;
}

export interface DatosCrearTransferencia {
  empresaId: string;
  folio: string;
  bodegaOrigenId: string;
  bodegaDestinoId: string;
  usuarioId: string;
  fechaEfectiva: Date;
  transportistaId?: string;
  detalle: LineaTransferencia[];
}

/**
 * Despacha la transferencia: la mercadería deja de estar disponible en
 * origen y queda identificada en tránsito (estado TRANSITO en una ubicación
 * técnica de la bodega destino). Todavía no aumenta la existencia utilizable
 * de destino — eso solo ocurre al recibir — evitando el doble conteo.
 */
export async function despacharTransferencia(datos: DatosCrearTransferencia) {
  if (datos.bodegaOrigenId === datos.bodegaDestinoId) {
    throw new ErrorValidacion("La bodega de origen y destino no pueden ser la misma");
  }
  return prisma.$transaction(async (tx) => {
    const origenBodega = await tx.bodega.findUniqueOrThrow({ where: { id: datos.bodegaOrigenId } });
    const destinoBodega = await tx.bodega.findUniqueOrThrow({ where: { id: datos.bodegaDestinoId } });
    if (origenBodega.empresaId !== destinoBodega.empresaId) {
      throw new ErrorValidacion("No se puede transferir directamente entre empresas distintas; use un proceso de venta/compra intercompañía");
    }

    const ubicacionTransito = await obtenerUbicacionTransito(tx, datos.bodegaDestinoId);

    const operacion = await crearOperacion(tx, {
      empresaId: datos.empresaId,
      bodegaId: datos.bodegaOrigenId,
      tipo: TipoOperacion.TRANSFERENCIA_SALIDA,
      documentoOrigen: datos.folio,
      fechaEfectiva: datos.fechaEfectiva,
      usuarioId: datos.usuarioId,
    });

    const transferencia = await tx.transferencia.create({
      data: {
        folio: datos.folio,
        bodegaOrigenId: datos.bodegaOrigenId,
        bodegaDestinoId: datos.bodegaDestinoId,
        transportistaId: datos.transportistaId,
        estado: EstadoTransferencia.EN_TRANSITO,
        fechaDespacho: datos.fechaEfectiva,
        usuarioId: datos.usuarioId,
        operacionSalidaId: operacion.id,
        detalle: {
          create: datos.detalle.map((l) => ({ productoId: l.productoId, cantidadEnviada: new Prisma.Decimal(l.cantidad) })),
        },
      },
      include: { detalle: true },
    });

    for (const linea of datos.detalle) {
      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: linea.productoId,
        ubicacionOrigenId: linea.ubicacionOrigenId,
        ubicacionDestinoId: ubicacionTransito.id,
        estadoInventario: EstadoInventario.TRANSITO,
        estadoInventarioOrigen: EstadoInventario.DISPONIBLE,
        cantidad: linea.cantidad,
        fechaEfectiva: datos.fechaEfectiva,
      });
    }

    return transferencia;
  });
}

export interface LineaRecepcionTransferencia {
  transferenciaDetalleId: string;
  productoId: string;
  cantidad: number | string;
  ubicacionDestinoId: string;
}

/** Recibe (total o parcial) una transferencia: sale de tránsito y entra a la ubicación final de destino. */
export async function recibirTransferencia(p: {
  transferenciaId: string;
  usuarioId: string;
  fechaEfectiva: Date;
  detalle: LineaRecepcionTransferencia[];
}) {
  return prisma.$transaction(async (tx) => {
    const transferencia = await tx.transferencia.findUniqueOrThrow({ where: { id: p.transferenciaId }, include: { detalle: true } });
    const ubicacionTransito = await obtenerUbicacionTransito(tx, transferencia.bodegaDestinoId);

    const operacion = await crearOperacion(tx, {
      empresaId: (await tx.bodega.findUniqueOrThrow({ where: { id: transferencia.bodegaDestinoId } })).empresaId,
      bodegaId: transferencia.bodegaDestinoId,
      tipo: TipoOperacion.TRANSFERENCIA_ENTRADA,
      documentoOrigen: transferencia.folio,
      fechaEfectiva: p.fechaEfectiva,
      usuarioId: p.usuarioId,
    });

    for (const linea of p.detalle) {
      const detalleOriginal = transferencia.detalle.find((d) => d.id === linea.transferenciaDetalleId);
      if (!detalleOriginal) throw new ErrorValidacion("La línea de transferencia no existe en este documento");
      const yaRecibido = new Prisma.Decimal(detalleOriginal.cantidadRecibida);
      const pendiente = new Prisma.Decimal(detalleOriginal.cantidadEnviada).minus(yaRecibido);
      const cantidad = new Prisma.Decimal(linea.cantidad);
      if (cantidad.gt(pendiente)) {
        throw new ErrorValidacion(`La cantidad a recibir (${cantidad}) excede lo pendiente (${pendiente})`);
      }

      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: linea.productoId,
        ubicacionOrigenId: ubicacionTransito.id,
        ubicacionDestinoId: linea.ubicacionDestinoId,
        estadoInventario: EstadoInventario.DISPONIBLE,
        estadoInventarioOrigen: EstadoInventario.TRANSITO,
        cantidad,
        fechaEfectiva: p.fechaEfectiva,
      });

      await tx.transferenciaDetalle.update({
        where: { id: linea.transferenciaDetalleId },
        data: { cantidadRecibida: yaRecibido.plus(cantidad) },
      });
    }

    const detalleActualizado = await tx.transferenciaDetalle.findMany({ where: { transferenciaId: p.transferenciaId } });
    const completa = detalleActualizado.every((d) => new Prisma.Decimal(d.cantidadRecibida).gte(new Prisma.Decimal(d.cantidadEnviada)));
    const algunaRecibida = detalleActualizado.some((d) => new Prisma.Decimal(d.cantidadRecibida).gt(0));

    return tx.transferencia.update({
      where: { id: p.transferenciaId },
      data: {
        estado: completa ? EstadoTransferencia.RECIBIDA_TOTAL : algunaRecibida ? EstadoTransferencia.RECIBIDA_PARCIAL : undefined,
        fechaRecepcion: completa ? p.fechaEfectiva : undefined,
        operacionEntradaId: operacion.id,
      },
      include: { detalle: true },
    });
  });
}
