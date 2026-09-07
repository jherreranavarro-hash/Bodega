import { Prisma, TipoUbicacion } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Ubicación técnica de una bodega (una por bodega y tipo), autoprovisionada la
 * primera vez que se necesita. Se usa para representar existencias que no son
 * almacenamiento normal: tránsito entre bodegas, cuarentena de devoluciones.
 */
export async function obtenerUbicacionTecnica(tx: Tx, bodegaId: string, tipo: TipoUbicacion, codigo: string, nombre: string) {
  const existente = await tx.ubicacion.findFirst({ where: { bodegaId, tipo } });
  if (existente) return existente;
  return tx.ubicacion.create({ data: { bodegaId, codigo, nombre, tipo } });
}
