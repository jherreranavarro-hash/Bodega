import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

function truncarADia(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/**
 * Acumula, por día, la demanda real (solicitada) y la efectivamente atendida
 * de un producto en una bodega. Es la base para pronósticos: nunca se infiere
 * demanda desde el saldo, solo desde hechos registrados (solicitudes y
 * despachos), evitando contar dos veces (sección 11 del encargo).
 */
export async function registrarDemandaSolicitada(tx: Tx, p: { productoId: string; bodegaId: string; fecha: Date; cantidad: Prisma.Decimal | number | string }) {
  const dia = truncarADia(p.fecha);
  const cantidad = new Prisma.Decimal(p.cantidad);
  const existente = await tx.demandaRegistrada.findUnique({ where: { productoId_bodegaId_fecha: { productoId: p.productoId, bodegaId: p.bodegaId, fecha: dia } } });
  const nuevaSolicitada = new Prisma.Decimal(existente?.cantidadSolicitada ?? 0).plus(cantidad);
  const atendida = new Prisma.Decimal(existente?.cantidadAtendida ?? 0);
  await tx.demandaRegistrada.upsert({
    where: { productoId_bodegaId_fecha: { productoId: p.productoId, bodegaId: p.bodegaId, fecha: dia } },
    create: { productoId: p.productoId, bodegaId: p.bodegaId, fecha: dia, cantidadSolicitada: cantidad, cantidadAtendida: 0, cantidadNoAtendida: cantidad },
    update: { cantidadSolicitada: nuevaSolicitada, cantidadNoAtendida: Prisma.Decimal.max(nuevaSolicitada.minus(atendida), 0) },
  });
}

export async function registrarDemandaAtendida(tx: Tx, p: { productoId: string; bodegaId: string; fecha: Date; cantidad: Prisma.Decimal | number | string }) {
  const dia = truncarADia(p.fecha);
  const cantidad = new Prisma.Decimal(p.cantidad);
  const existente = await tx.demandaRegistrada.findUnique({ where: { productoId_bodegaId_fecha: { productoId: p.productoId, bodegaId: p.bodegaId, fecha: dia } } });
  const solicitada = new Prisma.Decimal(existente?.cantidadSolicitada ?? 0);
  const nuevaAtendida = new Prisma.Decimal(existente?.cantidadAtendida ?? 0).plus(cantidad);
  await tx.demandaRegistrada.upsert({
    where: { productoId_bodegaId_fecha: { productoId: p.productoId, bodegaId: p.bodegaId, fecha: dia } },
    create: { productoId: p.productoId, bodegaId: p.bodegaId, fecha: dia, cantidadSolicitada: 0, cantidadAtendida: cantidad, cantidadNoAtendida: 0 },
    update: { cantidadAtendida: nuevaAtendida, cantidadNoAtendida: Prisma.Decimal.max(solicitada.minus(nuevaAtendida), 0) },
  });
}
