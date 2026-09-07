#!/usr/bin/env -S node --import tsx
// Script de conciliación de saldos: reconstruye saldos_inventario desde
// movimientos_inventario (la fuente de verdad) y reporta cualquier
// diferencia. Uso:
//   npm run reconciliar -- <rut-o-id-de-empresa>
// Termina con código de salida distinto de cero si encuentra diferencias,
// para poder usarse en un chequeo automatizado.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { reconciliarSaldos } from "../src/modules/inventario/reconciliacion.service.js";

async function main() {
  const identificador = process.argv[2];
  if (!identificador) {
    console.error("Uso: npm run reconciliar -- <rut-o-id-de-empresa>");
    process.exit(2);
  }

  const empresa = await prisma.empresa.findFirst({ where: { OR: [{ id: identificador }, { rut: identificador }] } });
  if (!empresa) {
    console.error(`No se encontró una empresa con RUT o ID '${identificador}'`);
    process.exit(2);
  }

  console.log(`Conciliando saldos de "${empresa.razonSocial}" (${empresa.rut})...`);
  const { totalRevisados, diferencias } = await reconciliarSaldos(empresa.id);
  console.log(`Saldos revisados: ${totalRevisados}`);

  if (diferencias.length === 0) {
    console.log("Sin diferencias: todos los saldos coinciden con el historial de movimientos.");
    process.exit(0);
  }

  console.log(`\nSe encontraron ${diferencias.length} diferencia(s):\n`);
  console.table(
    diferencias.map((d) => ({
      producto: d.productoCodigo,
      ubicacion: d.ubicacionId,
      lote: d.loteId ?? "-",
      estado: d.estado,
      calculado: d.cantidadCalculada,
      registrado: d.cantidadRegistrada,
      diferencia: d.diferencia,
    }))
  );
  process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
