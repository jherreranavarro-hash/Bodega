-- DropIndex
DROP INDEX "productos_empresa_id_codigo_mercado_libre_key";

-- CreateIndex
CREATE INDEX "productos_empresa_id_codigo_mercado_libre_idx" ON "productos"("empresa_id", "codigo_mercado_libre");

