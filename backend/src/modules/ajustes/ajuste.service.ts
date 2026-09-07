import { EstadoAjuste, EstadoConteo, Prisma, TipoOperacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { registrarMovimiento, crearOperacion } from "../inventario/inventario.service.js";
import { ErrorValidacion } from "../../lib/errors.js";

export interface DatosConteo {
  folio: string;
  bodegaId: string;
  tipo: "GENERAL" | "CICLICO";
  conteoCiego: boolean;
  responsableId: string;
  fechaCorte: Date;
  /** Líneas a contar: producto+ubicación(+lote/serie). La cantidad esperada se congela al planificar. */
  lineas: { productoId: string; ubicacionId: string; loteId?: string; serieId?: string }[];
}

export async function planificarConteo(datos: DatosConteo) {
  return prisma.$transaction(async (tx) => {
    const detalle = [];
    for (const l of datos.lineas) {
      const saldo = await tx.saldoInventario.findFirst({
        where: { productoId: l.productoId, ubicacionId: l.ubicacionId, loteId: l.loteId ?? null, serieId: l.serieId ?? null, estadoInventario: "DISPONIBLE" },
      });
      detalle.push({
        productoId: l.productoId,
        ubicacionId: l.ubicacionId,
        loteId: l.loteId,
        serieId: l.serieId,
        cantidadEsperada: saldo?.cantidadFisica ?? new Prisma.Decimal(0),
      });
    }
    return tx.conteo.create({
      data: {
        folio: datos.folio,
        bodegaId: datos.bodegaId,
        tipo: datos.tipo,
        conteoCiego: datos.conteoCiego,
        responsableId: datos.responsableId,
        fechaCorte: datos.fechaCorte,
        estado: EstadoConteo.EN_PROCESO,
        detalle: { create: detalle },
      },
      include: { detalle: true },
    });
  });
}

export async function registrarConteoFisico(conteoDetalleId: string, cantidadContada: number) {
  return prisma.conteoDetalle.update({ where: { id: conteoDetalleId }, data: { cantidadContada } });
}

/**
 * Genera un ajuste pendiente de aprobación a partir de las diferencias del
 * conteo. La diferencia NO modifica stock en este paso: solo lo hará
 * aprobarAjuste(). Exige motivo (y evidencia si el motivo lo requiere).
 */
export async function generarAjusteDesdeConteo(p: {
  conteoId: string;
  motivoId: string;
  solicitadoPorId: string;
  folio: string;
  evidenciaUrl?: string;
}) {
  const conteo = await prisma.conteo.findUniqueOrThrow({ where: { id: p.conteoId }, include: { detalle: true } });
  const motivo = await prisma.motivo.findUniqueOrThrow({ where: { id: p.motivoId } });
  if (motivo.requiereEvidencia && !p.evidenciaUrl) {
    throw new ErrorValidacion(`El motivo '${motivo.nombre}' exige evidencia adjunta`);
  }

  const pendientes = conteo.detalle.filter((d) => d.cantidadContada !== null);
  if (pendientes.some((d) => d.cantidadContada === null)) {
    throw new ErrorValidacion("Hay líneas del conteo sin registrar; regístrelas o márquelas como reconteo antes de ajustar");
  }
  const conDiferencia = pendientes.filter((d) => !new Prisma.Decimal(d.cantidadContada!).equals(new Prisma.Decimal(d.cantidadEsperada)));

  if (conDiferencia.length === 0) {
    await prisma.conteo.update({ where: { id: p.conteoId }, data: { estado: EstadoConteo.APROBADO } });
    return null;
  }

  const ajuste = await prisma.ajuste.create({
    data: {
      folio: p.folio,
      conteoId: p.conteoId,
      bodegaId: conteo.bodegaId,
      motivoId: p.motivoId,
      estado: EstadoAjuste.PENDIENTE_APROBACION,
      solicitadoPorId: p.solicitadoPorId,
      evidenciaUrl: p.evidenciaUrl,
      detalle: {
        create: conDiferencia.map((d) => ({
          productoId: d.productoId,
          ubicacionId: d.ubicacionId,
          loteId: d.loteId,
          serieId: d.serieId,
          cantidadEsperada: d.cantidadEsperada,
          cantidadContada: d.cantidadContada!,
          diferencia: new Prisma.Decimal(d.cantidadContada!).minus(new Prisma.Decimal(d.cantidadEsperada)),
        })),
      },
    },
    include: { detalle: true },
  });

  await prisma.conteo.update({ where: { id: p.conteoId }, data: { estado: EstadoConteo.PENDIENTE_APROBACION } });
  return ajuste;
}

/** Aprueba el ajuste y recién ahí aplica la diferencia como movimiento de inventario. */
export async function aprobarAjuste(ajusteId: string, empresaId: string, aprobadoPorId: string) {
  return prisma.$transaction(async (tx) => {
    const ajuste = await tx.ajuste.findUniqueOrThrow({ where: { id: ajusteId }, include: { detalle: true } });
    if (ajuste.estado !== EstadoAjuste.PENDIENTE_APROBACION) {
      throw new ErrorValidacion("El ajuste ya fue resuelto");
    }

    const operacion = await crearOperacion(tx, {
      empresaId,
      bodegaId: ajuste.bodegaId,
      tipo: TipoOperacion.AJUSTE,
      documentoOrigen: ajuste.folio,
      fechaEfectiva: new Date(),
      usuarioId: ajuste.solicitadoPorId,
      autorizadoPorId: aprobadoPorId,
    });

    for (const d of ajuste.detalle) {
      const diferencia = new Prisma.Decimal(d.diferencia);
      if (diferencia.eq(0)) continue;
      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: d.productoId,
        ubicacionDestinoId: diferencia.gt(0) ? d.ubicacionId : undefined,
        ubicacionOrigenId: diferencia.lt(0) ? d.ubicacionId : undefined,
        loteId: d.loteId ?? undefined,
        serieId: d.serieId ?? undefined,
        cantidad: diferencia.abs(),
        fechaEfectiva: new Date(),
        permitirNegativo: false,
      });
    }

    await tx.conteo.update({ where: { id: ajuste.conteoId! }, data: { estado: EstadoConteo.APROBADO } }).catch(() => undefined);

    return tx.ajuste.update({
      where: { id: ajusteId },
      data: { estado: EstadoAjuste.APROBADO, aprobadoPorId, operacionId: operacion.id },
      include: { detalle: true },
    });
  });
}

export async function rechazarAjuste(ajusteId: string, aprobadoPorId: string) {
  return prisma.ajuste.update({ where: { id: ajusteId }, data: { estado: EstadoAjuste.RECHAZADO, aprobadoPorId } });
}
