-- AlterTable
ALTER TABLE "devoluciones" ADD COLUMN     "operacion_ingreso_id" TEXT;

-- AlterTable
ALTER TABLE "devoluciones_detalle" ADD COLUMN     "evidencia_url" TEXT,
ADD COLUMN     "motivo_resolucion_id" TEXT,
ADD COLUMN     "operacion_resolucion_id" TEXT,
ADD COLUMN     "resuelto_en" TIMESTAMP(3),
ADD COLUMN     "resuelto_por_id" TEXT;

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

