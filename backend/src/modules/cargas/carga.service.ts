import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { EstadoCarga, ModoCarga, Prisma, TipoUbicacion } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion } from "../../lib/errors.js";
import { registrarMovimiento, crearOperacion } from "../inventario/inventario.service.js";
import { obtenerUbicacionTecnica } from "../inventario/ubicaciones-tecnicas.js";
import { actualizarValorReferencia } from "../precios/precios.service.js";
import { TipoOperacion } from "@prisma/client";

/**
 * Normaliza un encabezado de columna (de CSV o XLSX) a snake_case ASCII, para
 * que un archivo con encabezados legibles ("Código ML", "Valor en USD") y uno
 * ya en snake_case ("codigo_ml") produzcan exactamente las mismas claves que
 * usan los validadores de cada entidad.
 */
function normalizarEncabezado(encabezado: string): string {
  return encabezado
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita marcas diacríticas combinantes tras normalizar a NFD (tildes, diéresis)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function valorCeldaComoTexto(valor: ExcelJS.CellValue): string {
  if (valor == null) return "";
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") {
    const conFormula = valor as { result?: unknown; text?: unknown };
    if (conFormula.result != null) return String(conFormula.result).trim();
    if (conFormula.text != null) return String(conFormula.text).trim();
    return "";
  }
  return String(valor).trim();
}

async function parsearXlsx(contenido: Buffer): Promise<Record<string, string>[]> {
  const libro = new ExcelJS.Workbook();
  // exceljs declara su propio tipo Buffer, incompatible con el genérico más
  // nuevo de @types/node; el valor en tiempo de ejecución es un Buffer real.
  await libro.xlsx.load(contenido as unknown as Parameters<typeof libro.xlsx.load>[0]);
  const hoja = libro.worksheets[0];
  if (!hoja) return [];

  const encabezados: string[] = [];
  const filas: Record<string, string>[] = [];
  hoja.eachRow((fila, numeroFila) => {
    if (numeroFila === 1) {
      fila.eachCell({ includeEmpty: true }, (celda, col) => {
        encabezados[col - 1] = normalizarEncabezado(valorCeldaComoTexto(celda.value));
      });
      return;
    }
    const registro: Record<string, string> = {};
    let vacia = true;
    fila.eachCell({ includeEmpty: true }, (celda, col) => {
      const clave = encabezados[col - 1];
      if (!clave) return;
      const texto = valorCeldaComoTexto(celda.value);
      if (texto !== "") vacia = false;
      registro[clave] = texto;
    });
    if (!vacia) filas.push(registro);
  });
  return filas;
}

function parsearCsv(contenido: Buffer): Record<string, string>[] {
  const filas = parse(contenido, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return filas.map((fila) => {
    const normalizada: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(fila)) normalizada[normalizarEncabezado(clave)] = (valor ?? "").trim();
    return normalizada;
  });
}

async function parsearFilas(nombreArchivo: string, contenido: Buffer): Promise<Record<string, string>[]> {
  return /\.xlsx$/i.test(nombreArchivo) ? parsearXlsx(contenido) : parsearCsv(contenido);
}

export type Severidad = "BLOQUEANTE" | "ADVERTENCIA";
export type AccionFila = "CREAR" | "ACTUALIZAR" | "SIN_CAMBIO" | "RECHAZAR";

export interface ErrorFila {
  campo?: string;
  severidad: Severidad;
  mensaje: string;
}

export interface ResultadoValidacionFila {
  accion: AccionFila;
  errores: ErrorFila[];
  propuesta?: Record<string, unknown>;
}

export interface ManejadorEntidad {
  /** Valida una fila y decide qué acción tomaría (sin escribir nada). */
  validarFila(
    fila: Record<string, string>,
    ctx: { empresaId: string; modo: ModoCarga; contexto?: Record<string, unknown> | null }
  ): Promise<ResultadoValidacionFila>;
  /** Ejecuta el efecto real de una fila ya aprobada, dentro de una transacción. */
  ejecutarFila(
    tx: Prisma.TransactionClient,
    fila: Record<string, string>,
    propuesta: Record<string, unknown> | undefined,
    ctx: { empresaId: string; usuarioId: string; cargaId: string; contexto?: Record<string, unknown> | null }
  ): Promise<string | undefined>;
}

