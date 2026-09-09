import { EstadoDevolucion, EstadoInventario, Prisma, TipoOperacion, TipoUbicacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { registrarMovimiento, crearOperacion } from "../inventario/inventario.service.js";
import { obtenerUbicacionTecnica } from "../inventario/ubicaciones-tecnicas.js";
import { ErrorPermiso, ErrorValidacion } from "../../lib/errors.js";

function obtenerUbicacionCuarentena(tx: Prisma.TransactionClient, bodegaId: string) {
  return obtenerUbicacionTecnica(tx, bodegaId, TipoUbicacion.CUARENTENA, "CUARENTENA", "Cuarentena de devoluciones");
}

export interface LineaDevolucion {
  productoId: string;
  cantidad: number | string;
  loteId?: string;
  serieId?: string;
}

export interface DatosDevolucion {
  empresaId: string;
  folio: string;
  bodegaId: string;
  motivoId: string;
  despachoOrigenId?: string;
  usuarioId: string;
  fechaEfectiva: Date;
  detalle: LineaDevolucion[];
}

/**
 * Registra el ingreso físico de una devolución. La mercadería entra a la
 * ubicación de cuarentena de la bodega (estado CUARENTENA): queda contada en
 * el stock físico total, pero NUNCA en el stock utilizable/disponible hasta
 * que una resolución explícita lo autorice (sección 9 del encargo).
 */
export async function registrarIngresoDevolucion(datos: DatosDevolucion) {
  if (datos.detalle.length === 0) throw new ErrorValidacion("La devolución no tiene líneas");

  return prisma.$transaction(async (tx) => {
    const cuarentena = await obtenerUbicacionCuarentena(tx, datos.bodegaId);

    const operacion = await crearOperacion(tx, {
      empresaId: datos.empresaId,
      bodegaId: datos.bodegaId,
      tipo: TipoOperacion.DEVOLUCION,
      documentoOrigen: datos.folio,
      fechaEfectiva: datos.fechaEfectiva,
      usuarioId: datos.usuarioId,
    });

    const devolucion = await tx.devolucion.create({
      data: {
        folio: datos.folio,
        despachoOrigenId: datos.despachoOrigenId,
        bodegaId: datos.bodegaId,
        motivoId: datos.motivoId,
        estado: EstadoDevolucion.PENDIENTE_INSPECCION,
        usuarioId: datos.usuarioId,
        operacionIngresoId: operacion.id,
        detalle: {
          create: datos.detalle.map((l) => ({
            productoId: l.productoId,
            cantidad: new Prisma.Decimal(l.cantidad),
            loteId: l.loteId,
            serieId: l.serieId,
          })),
        },
      },
      include: { detalle: true },
    });

    for (const linea of datos.detalle) {
      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: linea.productoId,
        ubicacionDestinoId: cuarentena.id,
        loteId: linea.loteId,
        serieId: linea.serieId,
        estadoInventario: EstadoInventario.CUARENTENA,
        cantidad: linea.cantidad,
        fechaEfectiva: datos.fechaEfectiva,
      });
    }

    return devolucion;
  });
}

export type ResolucionDevolucion = "REINGRESO_DISPONIBLE" | "CUARENTENA" | "BAJA";

export interface DatosResolucion {
  detalleId: string;
  resolucion: ResolucionDevolucion;
  resueltoPorId: string;
  fechaEfectiva: Date;
  /** Requerido solo si resolucion = REINGRESO_DISPONIBLE. */
  ubicacionDestinoId?: string;
  /** Requerido solo si resolucion = BAJA (motivo de categoría BAJA). */
  motivoResolucionId?: string;
  evidenciaUrl?: string;
}

/**
 * Resuelve una línea de devolución. Cada merma/baja exige motivo, evidencia
 * (si el motivo la requiere), responsable y autorización (sección 9). Quien
 * registró la devolución no puede resolverla (separación de funciones).
 */
