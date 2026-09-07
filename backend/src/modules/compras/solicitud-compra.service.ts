import { EstadoDocumentoCompra, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { calcularDisponibilidad } from "../inventario/inventario.service.js";
import { ErrorPermiso, ErrorValidacion } from "../../lib/errors.js";

export interface LineaSolicitudCompra {
  productoId: string;
  cantidad: number | string;
  unidadId: string;
  bodegaDestinoId: string;
  fechaRequerida?: Date;
}

export interface DatosSolicitudCompra {
  empresaId: string;
  folio: string;
  proveedorSugeridoId?: string;
  solicitanteId: string;
  origen?: "MANUAL" | "ALERTA_REPOSICION";
  detalle: LineaSolicitudCompra[];
}

/** Crea una solicitud de compra pendiente de aprobación (nunca se genera ya aprobada). */
export async function crearSolicitudCompra(datos: DatosSolicitudCompra) {
  if (datos.detalle.length === 0) throw new ErrorValidacion("La solicitud de compra no tiene líneas");
  return prisma.solicitudCompra.create({
    data: {
      empresaId: datos.empresaId,
      folio: datos.folio,
      proveedorSugeridoId: datos.proveedorSugeridoId,
      solicitanteId: datos.solicitanteId,
      origen: datos.origen ?? "MANUAL",
      estado: EstadoDocumentoCompra.PENDIENTE_APROBACION,
      detalle: { create: datos.detalle.map((l) => ({ ...l, cantidad: new Prisma.Decimal(l.cantidad) })) },
    },
    include: { detalle: true },
  });
}

/**
 * Genera una solicitud de compra a partir de la alerta de bajo punto de
 * reposición de un producto/bodega, respetando cantidad mínima de compra y
 * múltiplo de pedido del producto (sección 11 del encargo). Falla si el
 * producto no está realmente bajo su punto de reposición en ese momento.
 */
export async function generarSolicitudDesdeReposicion(p: { productoId: string; bodegaId: string; solicitanteId: string; folio: string }) {
  const parametro = await prisma.parametroReposicion.findUniqueOrThrow({
    where: { productoId_bodegaId: { productoId: p.productoId, bodegaId: p.bodegaId } },
    include: { producto: true },
  });
  const disponibilidad = await calcularDisponibilidad(p.productoId, p.bodegaId);
  const demandaDiaria = new Prisma.Decimal(parametro.demandaDiariaEstimada ?? 0);
  const puntoReposicion = demandaDiaria.times(parametro.plazoReposicionDias).plus(new Prisma.Decimal(parametro.stockSeguridad));

  if (disponibilidad.stockLibre.gte(puntoReposicion)) {
    throw new ErrorValidacion("Este producto no está bajo su punto de reposición en esta bodega; no corresponde generar una solicitud");
  }

  let cantidadSugerida = puntoReposicion.minus(disponibilidad.stockLibre);
  if (parametro.producto.cantidadMinimaCompra && cantidadSugerida.lt(parametro.producto.cantidadMinimaCompra)) {
    cantidadSugerida = new Prisma.Decimal(parametro.producto.cantidadMinimaCompra);
  }
  if (parametro.producto.multiploPedido) {
    const multiplo = new Prisma.Decimal(parametro.producto.multiploPedido);
    const veces = cantidadSugerida.div(multiplo).ceil();
    cantidadSugerida = veces.times(multiplo);
  }

  const proveedorPreferente = await prisma.productoProveedor.findFirst({
    where: { productoId: p.productoId, esPreferente: true, activo: true },
  });

  return crearSolicitudCompra({
    empresaId: parametro.producto.empresaId,
    folio: p.folio,
    proveedorSugeridoId: proveedorPreferente?.proveedorId,
    solicitanteId: p.solicitanteId,
    origen: "ALERTA_REPOSICION",
    detalle: [
      {
        productoId: p.productoId,
        cantidad: cantidadSugerida.toString(),
        unidadId: parametro.producto.unidadBaseId,
        bodegaDestinoId: p.bodegaId,
      },
    ],
  });
}

/** Aprueba la solicitud. Quien la solicitó no puede aprobarla (separación de funciones). */
export async function aprobarSolicitudCompra(solicitudId: string, aprobadorId: string) {
  const solicitud = await prisma.solicitudCompra.findUniqueOrThrow({ where: { id: solicitudId } });
  if (solicitud.estado !== EstadoDocumentoCompra.PENDIENTE_APROBACION) {
    throw new ErrorValidacion("La solicitud no está pendiente de aprobación");
  }
  if (solicitud.solicitanteId === aprobadorId) {
    throw new ErrorPermiso("Quien solicita una compra no puede aprobarla");
  }
  return prisma.solicitudCompra.update({ where: { id: solicitudId }, data: { estado: EstadoDocumentoCompra.APROBADA } });
}

export async function rechazarSolicitudCompra(solicitudId: string, aprobadorId: string) {
  const solicitud = await prisma.solicitudCompra.findUniqueOrThrow({ where: { id: solicitudId } });
  if (solicitud.estado !== EstadoDocumentoCompra.PENDIENTE_APROBACION) {
    throw new ErrorValidacion("La solicitud no está pendiente de aprobación");
  }
  if (solicitud.solicitanteId === aprobadorId) {
    throw new ErrorPermiso("Quien solicita una compra no puede rechazarla");
  }
  return prisma.solicitudCompra.update({ where: { id: solicitudId }, data: { estado: EstadoDocumentoCompra.RECHAZADA } });
}

export interface LineaConversion {
  solicitudDetalleId: string;
  costoUnitarioPactado: number | string;
}

/** Convierte una solicitud APROBADA en una orden de compra a un proveedor. Solo puede convertirse una vez. */
export async function convertirEnOrdenCompra(p: {
  solicitudId: string;
  folioOrdenCompra: string;
  proveedorId: string;
  fechaCompromisoOriginal?: Date;
  costos: LineaConversion[];
}) {
  return prisma.$transaction(async (tx) => {
    const solicitud = await tx.solicitudCompra.findUniqueOrThrow({
      where: { id: p.solicitudId },
      include: { detalle: true, ordenesCompra: true },
    });
    if (solicitud.estado !== EstadoDocumentoCompra.APROBADA) {
      throw new ErrorValidacion("Solo una solicitud aprobada puede convertirse en orden de compra");
    }
    if (solicitud.ordenesCompra.length > 0) {
      throw new ErrorValidacion("Esta solicitud ya fue convertida en una orden de compra");
    }

    const detalle = solicitud.detalle.map((d) => {
      const costo = p.costos.find((c) => c.solicitudDetalleId === d.id);
      if (!costo) throw new ErrorValidacion(`Falta el costo pactado para la línea de producto ${d.productoId}`);
      return {
        productoId: d.productoId,
        unidadId: d.unidadId,
        cantidadPedida: d.cantidad,
        costoUnitarioPactado: new Prisma.Decimal(costo.costoUnitarioPactado),
      };
    });

    return tx.ordenCompra.create({
      data: {
        empresaId: solicitud.empresaId,
        folio: p.folioOrdenCompra,
        proveedorId: p.proveedorId,
        solicitudCompraId: solicitud.id,
        estado: EstadoDocumentoCompra.APROBADA,
        fechaCompromisoOriginal: p.fechaCompromisoOriginal,
        fechaCompromisoActual: p.fechaCompromisoOriginal,
        detalle: { create: detalle },
      },
      include: { detalle: true },
    });
  });
}
