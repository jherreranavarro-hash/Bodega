import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { calcularDisponibilidad } from "../inventario/inventario.service.js";

/**
 * Productos bajo su punto de reposición en una bodega:
 * punto_reposicion = demanda_diaria_estimada * plazo_reposicion_dias + stock_seguridad
 * Cada fila expone los documentos fuente (parámetro y saldo) que explican el resultado.
 */
export async function productosBajoPuntoReposicion(empresaId: string, bodegaId?: string) {
  const parametros = await prisma.parametroReposicion.findMany({
    where: { activo: true, bodega: { empresaId, id: bodegaId } },
    include: { producto: true, bodega: true },
  });

  const resultados = [];
  for (const p of parametros) {
    const disponibilidad = await calcularDisponibilidad(p.productoId, p.bodegaId);
    const demandaDiaria = new Prisma.Decimal(p.demandaDiariaEstimada ?? 0);
    const puntoReposicion = demandaDiaria.times(p.plazoReposicionDias).plus(new Prisma.Decimal(p.stockSeguridad));
    if (disponibilidad.stockLibre.lt(puntoReposicion)) {
      resultados.push({
        productoId: p.productoId,
        productoCodigo: p.producto.codigo,
        productoNombre: p.producto.nombre,
        bodegaId: p.bodegaId,
        bodegaCodigo: p.bodega.codigo,
        stockLibre: disponibilidad.stockLibre.toString(),
        puntoReposicion: puntoReposicion.toString(),
        stockMinimo: p.stockMinimo.toString(),
        stockSeguridad: p.stockSeguridad.toString(),
        plazoReposicionDias: p.plazoReposicionDias,
        faltante: puntoReposicion.minus(disponibilidad.stockLibre).toString(),
      });
    }
  }
  return resultados;
}

/** Sobrestock: stock utilizable muy por sobre el máximo configurado. */
export async function productosConSobrestock(empresaId: string, bodegaId?: string) {
  const parametros = await prisma.parametroReposicion.findMany({
    where: { activo: true, stockMaximo: { not: null }, bodega: { empresaId, id: bodegaId } },
    include: { producto: true, bodega: true },
  });
  const resultados = [];
  for (const p of parametros) {
    const disponibilidad = await calcularDisponibilidad(p.productoId, p.bodegaId);
    if (p.stockMaximo && disponibilidad.stockUtilizable.gt(new Prisma.Decimal(p.stockMaximo))) {
      resultados.push({
        productoId: p.productoId,
        productoCodigo: p.producto.codigo,
        bodegaId: p.bodegaId,
        stockUtilizable: disponibilidad.stockUtilizable.toString(),
        stockMaximo: p.stockMaximo.toString(),
        excedente: disponibilidad.stockUtilizable.minus(new Prisma.Decimal(p.stockMaximo)).toString(),
      });
    }
  }
  return resultados;
}

/** Lotes próximos a vencer (ventana en días) con su saldo disponible. */
export async function vencimientosProximos(empresaId: string, diasVentana: number) {
  const limite = new Date();
  limite.setDate(limite.getDate() + diasVentana);
  const saldos = await prisma.saldoInventario.findMany({
    where: {
      estadoInventario: "DISPONIBLE",
      cantidadFisica: { gt: 0 },
      lote: { fechaVencimiento: { lte: limite, not: null } },
      producto: { empresaId },
    },
    include: { producto: true, lote: true, ubicacion: { include: { bodega: true } } },
    orderBy: { lote: { fechaVencimiento: "asc" } },
  });
  return saldos.map((s) => ({
    productoId: s.productoId,
    productoCodigo: s.producto.codigo,
    loteCodigo: s.lote?.codigoLote,
    fechaVencimiento: s.lote?.fechaVencimiento,
    bodegaCodigo: s.ubicacion.bodega.codigo,
    ubicacionCodigo: s.ubicacion.codigo,
    cantidad: s.cantidadFisica.toString(),
  }));
}

/** Resumen de disponibilidad por producto+bodega (stock físico/utilizable/reservado/libre). */
export async function resumenDisponibilidad(empresaId: string, bodegaId: string) {
  const productos = await prisma.producto.findMany({ where: { empresaId, activo: true } });
  const resultados = [];
  for (const producto of productos) {
    const disponibilidad = await calcularDisponibilidad(producto.id, bodegaId);
    if (disponibilidad.stockFisicoTotal.gt(0)) {
      resultados.push({
        productoId: producto.id,
        productoCodigo: producto.codigo,
        productoNombre: producto.nombre,
        ...Object.fromEntries(
          Object.entries(disponibilidad)
            .filter(([k]) => k.startsWith("stock"))
            .map(([k, v]) => [k, (v as Prisma.Decimal).toString()])
        ),
      });
    }
  }
  return resultados;
}

/** Exactitud de inventario: % de líneas de conteo sin diferencia, por conteo. */
export async function exactitudInventario(bodegaId: string) {
  const conteos = await prisma.conteo.findMany({
    where: { bodegaId, estado: "APROBADO" },
    include: { detalle: true },
    orderBy: { fechaCorte: "desc" },
    take: 20,
  });
  return conteos.map((c) => {
    const contadas = c.detalle.filter((d) => d.cantidadContada !== null);
    const exactas = contadas.filter((d) => new Prisma.Decimal(d.cantidadContada!).equals(new Prisma.Decimal(d.cantidadEsperada)));
    return {
      conteoId: c.id,
      folio: c.folio,
      fechaCorte: c.fechaCorte,
      lineasContadas: contadas.length,
      lineasExactas: exactas.length,
      exactitudPct: contadas.length > 0 ? Number(((exactas.length / contadas.length) * 100).toFixed(1)) : null,
    };
  });
}
