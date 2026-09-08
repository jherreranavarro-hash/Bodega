-- AlterTable
ALTER TABLE "precios_venta" ADD COLUMN     "afecto_iva" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "precio_venta_con_iva" DECIMAL(14,2);

