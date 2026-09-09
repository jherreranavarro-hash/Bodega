-- DropIndex
DROP INDEX "demanda_registrada_producto_id_bodega_id_fecha_idx";

-- AlterTable
ALTER TABLE "demanda_registrada" ALTER COLUMN "cantidad_solicitada" SET DEFAULT 0,
ALTER COLUMN "cantidad_atendida" SET DEFAULT 0,
ALTER COLUMN "cantidad_no_atendida" SET DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "demanda_registrada_producto_id_bodega_id_fecha_key" ON "demanda_registrada"("producto_id", "bodega_id", "fecha");

