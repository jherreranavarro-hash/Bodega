import { Prisma, EstadoInventario, EstadoOperacion, EstadoReserva, TipoOperacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ErrorStockInsuficiente, ErrorValidacion } from "../../lib/errors.js";
import { verificarPeriodoAbierto } from "./periodos.service.js";

// Postgres trata cada NULL como distinto en comparaciones normales; para que
// "sin lote" y "sin serie" cuenten como un único valor de clave de negocio,
// tanto el índice de la base (ver migración saldo_business_key) como este
// servicio usan el mismo UUID centinela vía COALESCE.
const SENTINEL = "00000000-0000-0000-0000-000000000000";

export type ClaveSaldo = {
  productoId: string;
  ubicacionId: string;
  loteId?: string | null;
  serieId?: string | null;
  estadoInventario: EstadoInventario;
};

type Tx = Prisma.TransactionClient;

interface SaldoRow {
  id: string;
  cantidad_fisica: string;
}

/** Bloquea (FOR UPDATE) el saldo si existe; no lo crea. */
async function bloquearSaldoSiExiste(tx: Tx, clave: ClaveSaldo): Promise<SaldoRow | null> {
  const rows = await tx.$queryRaw<SaldoRow[]>`
    SELECT id, cantidad_fisica FROM saldos_inventario
    WHERE producto_id = ${clave.productoId}
      AND ubicacion_id = ${clave.ubicacionId}
      AND COALESCE(lote_id, ${SENTINEL}) = COALESCE(${clave.loteId ?? null}, ${SENTINEL})
      AND COALESCE(serie_id, ${SENTINEL}) = COALESCE(${clave.serieId ?? null}, ${SENTINEL})
      AND estado_inventario = ${clave.estadoInventario}::"EstadoInventario"
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** Bloquea el saldo y lo crea en cero si no existe (para incrementos). */
async function bloquearOCrearSaldo(tx: Tx, clave: ClaveSaldo): Promise<SaldoRow> {
  const existente = await bloquearSaldoSiExiste(tx, clave);
  if (existente) return existente;
  const creado = await tx.saldoInventario.create({
    data: {
      productoId: clave.productoId,
      ubicacionId: clave.ubicacionId,
      loteId: clave.loteId ?? null,
      serieId: clave.serieId ?? null,
      estadoInventario: clave.estadoInventario,
      cantidadFisica: 0,
    },
  });
  // La fila recién creada ya está bloqueada dentro de esta transacción.
  return { id: creado.id, cantidad_fisica: "0" };
}

export interface ParametrosMovimiento {
  operacionId: string;
  productoId: string;
  ubicacionOrigenId?: string | null;
  ubicacionDestinoId?: string | null;
  loteId?: string | null;
  serieId?: string | null;
  estadoInventario?: EstadoInventario;
  estadoInventarioOrigen?: EstadoInventario;
  cantidad: Prisma.Decimal | number | string;
  costoUnitario?: Prisma.Decimal | number | string | null;
  fechaEfectiva: Date;
  permitirNegativo?: boolean;
}

export interface ResultadoMovimiento {
  movimientoId: string;
  saldoOrigenId?: string;
  saldoDestinoId?: string;
}

/**
 * Primitiva única de escritura de inventario: crea un movimiento inmutable y
 * actualiza transaccionalmente el/los saldo(s) afectados. Nunca se invoca
 * fuera de una transacción (tx) para garantizar atomicidad movimiento+saldo.
 * cantidad es siempre una magnitud positiva; el signo lo determina qué de
 * ubicacionOrigenId/ubicacionDestinoId viene informado:
 *  - solo destino  -> entrada (recepción, ajuste positivo, apertura inicial)
 *  - solo origen   -> salida (despacho, ajuste negativo, baja)
 *  - origen+destino -> traslado/reclasificación (misma cantidad sale de un
 *    lado y entra en el otro, en la misma operación)
 */
export async function registrarMovimiento(tx: Tx, p: ParametrosMovimiento): Promise<ResultadoMovimiento> {
  const cantidad = new Prisma.Decimal(p.cantidad);
  if (cantidad.lte(0)) throw new ErrorValidacion("La cantidad de un movimiento debe ser positiva");
  if (!p.ubicacionOrigenId && !p.ubicacionDestinoId) {
    throw new ErrorValidacion("Un movimiento requiere ubicación de origen y/o destino");
  }

  const estadoDestino = p.estadoInventario ?? EstadoInventario.DISPONIBLE;
  const estadoOrigen = p.estadoInventarioOrigen ?? estadoDestino;

  let saldoOrigenId: string | undefined;
  if (p.ubicacionOrigenId) {
    const claveOrigen: ClaveSaldo = {
      productoId: p.productoId,
      ubicacionId: p.ubicacionOrigenId,
      loteId: p.loteId,
      serieId: p.serieId,
      estadoInventario: estadoOrigen,
    };
    const saldo = await bloquearSaldoSiExiste(tx, claveOrigen);
    const disponible = new Prisma.Decimal(saldo?.cantidad_fisica ?? 0);
    if (!p.permitirNegativo && disponible.lt(cantidad)) {
      throw new ErrorStockInsuficiente(
        `Stock insuficiente en la ubicación de origen: disponible ${disponible.toString()}, solicitado ${cantidad.toString()}`
      );
    }
    if (!saldo) {
      // Solo llega aquí si permitirNegativo=true y no existía saldo previo.
      const creado = await tx.saldoInventario.create({
        data: { ...claveOrigen, cantidadFisica: cantidad.neg() },
      });
      saldoOrigenId = creado.id;
    } else {
      await tx.saldoInventario.update({
        where: { id: saldo.id },
        data: { cantidadFisica: disponible.minus(cantidad) },
      });
      saldoOrigenId = saldo.id;
    }
  }

  let saldoDestinoId: string | undefined;
  if (p.ubicacionDestinoId) {
    const claveDestino: ClaveSaldo = {
      productoId: p.productoId,
      ubicacionId: p.ubicacionDestinoId,
      loteId: p.loteId,
      serieId: p.serieId,
      estadoInventario: estadoDestino,
    };
    const saldo = await bloquearOCrearSaldo(tx, claveDestino);
    const actual = new Prisma.Decimal(saldo.cantidad_fisica);
    await tx.saldoInventario.update({
      where: { id: saldo.id },
      data: { cantidadFisica: actual.plus(cantidad) },
    });
    saldoDestinoId = saldo.id;
  }

  const movimiento = await tx.movimientoInventario.create({
    data: {
      operacionId: p.operacionId,
      productoId: p.productoId,
      ubicacionOrigenId: p.ubicacionOrigenId ?? null,
      ubicacionDestinoId: p.ubicacionDestinoId ?? null,
      loteId: p.loteId ?? null,
      serieId: p.serieId ?? null,
      estadoInventario: estadoDestino,
      estadoInventarioOrigen: p.ubicacionOrigenId ? estadoOrigen : null,
      cantidad,
      costoUnitario: p.costoUnitario != null ? new Prisma.Decimal(p.costoUnitario) : null,
      fechaEfectiva: p.fechaEfectiva,
    },
  });

  return { movimientoId: movimiento.id, saldoOrigenId, saldoDestinoId };
}

export async function crearOperacion(
  tx: Tx,
  p: {
    empresaId: string;
    bodegaId: string;
    tipo: TipoOperacion;
    documentoOrigen?: string;
    fechaEfectiva: Date;
    usuarioId: string;
    autorizadoPorId?: string;
    estado?: EstadoOperacion;
    observacion?: string;
    /** Excepción explícita para registrar una corrección autorizada dentro de un período ya cerrado. */
    permitirPeriodoCerrado?: boolean;
  }
) {
  await verificarPeriodoAbierto(p.empresaId, p.fechaEfectiva, p.permitirPeriodoCerrado);

  return tx.operacionInventario.create({
    data: {
      empresaId: p.empresaId,
      bodegaId: p.bodegaId,
      tipo: p.tipo,
      estado: p.estado ?? EstadoOperacion.CONTABILIZADA,
      documentoOrigen: p.documentoOrigen,
      fechaEfectiva: p.fechaEfectiva,
      usuarioId: p.usuarioId,
      autorizadoPorId: p.autorizadoPorId,
      observacion: p.observacion,
    },
  });
}

// ---------------------------------------------------------------------------
// Reservas: un compromiso sobre stock DISPONIBLE, no una salida física.
// ---------------------------------------------------------------------------

export interface LineaReservaSolicitada {
  solicitudDetalleId: string;
  productoId: string;
  bodegaId: string;
  cantidad: Prisma.Decimal | number | string;
  /** true si el producto controla vencimiento: prioriza FEFO (vencimiento más próximo). */
  priorizarVencimiento?: boolean;
}

/**
 * Reserva `cantidad` unidades de un producto dentro de una bodega, bloqueando
 * los saldos candidatos (FOR UPDATE) antes de decidir, de modo que dos
 * solicitudes concurrentes no puedan comprometer las mismas unidades.
 * Todo o nada: si no hay stock libre suficiente, no se crea ninguna reserva.
 */
export async function crearReserva(tx: Tx, p: LineaReservaSolicitada) {
  const cantidadRequerida = new Prisma.Decimal(p.cantidad);
  if (cantidadRequerida.lte(0)) throw new ErrorValidacion("La cantidad a reservar debe ser positiva");

  // Bloquea, en orden determinístico (por id de saldo), todos los saldos
  // DISPONIBLE del producto en la bodega para evitar deadlocks entre
  // transacciones concurrentes que reservan sobre el mismo conjunto.
  const candidatos = await tx.$queryRaw<
    { id: string; cantidad_fisica: string; lote_id: string | null; fecha_vencimiento: Date | null }[]
  >`
    SELECT s.id, s.cantidad_fisica, s.lote_id, l.fecha_vencimiento
    FROM saldos_inventario s
    JOIN ubicaciones u ON u.id = s.ubicacion_id
    LEFT JOIN lotes l ON l.id = s.lote_id
    WHERE s.producto_id = ${p.productoId}
      AND u.bodega_id = ${p.bodegaId}
      AND s.estado_inventario = 'DISPONIBLE'
      AND s.cantidad_fisica > 0
    ORDER BY
      CASE WHEN ${p.priorizarVencimiento ?? false} THEN l.fecha_vencimiento END ASC NULLS LAST,
      s.id ASC
    FOR UPDATE OF s
  `;

  if (candidatos.length === 0) {
    throw new ErrorStockInsuficiente("No hay stock disponible para reservar en esta bodega");
  }

  // Reservas activas ya comprometidas sobre esos mismos saldos (se relee
  // dentro de la misma transacción, con los saldos ya bloqueados arriba).
  const saldoIds = candidatos.map((c) => c.id);
  const reservasActivas = await tx.reservaDetalle.groupBy({
    by: ["saldoId"],
    where: {
      saldoId: { in: saldoIds },
      reserva: { estado: { in: [EstadoReserva.ACTIVA, EstadoReserva.CONSUMIDA_PARCIAL] } },
    },
    _sum: { cantidad: true, cantidadConsumida: true },
  });
  const reservadoPorSaldo = new Map<string, Prisma.Decimal>();
  for (const r of reservasActivas) {
    const comprometido = new Prisma.Decimal(r._sum.cantidad ?? 0).minus(new Prisma.Decimal(r._sum.cantidadConsumida ?? 0));
    reservadoPorSaldo.set(r.saldoId, comprometido);
  }

  let restante = cantidadRequerida;
  const asignaciones: { saldoId: string; cantidad: Prisma.Decimal }[] = [];
  for (const c of candidatos) {
    if (restante.lte(0)) break;
    const fisico = new Prisma.Decimal(c.cantidad_fisica);
    const reservado = reservadoPorSaldo.get(c.id) ?? new Prisma.Decimal(0);
    const libre = fisico.minus(reservado);
    if (libre.lte(0)) continue;
    const aTomar = Prisma.Decimal.min(libre, restante);
    asignaciones.push({ saldoId: c.id, cantidad: aTomar });
    restante = restante.minus(aTomar);
  }

  if (restante.gt(0)) {
    throw new ErrorStockInsuficiente(
      `Stock libre insuficiente: faltan ${restante.toString()} unidades para completar la reserva`
    );
  }

  const reserva = await tx.reserva.create({
    data: {
      solicitudId: (await tx.solicitudSalidaDetalle.findUniqueOrThrow({ where: { id: p.solicitudDetalleId } }))
        .solicitudId,
      solicitudDetalleId: p.solicitudDetalleId,
      productoId: p.productoId,
      cantidad: cantidadRequerida,
      estado: EstadoReserva.ACTIVA,
      detalle: {
        create: asignaciones.map((a) => ({ saldoId: a.saldoId, cantidad: a.cantidad })),
      },
    },
    include: { detalle: true },
  });

  return reserva;
}

/** Libera (total o parcialmente) el remanente no consumido de una reserva. */
export async function liberarReserva(tx: Tx, reservaId: string) {
  const reserva = await tx.reserva.findUniqueOrThrow({ where: { id: reservaId }, include: { detalle: true } });
  await tx.reserva.update({ where: { id: reservaId }, data: { estado: EstadoReserva.LIBERADA } });
  return reserva;
}

export interface DisponibilidadProducto {
  productoId: string;
  bodegaId: string;
  stockFisicoTotal: Prisma.Decimal;
  stockUtilizable: Prisma.Decimal;
  stockReservado: Prisma.Decimal;
  stockLibre: Prisma.Decimal;
  stockBloqueado: Prisma.Decimal;
  stockCuarentena: Prisma.Decimal;
  stockTransito: Prisma.Decimal;
}

/** Disponibilidad calculada en vivo desde saldos_inventario + reservas activas. */
export async function calcularDisponibilidad(productoId: string, bodegaId: string): Promise<DisponibilidadProducto> {
  const saldos = await prisma.saldoInventario.findMany({
    where: { productoId, ubicacion: { bodegaId } },
    include: { reservasDetalle: { include: { reserva: true } } },
  });

  let total = new Prisma.Decimal(0);
  let utilizable = new Prisma.Decimal(0);
  let reservado = new Prisma.Decimal(0);
  let bloqueado = new Prisma.Decimal(0);
  let cuarentena = new Prisma.Decimal(0);
  let transito = new Prisma.Decimal(0);

  for (const s of saldos) {
    const cantidad = new Prisma.Decimal(s.cantidadFisica);
    total = total.plus(cantidad);
    if (s.estadoInventario === EstadoInventario.DISPONIBLE) {
      utilizable = utilizable.plus(cantidad);
      for (const rd of s.reservasDetalle) {
        if (rd.reserva.estado === EstadoReserva.ACTIVA || rd.reserva.estado === EstadoReserva.CONSUMIDA_PARCIAL) {
          reservado = reservado.plus(new Prisma.Decimal(rd.cantidad).minus(new Prisma.Decimal(rd.cantidadConsumida)));
        }
      }
    } else if (s.estadoInventario === EstadoInventario.BLOQUEADO) {
      bloqueado = bloqueado.plus(cantidad);
    } else if (s.estadoInventario === EstadoInventario.CUARENTENA) {
      cuarentena = cuarentena.plus(cantidad);
    } else if (s.estadoInventario === EstadoInventario.TRANSITO) {
      transito = transito.plus(cantidad);
    }
  }

  return {
    productoId,
    bodegaId,
    stockFisicoTotal: total,
    stockUtilizable: utilizable,
    stockReservado: reservado,
    stockLibre: utilizable.minus(reservado),
    stockBloqueado: bloqueado,
    stockCuarentena: cuarentena,
    stockTransito: transito,
  };
}