const manejadores: Record<string, ManejadorEntidad> = {};
export function registrarManejador(entidad: string, manejador: ManejadorEntidad) {
  manejadores[entidad] = manejador;
}

function calcularClaveIdempotencia(empresaId: string, entidad: string, modo: string, contenido: Buffer, contexto?: Record<string, unknown>): string {
  const hash = createHash("sha256").update(empresaId).update("|").update(entidad).update("|").update(modo).update("|").update(contenido);
  if (contexto) hash.update("|").update(JSON.stringify(contexto));
  return hash.digest("hex");
}

export interface DatosNuevaCarga {
  empresaId: string;
  entidad: string;
  modo: ModoCarga;
  nombreArchivo: string;
  contenido: Buffer;
  usuarioId: string;
  /** Parámetros propios de ciertas entidades que no vienen en el archivo (p. ej. bodegaDestinoId para LLEGADA_PRODUCTOS). */
  contexto?: Record<string, unknown>;
}

/**
 * Recibe un archivo y lo deja en el área de preparación (cargas_filas), sin
 * tocar datos operativos. Si el mismo contenido ya fue recibido antes para
 * la misma empresa/entidad/modo, retorna la carga existente en lugar de
 * duplicar filas — la clave de idempotencia se calcula por contenido, no
 * por nombre de archivo.
 */
/** Límite de filas por archivo: una carga masiva mal formada no debe poder saturar el proceso de validación/ejecución. */
const MAXIMO_FILAS_POR_CARGA = 5000;

export async function recibirArchivo(datos: DatosNuevaCarga) {
  const plantilla = await prisma.plantillaCarga.findFirst({
    where: { entidad: datos.entidad, activo: true },
    orderBy: { version: "desc" },
  });
  if (!plantilla) throw new ErrorValidacion(`No existe una plantilla activa para la entidad ${datos.entidad}`);

  if (datos.entidad === "LLEGADA_PRODUCTOS") {
    const bodegaDestinoId = datos.contexto?.bodegaDestinoId as string | undefined;
    if (!bodegaDestinoId) throw new ErrorValidacion("Debe indicar la bodega de destino para una carga de llegada de productos");
    const bodega = await prisma.bodega.findFirst({ where: { id: bodegaDestinoId, empresaId: datos.empresaId } });
    if (!bodega) throw new ErrorValidacion("La bodega de destino indicada no existe en esta empresa");
  }

  const claveIdempotencia = calcularClaveIdempotencia(datos.empresaId, datos.entidad, datos.modo, datos.contenido, datos.contexto);
  const existente = await prisma.cargaDatos.findUnique({ where: { claveIdempotencia } });
  if (existente) return existente;

  const filas = await parsearFilas(datos.nombreArchivo, datos.contenido);
  if (filas.length === 0) throw new ErrorValidacion("El archivo no contiene filas");
  if (filas.length > MAXIMO_FILAS_POR_CARGA) {
    throw new ErrorValidacion(
      `El archivo tiene ${filas.length} filas; el máximo permitido por carga es ${MAXIMO_FILAS_POR_CARGA}. Divídalo en archivos más pequeños.`
    );
  }

  return prisma.cargaDatos.create({
    data: {
      empresaId: datos.empresaId,
      plantillaId: plantilla.id,
      claveIdempotencia,
      nombreArchivo: datos.nombreArchivo,
      modo: datos.modo,
      estado: EstadoCarga.RECIBIDA,
      totalFilas: filas.length,
      creadoPorId: datos.usuarioId,
      contexto: datos.contexto ? (datos.contexto as Prisma.InputJsonValue) : undefined,
      filas: {
        create: filas.map((datosOriginales, i) => ({
          numeroFila: i + 2, // fila 1 = encabezado
          datosOriginales,
          accion: "RECHAZAR",
        })),
      },
    },
    include: { filas: true },
  });
}

