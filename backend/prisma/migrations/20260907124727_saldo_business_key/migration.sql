-- Clave de negocio real de saldos_inventario.
-- Postgres trata cada NULL como distinto en un índice UNIQUE normal, por lo
-- que la restricción @@unique de Prisma (que sí quedó creada) NO evita filas
-- duplicadas cuando lote_id y/o serie_id son NULL (el caso más común: producto
-- sin control de lote/serie). Este índice funcional usa un UUID centinela vía
-- COALESCE para que "sin lote" y "sin serie" cuenten como un único valor
-- comparable, garantizando un solo saldo por producto+ubicación+lote+serie+estado.
CREATE UNIQUE INDEX "saldos_inventario_clave_negocio"
ON "saldos_inventario" (
  "producto_id",
  "ubicacion_id",
  COALESCE("lote_id", '00000000-0000-0000-0000-000000000000'),
  COALESCE("serie_id", '00000000-0000-0000-0000-000000000000'),
  "estado_inventario"
);
