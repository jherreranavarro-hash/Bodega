-- CreateEnum
CREATE TYPE "ModoPrecioVenta" AS ENUM ('FIJO', 'PORCENTAJE');

-- AlterTable
ALTER TABLE "cargas_datos" ADD COLUMN     "contexto" JSONB;

-- AlterTable
ALTER TABLE "productos" ADD COLUMN     "codigo_mercado_libre" TEXT,
ADD COLUMN     "codigo_original_proveedor" TEXT,
ADD COLUMN     "grupo" TEXT;

-- CreateTable
CREATE TABLE "llegadas_producto" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "carga_id" TEXT,
    "movimiento_id" TEXT,
    "grupo" TEXT,
    "titulo_original" TEXT,
    "condicion" TEXT,
    "status" TEXT,
    "sub_status" TEXT,
    "grade" TEXT,
    "cantidad_solicitada" DECIMAL(14,4),
    "cantidad_colectada" DECIMAL(14,4),
    "cantidad_enviada" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "peso_kg" DECIMAL(14,4),
    "valor_clp" DECIMAL(14,2),
    "valor_usd" DECIMAL(14,2),
    "fecha_llegada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llegadas_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precios_venta" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "modo" "ModoPrecioVenta" NOT NULL DEFAULT 'PORCENTAJE',
    "precio_fijo_clp" DECIMAL(14,2),
    "porcentaje_margen" DECIMAL(7,4),
    "valor_referencia_clp" DECIMAL(14,2),
    "valor_referencia_usd" DECIMAL(14,2),
    "precio_venta_calculado" DECIMAL(14,2),
    "actualizado_por_id" TEXT,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precios_venta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llegadas_producto_movimiento_id_key" ON "llegadas_producto"("movimiento_id");

-- CreateIndex
CREATE INDEX "llegadas_producto_empresa_id_producto_id_idx" ON "llegadas_producto"("empresa_id", "producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "precios_venta_producto_id_key" ON "precios_venta"("producto_id");

-- CreateIndex
CREATE UNIQUE INDEX "productos_empresa_id_codigo_mercado_libre_key" ON "productos"("empresa_id", "codigo_mercado_libre");

-- AddForeignKey
ALTER TABLE "llegadas_producto" ADD CONSTRAINT "llegadas_producto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llegadas_producto" ADD CONSTRAINT "llegadas_producto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llegadas_producto" ADD CONSTRAINT "llegadas_producto_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llegadas_producto" ADD CONSTRAINT "llegadas_producto_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "cargas_datos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llegadas_producto" ADD CONSTRAINT "llegadas_producto_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios_venta" ADD CONSTRAINT "precios_venta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios_venta" ADD CONSTRAINT "precios_venta_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

