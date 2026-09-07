-- DropIndex
DROP INDEX "ajustes_folio_key";

-- DropIndex
DROP INDEX "conteos_folio_key";

-- DropIndex
DROP INDEX "devoluciones_folio_key";

-- DropIndex
DROP INDEX "preparaciones_folio_key";

-- DropIndex
DROP INDEX "transferencias_folio_key";

-- CreateIndex
CREATE UNIQUE INDEX "ajustes_bodega_id_folio_key" ON "ajustes"("bodega_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "conteos_bodega_id_folio_key" ON "conteos"("bodega_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "devoluciones_bodega_id_folio_key" ON "devoluciones"("bodega_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "transferencias_bodega_origen_id_folio_key" ON "transferencias"("bodega_origen_id", "folio");

