import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion } from "../../lib/errors.js";

const DIAS_HISTORIA_MINIMA = 7;
const VENTANA_DIAS = 30;

export interface PronosticoInsuficiente {
  suficiente: false;
  diasDisponibles: number;
  diasRequeridos: number;
  mensaje: string;
}

export interface PronosticoCalculado {
  suficiente: true;
  productoId: string;
  bodegaId: string;
  demandaEstimada: string;
  metodo: "PROMEDIO_MOVIL";
  errorAbsolutoMedio: string | null;
  diasHistoriaUsados: number;
  ventanaDias: number;
  limitaciones: string[];
}

/**
 * Pronóstico de demanda diaria por promedio móvil, con evaluación contra una
 * regla simple (naive: "mañana será como hoy") sobre el propio historial.
 * Si no hay historia suficiente, NO se inventa una cifra: se declara la
 * insuficiencia explícitamente (caso de aceptación 14 del encargo).
 */
export async function calcularPronostico(productoId: string, bodegaId: string): Promise<PronosticoInsuficiente | PronosticoCalculado> {
  const desde = new Date();
  desde.setUTCDate(desde.getUTCDate() - VENTANA_DIAS);

  const historia = await prisma.demandaRegistrada.findMany({
    where: { productoId, bodegaId, fecha: { gte: desde } },
    orderBy: { fecha: "asc" },
  });

  if (historia.length < DIAS_HISTORIA_MINIMA) {
    return {
      suficiente: false,
      diasDisponibles: historia.length,
      diasRequeridos: DIAS_HISTORIA_MINIMA,
      mensaje: `Solo hay ${historia.length} día(s) con demanda registrada en los últimos ${VENTANA_DIAS} días; se requieren al menos ${DIAS_HISTORIA_MINIMA} para proyectar una demanda diaria con algún respaldo. No se genera un pronóstico con esta información.`,
    };
  }

  const valores = historia.map((h) => new Prisma.Decimal(h.cantidadSolicitada));
  const promedio = valores.reduce((a, b) => a.plus(b), new Prisma.Decimal(0)).div(valores.length);

  // Backtesting: compara, día a día (desde el segundo), el promedio móvil de
  // los días previos contra una regla simple (naive: el valor del día
  // anterior), midiendo el error absoluto medio de cada una sobre el mismo
  // historial real.
  let errorPromedioMovil = new Prisma.Decimal(0);
  let errorReglaSimple = new Prisma.Decimal(0);
  let comparaciones = 0;
  for (let i = 1; i < valores.length; i++) {
    const previos = valores.slice(0, i);
    const promedioPrevio = previos.reduce((a, b) => a.plus(b), new Prisma.Decimal(0)).div(previos.length);
    const naive = valores[i - 1];
    const real = valores[i];
    errorPromedioMovil = errorPromedioMovil.plus(promedioPrevio.minus(real).abs());
    errorReglaSimple = errorReglaSimple.plus(naive.minus(real).abs());
    comparaciones++;
  }
  const errorAbsolutoMedio = comparaciones > 0 ? errorPromedioMovil.div(comparaciones) : null;
  const errorReglaSimpleMedio = comparaciones > 0 ? errorReglaSimple.div(comparaciones) : null;

  const limitaciones = [
    `Calculado sobre ${historia.length} día(s) de historia real (ventana de ${VENTANA_DIAS} días); no incorpora estacionalidad, promociones ni eventos futuros conocidos.`,
    "La demanda registrada es lo solicitado, no lo vendido: incluye demanda no atendida por falta de stock.",
  ];
  if (errorAbsolutoMedio !== null && errorReglaSimpleMedio !== null && errorAbsolutoMedio.gte(errorReglaSimpleMedio)) {
    limitaciones.push("En este historial, el promedio móvil no superó a la regla simple (repetir el valor del día anterior); tómese como una referencia débil.");
  }

  await prisma.pronostico.create({
    data: {
      productoId,
      bodegaId,
      fecha: new Date(),
      demandaEstimada: promedio,
      metodo: "PROMEDIO_MOVIL",
      errorAbsolutoMedio: errorAbsolutoMedio ?? undefined,
    },
  });

  return {
    suficiente: true,
    productoId,
    bodegaId,
    demandaEstimada: promedio.toFixed(2),
    metodo: "PROMEDIO_MOVIL",
    errorAbsolutoMedio: errorAbsolutoMedio?.toFixed(2) ?? null,
    diasHistoriaUsados: historia.length,
    ventanaDias: VENTANA_DIAS,
    limitaciones,
  };
}

export interface DatosEscenario {
  nombre: string;
  productoId: string;
  bodegaId: string;
  creadoPorId: string;
  incrementoDemandaPct?: number;
  retrasoProveedorDias?: number;
  cambioStockSeguridad?: number;
}

/**
 * Simula el efecto de cambiar supuestos de reposición (demanda, plazo de
 * proveedor, stock de seguridad) sobre el punto de reposición y la cobertura
 * estimada, SIN tocar los parámetros reales ni generar ninguna operación.
 * El resultado siempre queda etiquetado como simulación, con sus supuestos.
 */
export async function simularEscenario(datos: DatosEscenario) {
  const parametro = await prisma.parametroReposicion.findUnique({
    where: { productoId_bodegaId: { productoId: datos.productoId, bodegaId: datos.bodegaId } },
  });
  if (!parametro) {
    throw new ErrorValidacion("No hay parámetros de reposición configurados para este producto/bodega; no se puede simular");
  }

  const { calcularDisponibilidad } = await import("../inventario/inventario.service.js");
  const disponibilidad = await calcularDisponibilidad(datos.productoId, datos.bodegaId);

  const demandaBase = new Prisma.Decimal(parametro.demandaDiariaEstimada ?? 0);
  const demandaSimulada = demandaBase.times(1 + (datos.incrementoDemandaPct ?? 0) / 100);
  const plazoSimulado = parametro.plazoReposicionDias + (datos.retrasoProveedorDias ?? 0);
  const stockSeguridadSimulado = new Prisma.Decimal(parametro.stockSeguridad).plus(datos.cambioStockSeguridad ?? 0);

  const puntoReposicionActual = demandaBase.times(parametro.plazoReposicionDias).plus(parametro.stockSeguridad);
  const puntoReposicionSimulado = demandaSimulada.times(plazoSimulado).plus(stockSeguridadSimulado);

  const resultado = {
    esSimulacion: true,
    puntoReposicionActual: puntoReposicionActual.toFixed(2),
    puntoReposicionSimulado: puntoReposicionSimulado.toFixed(2),
    diferencia: puntoReposicionSimulado.minus(puntoReposicionActual).toFixed(2),
    stockLibreActual: disponibilidad.stockLibre.toFixed(2),
    coberturaDiasActual: demandaBase.gt(0) ? disponibilidad.stockLibre.div(demandaBase).toFixed(1) : null,
    coberturaDiasSimulada: demandaSimulada.gt(0) ? disponibilidad.stockLibre.div(demandaSimulada).toFixed(1) : null,
  };

  const supuestos = {
    incrementoDemandaPct: datos.incrementoDemandaPct ?? 0,
    retrasoProveedorDias: datos.retrasoProveedorDias ?? 0,
    cambioStockSeguridad: datos.cambioStockSeguridad ?? 0,
    productoId: datos.productoId,
    bodegaId: datos.bodegaId,
  };

  return prisma.escenario.create({
    data: { nombre: datos.nombre, supuestos, resultado, creadoPorId: datos.creadoPorId },
  });
}
