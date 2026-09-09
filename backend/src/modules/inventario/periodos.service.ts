import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion } from "../../lib/errors.js";

const CLAVE_FECHA_CIERRE = "fecha_cierre_periodo";

/** Fecha de corte configurada para la empresa: null si nunca se ha cerrado un período. */
export async function obtenerFechaCierre(empresaId: string): Promise<Date | null> {
  const parametro = await prisma.parametro.findUnique({ where: { empresaId_clave: { empresaId, clave: CLAVE_FECHA_CIERRE } } });
  return parametro ? new Date(parametro.valor) : null;
}

/**
 * Define (o adelanta) la fecha de cierre de la empresa. No se permite
 * retroceder un cierre ya establecido: una vez cerrado un período, solo se
 * puede cerrar más adelante, nunca reabrirlo desde aquí (evita reabrir un
 * período ya conciliado por error).
 */
export async function definirFechaCierre(empresaId: string, fecha: Date) {
  const actual = await obtenerFechaCierre(empresaId);
  if (actual && fecha < actual) {
    throw new ErrorValidacion(`No se puede retroceder el cierre: el período ya está cerrado hasta ${actual.toISOString().slice(0, 10)}`);
  }
  return prisma.parametro.upsert({
    where: { empresaId_clave: { empresaId, clave: CLAVE_FECHA_CIERRE } },
    update: { valor: fecha.toISOString() },
    create: {
      empresaId,
      clave: CLAVE_FECHA_CIERRE,
      valor: fecha.toISOString(),
      descripcion: "No se aceptan operaciones con fecha efectiva igual o anterior a esta fecha, salvo autorización explícita.",
    },
  });
}

/**
 * Toda operación de inventario pasa por aquí (ver crearOperacion). Por
 * defecto, una operación con fecha efectiva dentro de un período cerrado se
 * rechaza; solo se permite si el llamador pasa explícitamente
 * permitirPeriodoCerrado=true, algo que ningún flujo activa por sí solo en
 * este entregable (evita reabrir un período cerrado sin querer).
 */
export async function verificarPeriodoAbierto(empresaId: string, fechaEfectiva: Date, permitirPeriodoCerrado = false): Promise<void> {
  if (permitirPeriodoCerrado) return;
  const fechaCierre = await obtenerFechaCierre(empresaId);
  if (fechaCierre && fechaEfectiva.getTime() <= fechaCierre.getTime()) {
    throw new ErrorValidacion(
      `El período contable está cerrado hasta el ${fechaCierre.toISOString().slice(0, 10)}. La operación tiene fecha efectiva ${fechaEfectiva.toISOString().slice(0, 10)} y requeriría autorización explícita para registrarse en un período cerrado.`
    );
  }
}
