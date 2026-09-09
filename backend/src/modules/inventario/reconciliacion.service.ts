import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export interface DiferenciaSaldo {
  productoId: string;
  productoCodigo: string;
  ubicacionId: string;
  loteId: string | null;
  serieId: string | null;
  estado: string;
  cantidadCalculada: string;
  cantidadRegistrada: string;
  diferencia: string;
}

interface FilaCruda {
  producto_id: string;
  producto_codigo: string;
  ubicacion_id: string;
  lote_id: string | null;
  serie_id: string | null;
  estado: string;
  // Prisma decodifica NUMERIC de PostgreSQL como Prisma.Decimal, no como string.
  cantidad_calculada: Prisma.Decimal;
  cantidad_registrada: Prisma.Decimal;
}

/**
 * Reconstruye, desde movimientos_inventario (la única fuente de verdad), lo
 * que cada saldo_inventario debería valer, y lo compara contra lo realmente
 * registrado en esa tabla derivada. saldos_inventario es una proyección de
 * lectura que se actualiza junto al movimiento que la origina (ver
 * inventario.service.ts); esta reconciliación es el control independiente
 * que verifica que esa proyección nunca se haya desviado — por un bug, una
 * migración manual, o cualquier alteración fuera del motor de inventario.
 *
 * Un movimiento con origen y destino en estados de inventario distintos
 * (p. ej. una transferencia: origen DISPONIBLE, destino TRANSITO) registra
 * ambos estados por separado (estado_inventario para destino,
 * estado_inventario_origen para origen), así que cada lado se reconstruye
 * contra la "cuenta" de estado que realmente le corresponde.
 */
export async function reconciliarSaldos(empresaId: string): Promise<{ totalRevisados: number; diferencias: DiferenciaSaldo[] }> {
  const filas = await prisma.$queryRaw<FilaCruda[]>`
    WITH movimientos_expandidos AS (
      SELECT producto_id, ubicacion_destino_id AS ubicacion_id, lote_id, serie_id,
             estado_inventario AS estado, cantidad AS delta
      FROM movimientos_inventario
      WHERE ubicacion_destino_id IS NOT NULL
      UNION ALL
      SELECT producto_id, ubicacion_origen_id AS ubicacion_id, lote_id, serie_id,
             estado_inventario_origen AS estado, -cantidad AS delta
      FROM movimientos_inventario
      WHERE ubicacion_origen_id IS NOT NULL
    ),
    calculado AS (
      SELECT producto_id, ubicacion_id, lote_id, serie_id, estado, SUM(delta) AS cantidad_calculada
      FROM movimientos_expandidos
      GROUP BY 1, 2, 3, 4, 5
    ),
    comparado AS (
      SELECT
        COALESCE(c.producto_id, s.producto_id) AS producto_id,
        COALESCE(c.ubicacion_id, s.ubicacion_id) AS ubicacion_id,
        COALESCE(c.lote_id, s.lote_id) AS lote_id,
        COALESCE(c.serie_id, s.serie_id) AS serie_id,
        COALESCE(c.estado, s.estado_inventario) AS estado,
        COALESCE(c.cantidad_calculada, 0) AS cantidad_calculada,
        COALESCE(s.cantidad_fisica, 0) AS cantidad_registrada
      FROM calculado c
      FULL OUTER JOIN saldos_inventario s
        ON s.producto_id = c.producto_id
        AND s.ubicacion_id = c.ubicacion_id
        AND COALESCE(s.lote_id, '00000000-0000-0000-0000-000000000000') = COALESCE(c.lote_id, '00000000-0000-0000-0000-000000000000')
        AND COALESCE(s.serie_id, '00000000-0000-0000-0000-000000000000') = COALESCE(c.serie_id, '00000000-0000-0000-0000-000000000000')
        AND s.estado_inventario = c.estado
    )
    SELECT co.producto_id, p.codigo AS producto_codigo, co.ubicacion_id, co.lote_id, co.serie_id, co.estado,
           co.cantidad_calculada, co.cantidad_registrada
    FROM comparado co
    JOIN productos p ON p.id = co.producto_id
    WHERE p.empresa_id = ${empresaId}
      AND co.cantidad_calculada <> co.cantidad_registrada
    ORDER BY p.codigo
  `;

  const diferencias: DiferenciaSaldo[] = filas.map((f) => ({
    productoId: f.producto_id,
    productoCodigo: f.producto_codigo,
    ubicacionId: f.ubicacion_id,
    loteId: f.lote_id,
    serieId: f.serie_id,
    estado: f.estado,
    cantidadCalculada: new Prisma.Decimal(f.cantidad_calculada).toFixed(6),
    cantidadRegistrada: new Prisma.Decimal(f.cantidad_registrada).toFixed(6),
    diferencia: new Prisma.Decimal(f.cantidad_calculada).minus(new Prisma.Decimal(f.cantidad_registrada)).toFixed(6),
  }));

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM saldos_inventario s JOIN productos p ON p.id = s.producto_id WHERE p.empresa_id = ${empresaId}`;

  return { totalRevisados: Number(count), diferencias };
}
