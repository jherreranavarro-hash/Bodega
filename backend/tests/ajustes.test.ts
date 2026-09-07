import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";
import { planificarConteo, registrarConteoFisico, generarAjusteDesdeConteo, aprobarAjuste } from "../src/modules/ajustes/ajuste.service.js";
import { calcularDisponibilidad } from "../src/modules/inventario/inventario.service.js";

describe("Caso 10: ajustar una diferencia de inventario exige motivo, autorización y evidencia", () => {
  it("no modifica stock hasta que el ajuste es aprobado, y exige motivo con evidencia cuando corresponde", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-AJ-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 40, cantidadAceptada: 40, costoUnitario: 50 }],
    });

    const conteo = await planificarConteo({
      folio: "CNT-0001",
      bodegaId: e.bodega.id,
      tipo: "CICLICO",
      conteoCiego: true,
      responsableId: e.usuario.id,
      fechaCorte: new Date(),
      lineas: [{ productoId: e.producto.id, ubicacionId: e.ubicacionAlmacen.id }],
    });
    expect(conteo.detalle[0].cantidadEsperada.toString()).toBe("40");

    await registrarConteoFisico(conteo.detalle[0].id, 33); // faltan 7 unidades

    const motivoConEvidencia = await prisma.motivo.create({
      data: { empresaId: e.empresa.id, categoria: "AJUSTE", codigo: "MERMA", nombre: "Merma", requiereEvidencia: true },
    });

    // Exige evidencia si el motivo la requiere.
    await expect(
      generarAjusteDesdeConteo({ conteoId: conteo.id, motivoId: motivoConEvidencia.id, folio: "AJ-0001", solicitadoPorId: e.usuario.id })
    ).rejects.toThrow();

    const ajuste = await generarAjusteDesdeConteo({
      conteoId: conteo.id,
      motivoId: motivoConEvidencia.id,
      folio: "AJ-0001",
      solicitadoPorId: e.usuario.id,
      evidenciaUrl: "https://evidencia.local/foto-merma.jpg",
    });
    expect(ajuste).not.toBeNull();
    expect(ajuste!.estado).toBe("PENDIENTE_APROBACION");

    // El stock sigue en 40 mientras el ajuste no se aprueba.
    let disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("40");

    const aprobador = await prisma.usuario.create({
      data: { empresaId: e.empresa.id, email: `aprobador-${Date.now()}@test.local`, nombre: "Aprobador", passwordHash: "x", rolId: e.usuario.rolId },
    });
    const resultado = await aprobarAjuste(ajuste!.id, e.empresa.id, aprobador.id);
    expect(resultado.estado).toBe("APROBADO");

    disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("33");

    const movimientoAjuste = await prisma.movimientoInventario.findFirstOrThrow({ where: { productoId: e.producto.id, operacion: { documentoOrigen: "AJ-0001" } } });
    expect(movimientoAjuste.cantidad.toString()).toBe("7");
    expect(movimientoAjuste.ubicacionOrigenId).toBe(e.ubicacionAlmacen.id);
  });
});