/** Valida estructural y semánticamente todas las filas, y deja la simulación lista. */
export async function validarYSimular(cargaId: string) {
  const carga = await prisma.cargaDatos.findUniqueOrThrow({ where: { id: cargaId }, include: { filas: true, plantilla: true } });
  const manejador = manejadores[carga.plantilla.entidad];
  if (!manejador) throw new ErrorValidacion(`No hay validador registrado para ${carga.plantilla.entidad}`);

  await prisma.cargaError.deleteMany({ where: { cargaId } });

  const conteos = { crear: 0, actualizar: 0, rechazar: 0, sinCambio: 0 };
  for (const fila of carga.filas) {
    const resultado = await manejador.validarFila(fila.datosOriginales as Record<string, string>, {
      empresaId: carga.empresaId,
      modo: carga.modo,
      contexto: carga.contexto as Record<string, unknown> | null,
    });

    if (resultado.errores.length > 0) {
      await prisma.cargaError.createMany({
        data: resultado.errores.map((e) => ({
          cargaId,
          numeroFila: fila.numeroFila,
          campo: e.campo,
          severidad: e.severidad,
          mensaje: e.mensaje,
        })),
      });
    }

    await prisma.cargaFila.update({
      where: { id: fila.id },
      data: { accion: resultado.accion, datosPropuestos: resultado.propuesta ? (resultado.propuesta as Prisma.InputJsonValue) : undefined },
    });

    if (resultado.accion === "CREAR") conteos.crear++;
    else if (resultado.accion === "ACTUALIZAR") conteos.actualizar++;
    else if (resultado.accion === "SIN_CAMBIO") conteos.sinCambio++;
    else conteos.rechazar++;
  }

  const hayBloqueantes = await prisma.cargaError.count({ where: { cargaId, severidad: "BLOQUEANTE" } });

  return prisma.cargaDatos.update({
    where: { id: cargaId },
    data: {
      estado: hayBloqueantes > 0 && carga.modo !== ModoCarga.VALIDACION_SIN_APLICAR ? EstadoCarga.VALIDADA_CON_ERRORES : EstadoCarga.SIMULADA,
      filasCrear: conteos.crear,
      filasActualizar: conteos.actualizar,
      filasRechazar: conteos.rechazar,
      filasSinCambio: conteos.sinCambio,
    },
    include: { filas: true, errores: true },
  });
}

export async function aprobarCarga(cargaId: string, usuarioId: string) {
  const carga = await prisma.cargaDatos.findUniqueOrThrow({ where: { id: cargaId } });
  if (carga.estado !== EstadoCarga.SIMULADA) {
    throw new ErrorValidacion("Solo se puede aprobar una carga que fue simulada sin errores bloqueantes");
  }
  return prisma.cargaDatos.update({
    where: { id: cargaId },
    data: { estado: EstadoCarga.APROBADA, aprobadoPorId: usuarioId },
  });
}

/**
 * Ejecuta una carga ya aprobada. La transición APROBADA -> EJECUTANDO se hace
 * con un UPDATE condicionado al estado actual: si dos solicitudes de
 * ejecución llegan a la vez (o se reintenta una petición ya en curso), solo
 * una gana la carrera y las demás son rechazadas por este método.
 */
export async function ejecutarCarga(cargaId: string, usuarioId: string) {
  const carga = await prisma.cargaDatos.findUniqueOrThrow({ where: { id: cargaId }, include: { plantilla: true } });
  if (carga.modo === ModoCarga.VALIDACION_SIN_APLICAR) {
    throw new ErrorValidacion("Esta carga es de solo validación: no puede ejecutarse");
  }

  const claim = await prisma.cargaDatos.updateMany({
    where: { id: cargaId, estado: EstadoCarga.APROBADA },
    data: { estado: EstadoCarga.EJECUTANDO },
  });
  if (claim.count === 0) {
    throw new ErrorValidacion("La carga no está en estado APROBADA (¿ya fue ejecutada o está en curso?)");
  }

  const manejador = manejadores[carga.plantilla.entidad];
  const filas = await prisma.cargaFila.findMany({ where: { cargaId, procesada: false } });

  try {
    await prisma.$transaction(async (tx) => {
      for (const fila of filas) {
        if (fila.accion === "RECHAZAR" || fila.accion === "SIN_CAMBIO") {
          await tx.cargaFila.update({ where: { id: fila.id }, data: { procesada: true } });
          continue;
        }
        const entidadId = await manejador.ejecutarFila(
          tx,
          fila.datosOriginales as Record<string, string>,
          fila.datosPropuestos as Record<string, unknown> | undefined,
          { empresaId: carga.empresaId, usuarioId, cargaId, contexto: carga.contexto as Record<string, unknown> | null }
        );
        await tx.cargaFila.update({ where: { id: fila.id }, data: { procesada: true, entidadResultanteId: entidadId } });
      }
    });
  } catch (err) {
    await prisma.cargaDatos.update({ where: { id: cargaId }, data: { estado: EstadoCarga.RECHAZADA } });
    throw err;
  }

  return prisma.cargaDatos.update({
    where: { id: cargaId },
    data: { estado: EstadoCarga.EJECUTADA, procesadoEn: new Date() },
    include: { filas: true },
  });
}

