import { ModoPrecioVenta, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion, ErrorNoEncontrado } from "../../lib/errors.js";

type Tx = Prisma.TransactionClient;

function calcularPrecio(
  modo: ModoPrecioVenta,
  precioFijoClp: Prisma.Decimal | null,
  porcentajeMargen: Prisma.Decimal | null,
  valorReferenciaClp: Prisma.Decimal | null
): Prisma.Decimal | null {
  if (modo === "FIJO") return precioFijoClp;
  if (valorReferenciaClp == null || porcentajeMargen == null) return null;
  return valorReferenciaClp.times(new Prisma.Decimal(1).plus(porcentajeMargen.dividedBy(100)));
}

export async function listarPrecios(empresaId: string) {
  const productos = await prisma.producto.findMany({
    where: { empresaId },
    include: { precioVenta: true },
    orderBy: { codigo: "asc" },
  });
  return productos.map((p) => ({
    productoId: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    grupo: p.grupo,
    precio: p.precioVenta,
  }));
}

export interface DatosActualizarPrecio {
  modo: ModoPrecioVenta;
  precioFijoClp?: number | string;
  porcentajeMargen?: number | string;
}

/** Crea o actualiza la configuración de precio de un producto (modo fijo o porcentaje) y recalcula el precio resultante. */
export async function actualizarPrecio(productoId: string, empresaId: string, datos: DatosActualizarPrecio, usuarioId: string) {
  const producto = await prisma.producto.findFirst({ where: { id: productoId, empresaId } });
  if (!producto) throw new ErrorNoEncontrado("Producto no encontrado");

  if (datos.modo === "FIJO" && (datos.precioFijoClp == null || Number(datos.precioFijoClp) < 0)) {
    throw new ErrorValidacion("Debe indicar un precio fijo válido (mayor o igual a 0)");
  }
  if (datos.modo === "PORCENTAJE" && (datos.porcentajeMargen == null || Number(datos.porcentajeMargen) <= -100)) {
    throw new ErrorValidacion("Debe indicar un porcentaje de margen válido (mayor a -100)");
  }

  const existente = await prisma.precioVenta.findUnique({ where: { productoId } });
  const valorReferenciaClp = existente?.valorReferenciaClp ?? null;

  const precioFijoClp = datos.modo === "FIJO" ? new Prisma.Decimal(datos.precioFijoClp!) : existente?.precioFijoClp ?? null;
  const porcentajeMargen = datos.modo === "PORCENTAJE" ? new Prisma.Decimal(datos.porcentajeMargen!) : existente?.porcentajeMargen ?? null;
  const precioVentaCalculado = calcularPrecio(datos.modo, precioFijoClp, porcentajeMargen, valorReferenciaClp);

  return prisma.precioVenta.upsert({
    where: { productoId },
    update: { modo: datos.modo, precioFijoClp, porcentajeMargen, precioVentaCalculado, actualizadoPorId: usuarioId },
    create: {
      empresaId,
      productoId,
      modo: datos.modo,
      precioFijoClp,
      porcentajeMargen,
      valorReferenciaClp,
      valorReferenciaUsd: existente?.valorReferenciaUsd ?? null,
      precioVentaCalculado,
      actualizadoPorId: usuarioId,
    },
  });
}

/**
 * Actualiza el valor de referencia (declarado en la llegada más reciente) de
 * un producto y recalcula el precio si corresponde. Se invoca desde el
 * manejador de carga LLEGADA_PRODUCTOS, dentro de la misma transacción que
 * registra la llegada — nunca crea una fila de precio con un modo que el
 * usuario no eligió: si el producto no tiene configuración de precio
 * todavía, queda en PORCENTAJE (el valor por defecto del modelo) sin margen
 * definido, es decir, sin un precio de venta calculado hasta que alguien lo
 * configure en el mantenedor.
 */
export async function actualizarValorReferencia(
  tx: Tx,
  productoId: string,
  empresaId: string,
  valorClp: Prisma.Decimal | number | null | undefined,
  valorUsd: Prisma.Decimal | number | null | undefined
) {
  if (valorClp == null && valorUsd == null) return;

  const existente = await tx.precioVenta.findUnique({ where: { productoId } });
  const nuevoValorClp = valorClp != null ? new Prisma.Decimal(valorClp) : existente?.valorReferenciaClp ?? null;
  const nuevoValorUsd = valorUsd != null ? new Prisma.Decimal(valorUsd) : existente?.valorReferenciaUsd ?? null;
  const modo = existente?.modo ?? "PORCENTAJE";
  const precioVentaCalculado = calcularPrecio(modo, existente?.precioFijoClp ?? null, existente?.porcentajeMargen ?? null, nuevoValorClp);

  await tx.precioVenta.upsert({
    where: { productoId },
    update: { valorReferenciaClp: nuevoValorClp, valorReferenciaUsd: nuevoValorUsd, precioVentaCalculado },
    create: {
      empresaId,
      productoId,
      modo: "PORCENTAJE",
      valorReferenciaClp: nuevoValorClp,
      valorReferenciaUsd: nuevoValorUsd,
      precioVentaCalculado,
    },
  });
}
