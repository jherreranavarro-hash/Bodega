import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../lib/prisma.js";
import { ErrorValidacion, ErrorNoEncontrado } from "../../lib/errors.js";

// Almacenamiento de evidencias en disco local (fuera del árbol servido
// estáticamente): las descargas siempre pasan por una ruta autenticada que
// resuelve el archivo real a partir del registro en `adjuntos`, nunca por una
// ruta de archivo entregada directamente por el cliente.
const DIRECTORIO_ADJUNTOS = path.resolve(process.cwd(), "storage", "adjuntos");
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const EXTENSIONES_PERMITIDAS = [".jpg", ".jpeg", ".png", ".pdf", ".webp"];

async function asegurarDirectorio() {
  await mkdir(DIRECTORIO_ADJUNTOS, { recursive: true });
}

export interface DatosAdjunto {
  entidad: string;
  entidadId: string;
  nombreOriginal: string;
  contenido: Buffer;
  tipo?: string;
}

export async function guardarAdjunto(datos: DatosAdjunto) {
  if (datos.contenido.length > TAMANO_MAXIMO_BYTES) {
    throw new ErrorValidacion(`El archivo supera el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB)`);
  }
  const extension = path.extname(datos.nombreOriginal).toLowerCase();
  if (!EXTENSIONES_PERMITIDAS.includes(extension)) {
    throw new ErrorValidacion(`Extensión no permitida: ${extension}. Se aceptan: ${EXTENSIONES_PERMITIDAS.join(", ")}`);
  }

  await asegurarDirectorio();
  const nombreDisco = `${randomUUID()}${extension}`;
  await writeFile(path.join(DIRECTORIO_ADJUNTOS, nombreDisco), datos.contenido);

  return prisma.adjunto.create({
    data: {
      entidad: datos.entidad,
      entidadId: datos.entidadId,
      nombre: datos.nombreOriginal,
      url: nombreDisco, // nombre real en disco; nunca se expone directamente al cliente
      tipo: datos.tipo,
    },
  });
}

export async function listarAdjuntos(entidad: string, entidadId: string) {
  return prisma.adjunto.findMany({ where: { entidad, entidadId }, orderBy: { creadoEn: "desc" } });
}

export async function leerAdjunto(id: string): Promise<{ nombre: string; contenido: Buffer; tipo: string | null }> {
  const adjunto = await prisma.adjunto.findUnique({ where: { id } });
  if (!adjunto) throw new ErrorNoEncontrado("Adjunto no encontrado");
  const contenido = await readFile(path.join(DIRECTORIO_ADJUNTOS, adjunto.url));
  return { nombre: adjunto.nombre, contenido, tipo: adjunto.tipo };
}

export async function eliminarAdjunto(id: string) {
  const adjunto = await prisma.adjunto.findUnique({ where: { id } });
  if (!adjunto) throw new ErrorNoEncontrado("Adjunto no encontrado");
  await unlink(path.join(DIRECTORIO_ADJUNTOS, adjunto.url)).catch(() => undefined);
  await prisma.adjunto.delete({ where: { id } });
}