// ---------------------------------------------------------------------------
// Manejador: PRODUCTOS
// ---------------------------------------------------------------------------

registrarManejador("PRODUCTOS", {
  async validarFila(fila, ctx) {
    const errores: ErrorFila[] = [];
    const codigo = fila.codigo?.trim();
    const nombre = fila.nombre?.trim();
    const unidadBaseCodigo = fila.unidad_base_codigo?.trim();

    if (!codigo) errores.push({ campo: "codigo", severidad: "BLOQUEANTE", mensaje: "El código es obligatorio" });
    if (!nombre) errores.push({ campo: "nombre", severidad: "BLOQUEANTE", mensaje: "El nombre es obligatorio" });
    if (!unidadBaseCodigo) errores.push({ campo: "unidad_base_codigo", severidad: "BLOQUEANTE", mensaje: "La unidad base es obligatoria" });

    let unidadBaseId: string | undefined;
    if (unidadBaseCodigo) {
      const unidad = await prisma.unidadMedida.findFirst({ where: { empresaId: ctx.empresaId, codigo: unidadBaseCodigo } });
      if (!unidad) {
        errores.push({
          campo: "unidad_base_codigo",
          severidad: "BLOQUEANTE",
          mensaje: `La unidad de medida '${unidadBaseCodigo}' no existe. Créela antes de importar o corrija el código.`,
        });
      } else {
        unidadBaseId = unidad.id;
      }
    }

    if (errores.some((e) => e.severidad === "BLOQUEANTE")) {
      return { accion: "RECHAZAR", errores };
    }

    const existente = await prisma.producto.findFirst({ where: { empresaId: ctx.empresaId, codigo } });
    if (existente && ctx.modo === ModoCarga.SOLO_CREACION) {
      return { accion: "RECHAZAR", errores: [{ severidad: "BLOQUEANTE", mensaje: `El producto ${codigo} ya existe (modo solo creación)` }] };
    }
    if (!existente && ctx.modo === ModoCarga.SOLO_ACTUALIZACION) {
      return { accion: "RECHAZAR", errores: [{ severidad: "BLOQUEANTE", mensaje: `El producto ${codigo} no existe (modo solo actualización)` }] };
    }

    const propuesta = {
      codigo,
      nombre,
      descripcion: fila.descripcion || undefined,
      codigoBarras: fila.codigo_barras || undefined,
      unidadBaseId,
      controlLote: fila.control_lote === "true",
      controlSerie: fila.control_serie === "true",
      controlVencimiento: fila.control_vencimiento === "true",
      metodoValorizacion: fila.metodo_valorizacion === "FIFO" ? "FIFO" : "PROMEDIO_PONDERADO",
    };

    if (existente) {
      const sinCambio =
        existente.nombre === propuesta.nombre &&
        existente.unidadBaseId === propuesta.unidadBaseId &&
        existente.controlLote === propuesta.controlLote &&
        existente.controlSerie === propuesta.controlSerie &&
        existente.controlVencimiento === propuesta.controlVencimiento;
      return { accion: sinCambio ? "SIN_CAMBIO" : "ACTUALIZAR", errores, propuesta: { ...propuesta, productoId: existente.id } };
    }
    return { accion: "CREAR", errores, propuesta };
  },

  async ejecutarFila(tx, _fila, propuesta) {
    if (!propuesta) return undefined;
    const p = propuesta as Record<string, unknown> & { productoId?: string };
    const data = {
      codigo: p.codigo as string,
      nombre: p.nombre as string,
      descripcion: p.descripcion as string | undefined,
      codigoBarras: p.codigoBarras as string | undefined,
      unidadBaseId: p.unidadBaseId as string,
      controlLote: p.controlLote as boolean,
      controlSerie: p.controlSerie as boolean,
      controlVencimiento: p.controlVencimiento as boolean,
      metodoValorizacion: p.metodoValorizacion as "FIFO" | "PROMEDIO_PONDERADO",
    };
    if (p.productoId) {
      const actualizado = await tx.producto.update({ where: { id: p.productoId }, data });
      return actualizado.id;
    }
    const creado = await tx.producto.create({
      data: { ...data, empresaId: (await tx.unidadMedida.findUniqueOrThrow({ where: { id: data.unidadBaseId } })).empresaId },
    });
    return creado.id;
  },
});