export async function resolverDevolucionDetalle(datos: DatosResolucion) {
  return prisma.$transaction(async (tx) => {
    const detalle = await tx.devolucionDetalle.findUniqueOrThrow({
      where: { id: datos.detalleId },
      include: { devolucion: true },
    });
    if (detalle.resolucion) throw new ErrorValidacion("Esta línea ya fue resuelta");
    if (detalle.devolucion.usuarioId === datos.resueltoPorId) {
      throw new ErrorPermiso("Quien registró la devolución no puede resolverla");
    }

    const empresaId = (await tx.bodega.findUniqueOrThrow({ where: { id: detalle.devolucion.bodegaId } })).empresaId;
    const cuarentena = await obtenerUbicacionCuarentena(tx, detalle.devolucion.bodegaId);
    const operacion = await crearOperacion(tx, {
      empresaId,
      bodegaId: detalle.devolucion.bodegaId,
      tipo: TipoOperacion.DEVOLUCION,
      documentoOrigen: `${detalle.devolucion.folio}-RESOLUCION`,
      fechaEfectiva: datos.fechaEfectiva,
      usuarioId: detalle.devolucion.usuarioId,
      autorizadoPorId: datos.resueltoPorId,
    });

    if (datos.resolucion === "BAJA") {
      if (!datos.motivoResolucionId) throw new ErrorValidacion("La baja de una devolución exige un motivo");
      const motivo = await tx.motivo.findUniqueOrThrow({ where: { id: datos.motivoResolucionId } });
      if (motivo.requiereEvidencia && !datos.evidenciaUrl) {
        throw new ErrorValidacion(`El motivo '${motivo.nombre}' exige evidencia adjunta`);
      }
      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: detalle.productoId,
        ubicacionOrigenId: cuarentena.id,
        loteId: detalle.loteId ?? undefined,
        serieId: detalle.serieId ?? undefined,
        estadoInventario: EstadoInventario.CUARENTENA,
        cantidad: detalle.cantidad,
        fechaEfectiva: datos.fechaEfectiva,
      });
    } else if (datos.resolucion === "REINGRESO_DISPONIBLE") {
      if (!datos.ubicacionDestinoId) throw new ErrorValidacion("El reingreso a disponible exige una ubicación de destino");
      await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: detalle.productoId,
        ubicacionOrigenId: cuarentena.id,
        ubicacionDestinoId: datos.ubicacionDestinoId,
        loteId: detalle.loteId ?? undefined,
        serieId: detalle.serieId ?? undefined,
        estadoInventarioOrigen: EstadoInventario.CUARENTENA,
        estadoInventario: EstadoInventario.DISPONIBLE,
        cantidad: detalle.cantidad,
        fechaEfectiva: datos.fechaEfectiva,
      });
    } else if (datos.resolucion !== "CUARENTENA") {
      throw new ErrorValidacion(`Resolución no reconocida: ${datos.resolucion}`);
    }
    // CUARENTENA: se deja explícitamente donde está; no genera movimiento nuevo.

    const detalleResuelto = await tx.devolucionDetalle.update({
      where: { id: datos.detalleId },
      data: {
        resolucion: datos.resolucion,
        ubicacionDestinoId: datos.ubicacionDestinoId,
        motivoResolucionId: datos.motivoResolucionId,
        evidenciaUrl: datos.evidenciaUrl,
        resueltoPorId: datos.resueltoPorId,
        operacionResolucionId: operacion.id,
        resueltoEn: datos.fechaEfectiva,
      },
    });

    const todasLasLineas = await tx.devolucionDetalle.findMany({ where: { devolucionId: detalle.devolucionId } });
    if (todasLasLineas.every((d) => d.resolucion !== null)) {
      await tx.devolucion.update({ where: { id: detalle.devolucionId }, data: { estado: EstadoDevolucion.RESUELTA } });
    }

    return detalleResuelto;
  });
}