// ---------------------------------------------------------------------------
// Manejador: INVENTARIO_INICIAL
// ---------------------------------------------------------------------------

registrarManejador("INVENTARIO_INICIAL", {
  async validarFila(fila, ctx) {
    const errores: ErrorFila[] = [];
    const productoCodigo = fila.producto_codigo?.trim();
    const bodegaCodigo = fila.bodega_codigo?.trim();
    const ubicacionCodigo = fila.ubicacion_codigo?.trim();
    const unidadCodigo = fila.unidad_codigo?.trim();
    const cantidadTexto = fila.cantidad?.trim();

    if (!productoCodigo || !bodegaCodigo || !ubicacionCodigo || !unidadCodigo || !cantidadTexto) {
      return { accion: "RECHAZAR", errores: [{ severidad: "BLOQUEANTE", mensaje: "Faltan campos obligatorios (producto, bodega, ubicación, unidad, cantidad)" }] };
    }
    const cantidad = Number(cantidadTexto);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return { accion: "RECHAZAR", errores: [{ campo: "cantidad", severidad: "BLOQUEANTE", mensaje: "La cantidad debe ser un número positivo" }] };
    }

    const producto = await prisma.producto.findFirst({ where: { empresaId: ctx.empresaId, codigo: productoCodigo } });
    if (!producto) {
      return {
        accion: "RECHAZAR",
        errores: [{ campo: "producto_codigo", severidad: "BLOQUEANTE", mensaje: `El producto '${productoCodigo}' no existe. No se crea por suposición.` }],
      };
    }
    const bodega = await prisma.bodega.findFirst({ where: { empresaId: ctx.empresaId, codigo: bodegaCodigo } });
    if (!bodega) {
      return { accion: "RECHAZAR", errores: [{ campo: "bodega_codigo", severidad: "BLOQUEANTE", mensaje: `La bodega '${bodegaCodigo}' no existe.` }] };
    }
    const ubicacion = await prisma.ubicacion.findFirst({ where: { bodegaId: bodega.id, codigo: ubicacionCodigo } });
    if (!ubicacion) {
      return { accion: "RECHAZAR", errores: [{ campo: "ubicacion_codigo", severidad: "BLOQUEANTE", mensaje: `La ubicación '${ubicacionCodigo}' no existe en la bodega '${bodegaCodigo}'.` }] };
    }

    let factor = 1;
    if (unidadCodigo !== (await prisma.unidadMedida.findUniqueOrThrow({ where: { id: producto.unidadBaseId } })).codigo) {
      const unidad = await prisma.unidadMedida.findFirst({ where: { empresaId: ctx.empresaId, codigo: unidadCodigo } });
      if (!unidad) {
        return { accion: "RECHAZAR", errores: [{ campo: "unidad_codigo", severidad: "BLOQUEANTE", mensaje: `La unidad '${unidadCodigo}' no existe.` }] };
      }
      const conversion = await prisma.conversionProducto.findFirst({ where: { productoId: producto.id, unidadId: unidad.id } });
      if (!conversion) {
        return {
          accion: "RECHAZAR",
          errores: [{ campo: "unidad_codigo", severidad: "BLOQUEANTE", mensaje: `No existe conversión de '${unidadCodigo}' a la unidad base para ${productoCodigo}.` }],
        };
      }
      factor = Number(conversion.factorAUnidadBase);
    }

    const costoTexto = fila.costo_unitario?.trim();
    const costoUnitario = costoTexto ? Number(costoTexto) : undefined;
    if (costoTexto && (!Number.isFinite(costoUnitario) || (costoUnitario as number) < 0)) {
      errores.push({ campo: "costo_unitario", severidad: "ADVERTENCIA", mensaje: "Costo unitario inválido; quedará pendiente" });
    }

    return {
      accion: "CREAR",
      errores,
      propuesta: {
        productoId: producto.id,
        ubicacionId: ubicacion.id,
        cantidadOriginal: cantidad,
        unidadCodigo,
        factorAUnidadBase: factor,
        cantidadBase: cantidad * factor,
        loteCodigo: fila.lote_codigo || undefined,
        fechaVencimiento: fila.fecha_vencimiento || undefined,
        costoUnitario: costoTexto && Number.isFinite(costoUnitario) ? costoUnitario : undefined,
      },
    };
  },

  async ejecutarFila(tx, _fila, propuesta, ctx) {
    if (!propuesta) return undefined;
    const p = propuesta as {
      productoId: string;
      ubicacionId: string;
      cantidadBase: number;
      loteCodigo?: string;
      fechaVencimiento?: string;
      costoUnitario?: number;
    };

    let loteId: string | undefined;
    if (p.loteCodigo) {
      const lote = await tx.lote.upsert({
        where: { productoId_codigoLote: { productoId: p.productoId, codigoLote: p.loteCodigo } },
        update: {},
        create: { productoId: p.productoId, codigoLote: p.loteCodigo, fechaVencimiento: p.fechaVencimiento ? new Date(p.fechaVencimiento) : undefined },
      });
      loteId = lote.id;
    }

    const ubicacion = await tx.ubicacion.findUniqueOrThrow({ where: { id: p.ubicacionId } });
    const operacion = await crearOperacion(tx, {
      empresaId: ctx.empresaId,
      bodegaId: ubicacion.bodegaId,
      tipo: TipoOperacion.APERTURA_INICIAL,
      documentoOrigen: `CARGA-${ctx.cargaId}`,
      fechaEfectiva: new Date(),
      usuarioId: ctx.usuarioId,
      observacion: "Apertura de inventario inicial vía centro de cargas de datos",
    });

    const { movimientoId } = await registrarMovimiento(tx, {
      operacionId: operacion.id,
      productoId: p.productoId,
      ubicacionDestinoId: p.ubicacionId,
      loteId,
      cantidad: p.cantidadBase,
      costoUnitario: p.costoUnitario, // si no viene, queda NULL = pendiente, nunca 0 silencioso
      fechaEfectiva: new Date(),
    });

    if (p.costoUnitario != null) {
      await tx.capaCosto.create({
        data: {
          productoId: p.productoId,
          loteId,
          costoUnitario: p.costoUnitario,
          cantidadOriginal: p.cantidadBase,
          cantidadDisponible: p.cantidadBase,
          fuenteTipo: "APERTURA_INICIAL",
          fuenteId: operacion.id,
        },
      });
    }

    return movimientoId;
  },
});

// ---------------------------------------------------------------------------
// Manejador: LLEGADA_PRODUCTOS (mercadería de Mercado Libre / liquidación)
// ---------------------------------------------------------------------------

/** Unidad de medida usada al crear un producto nuevo desde esta entidad: el Excel no trae unidad. */
const UNIDAD_POR_DEFECTO_LLEGADA = "UN";

function numeroOpcional(texto: string | undefined): number | undefined {
  const limpio = texto?.trim();
  if (!limpio) return undefined;
  // Admite valores con formato moneda tal como los exporta Mercado Libre
  // (ej. "$ 0"): solo quita el símbolo de moneda y espacios, nunca separadores
  // de miles/decimales (eso ya causó un bug real al confundir "16.5" con
  // "1.234" en formato chileno).
  const sinFormato = limpio.replace(/[$\s]/g, "");
  if (!sinFormato) return undefined;
  const n = Number(sinFormato);
  return Number.isFinite(n) ? n : undefined;
}

registrarManejador("LLEGADA_PRODUCTOS", {
  async validarFila(fila, ctx) {
    const errores: ErrorFila[] = [];
    const codigo = fila.codigo?.trim();
    const codigoMl = fila.codigo_ml?.trim() || undefined;
    const codigoOriginal = fila.codigo_original?.trim() || undefined;
    const titulo = fila.titulo?.trim() || undefined;
    const grupo = fila.grupo?.trim() || undefined;
    const condicion = fila.condicion?.trim() || undefined;
    const status = fila.status?.trim() || undefined;
    const subStatus = fila.sub_status?.trim() || undefined;
    const grade = fila.grade?.trim() || undefined;

    if (!codigo) errores.push({ campo: "codigo", severidad: "BLOQUEANTE", mensaje: "El código es obligatorio" });

    const bodegaDestinoId = ctx.contexto?.bodegaDestinoId as string | undefined;
    if (!bodegaDestinoId) {
      errores.push({ severidad: "BLOQUEANTE", mensaje: "Falta la bodega de destino de esta carga" });
    }

    let cantidadEnviada = 0;
    const cantidadEnviadaTexto = fila.cantidad_enviada?.trim();
    if (cantidadEnviadaTexto) {
      const n = numeroOpcional(cantidadEnviadaTexto);
      if (n == null || !Number.isFinite(n) || n < 0) {
        errores.push({ campo: "cantidad_enviada", severidad: "BLOQUEANTE", mensaje: "La cantidad enviada debe ser un número mayor o igual a 0" });
      } else {
        cantidadEnviada = n;
      }
    }

    const cantidadSolicitada = numeroOpcional(fila.cantidad_solicitada);
    if (fila.cantidad_solicitada?.trim() && cantidadSolicitada == null) {
      errores.push({ campo: "cantidad_solicitada", severidad: "ADVERTENCIA", mensaje: "Cantidad solicitada inválida; se guarda vacía" });
    }
    const cantidadColectada = numeroOpcional(fila.cantidad_colectada);
    if (fila.cantidad_colectada?.trim() && cantidadColectada == null) {
      errores.push({ campo: "cantidad_colectada", severidad: "ADVERTENCIA", mensaje: "Cantidad colectada inválida; se guarda vacía" });
    }
    const pesoKg = numeroOpcional(fila.peso);
    if (fila.peso?.trim() && pesoKg == null) {
      errores.push({ campo: "peso", severidad: "ADVERTENCIA", mensaje: "Peso inválido; se guarda vacío" });
    }
    const valorClp = numeroOpcional(fila.valor);
    if (fila.valor?.trim() && valorClp == null) {
      errores.push({ campo: "valor", severidad: "ADVERTENCIA", mensaje: "Valor inválido; el costo queda pendiente" });
    }
    if (cantidadEnviada > 0 && valorClp == null) {
      errores.push({ campo: "valor", severidad: "ADVERTENCIA", mensaje: "Sin valor: el costo de esta llegada queda pendiente (nunca se asume cero)" });
    }
    const valorUsd = numeroOpcional(fila.valor_en_usd);
    if (fila.valor_en_usd?.trim() && valorUsd == null) {
      errores.push({ campo: "valor_en_usd", severidad: "ADVERTENCIA", mensaje: "Valor en USD inválido; se guarda vacío" });
    }

    if (errores.some((e) => e.severidad === "BLOQUEANTE")) {
      return { accion: "RECHAZAR", errores };
    }

    // Cada fila es su propia unidad/producto: "Código" solo no identifica un
    // producto de forma confiable (verificado con un archivo real de
    // liquidación, donde el mismo "Código" se repite con títulos, pesos y
    // valores completamente distintos). "Código" + "Código ML" combinados sí
    // son únicos fila a fila, y es lo que se usa como código interno del
    // producto — decisión confirmada explícitamente antes de este cambio.
    const codigoProducto = codigoMl ? `${codigo}::${codigoMl}` : codigo!;

    const existente = await prisma.producto.findFirst({ where: { empresaId: ctx.empresaId, codigo: codigoProducto } });
    if (existente && ctx.modo === ModoCarga.SOLO_CREACION) {
      return { accion: "RECHAZAR", errores: [{ severidad: "BLOQUEANTE", mensaje: `El producto ${codigoProducto} ya existe (modo solo creación)` }] };
    }
    if (!existente && ctx.modo === ModoCarga.SOLO_ACTUALIZACION) {
      return { accion: "RECHAZAR", errores: [{ severidad: "BLOQUEANTE", mensaje: `El producto ${codigoProducto} no existe (modo solo actualización)` }] };
    }

    let unidadBaseId: string | undefined;
    if (!existente) {
      if (!titulo) {
        return {
          accion: "RECHAZAR",
          errores: [{ campo: "titulo", severidad: "BLOQUEANTE", mensaje: `El producto ${codigoProducto} no existe: el título es obligatorio para crearlo` }],
        };
      }
      const unidad = await prisma.unidadMedida.findFirst({ where: { empresaId: ctx.empresaId, codigo: UNIDAD_POR_DEFECTO_LLEGADA } });
      if (!unidad) {
        return {
          accion: "RECHAZAR",
          errores: [{ severidad: "BLOQUEANTE", mensaje: `No existe la unidad de medida '${UNIDAD_POR_DEFECTO_LLEGADA}', necesaria para crear productos nuevos desde esta carga. Créela primero.` }],
        };
      }
      unidadBaseId = unidad.id;
    }

    return {
      accion: existente ? "ACTUALIZAR" : "CREAR",
      errores,
      propuesta: {
        productoId: existente?.id,
        unidadBaseId,
        codigo: codigoProducto,
        codigoMl,
        codigoOriginal,
        titulo,
        grupo,
        condicion,
        status,
        subStatus,
        grade,
        cantidadSolicitada,
        cantidadColectada,
        cantidadEnviada,
        pesoKg,
        valorClp,
        valorUsd,
        bodegaDestinoId,
      },
    };
  },

  async ejecutarFila(tx, _fila, propuesta, ctx) {
    if (!propuesta) return undefined;
    const p = propuesta as {
      productoId?: string;
      unidadBaseId?: string;
      codigo: string;
      codigoMl?: string;
      codigoOriginal?: string;
      titulo?: string;
      grupo?: string;
      condicion?: string;
      status?: string;
      subStatus?: string;
      grade?: string;
      cantidadSolicitada?: number;
      cantidadColectada?: number;
      cantidadEnviada: number;
      pesoKg?: number;
      valorClp?: number;
      valorUsd?: number;
      bodegaDestinoId: string;
    };

    let productoId = p.productoId;
    if (productoId) {
      await tx.producto.update({
        where: { id: productoId },
        data: { grupo: p.grupo, codigoMercadoLibre: p.codigoMl, codigoOriginalProveedor: p.codigoOriginal },
      });
    } else {
      const creado = await tx.producto.create({
        data: {
          empresaId: ctx.empresaId,
          codigo: p.codigo,
          nombre: p.titulo!,
          unidadBaseId: p.unidadBaseId!,
          grupo: p.grupo,
          codigoMercadoLibre: p.codigoMl,
          codigoOriginalProveedor: p.codigoOriginal,
        },
      });
      productoId = creado.id;
    }

    await actualizarValorReferencia(tx, productoId, ctx.empresaId, p.valorClp, p.valorUsd);

    const llegada = await tx.llegadaProducto.create({
      data: {
        empresaId: ctx.empresaId,
        productoId,
        bodegaId: p.bodegaDestinoId,
        cargaId: ctx.cargaId,
        grupo: p.grupo,
        tituloOriginal: p.titulo,
        condicion: p.condicion,
        status: p.status,
        subStatus: p.subStatus,
        grade: p.grade,
        cantidadSolicitada: p.cantidadSolicitada,
        cantidadColectada: p.cantidadColectada,
        cantidadEnviada: p.cantidadEnviada,
        pesoKg: p.pesoKg,
        valorClp: p.valorClp,
        valorUsd: p.valorUsd,
      },
    });

    if (p.cantidadEnviada > 0) {
      const operacion = await crearOperacion(tx, {
        empresaId: ctx.empresaId,
        bodegaId: p.bodegaDestinoId,
        tipo: TipoOperacion.RECEPCION,
        documentoOrigen: `LLEGADA-${ctx.cargaId}`,
        fechaEfectiva: new Date(),
        usuarioId: ctx.usuarioId,
        observacion: "Llegada de productos vía centro de cargas (Mercado Libre / liquidación)",
      });
      const ubicacionRecepcion = await obtenerUbicacionTecnica(
        tx,
        p.bodegaDestinoId,
        TipoUbicacion.RECEPCION,
        "RECEPCION",
        "Recepción de mercadería"
      );
      const { movimientoId } = await registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId,
        ubicacionDestinoId: ubicacionRecepcion.id,
        cantidad: p.cantidadEnviada,
        costoUnitario: p.valorClp, // si no viene, queda NULL = pendiente, nunca 0 silencioso
        fechaEfectiva: new Date(),
      });

      if (p.valorClp != null) {
        await tx.capaCosto.create({
          data: {
            productoId,
            costoUnitario: p.valorClp,
            cantidadOriginal: p.cantidadEnviada,
            cantidadDisponible: p.cantidadEnviada,
            fuenteTipo: "LLEGADA_PRODUCTOS",
            fuenteId: llegada.id,
          },
        });
      }

      await tx.llegadaProducto.update({ where: { id: llegada.id }, data: { movimientoId } });
    }

    return llegada.id;
  },
});
