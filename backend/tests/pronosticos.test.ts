import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario, crearSolicitudSalida } from "./fixtures.js";
import { calcularPronostico, simularEscenario } from "../src/modules/analitica/pronostico.service.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";

describe("Caso 14: solicitar un pronóstico sin información suficiente", () => {
  it("informa la limitación explícitamente, sin inventar una precisión", async () => {
    const e = await crearEscenario();
    const resultado = await calcularPronostico(e.producto.id, e.bodega.id);
    expect(resultado.suficiente).toBe(false);
    if (!resultado.suficiente) {
      expect(resultado.diasDisponibles).toBe(0);
      expect(resultado.mensaje).toContain("No se genera un pronóstico");
    }

    // No debe haber quedado persistido ningún pronóstico fabricado.
    const pronosticosGuardados = await prisma.pronostico.count({ where: { productoId: e.producto.id } });
    expect(pronosticosGuardados).toBe(0);
  });
});

describe("Pronóstico con historia suficiente", () => {
  it("calcula demanda estimada y su error frente a una regla simple, declarando limitaciones", async () => {
    const e = await crearEscenario();
    // 8 días de demanda real registrada directamente (evita depender de reloj/zonas horarias en la creación de solicitudes).
    for (let i = 0; i < 8; i++) {
      const fecha = new Date();
      fecha.setUTCDate(fecha.getUTCDate() - i);
      await prisma.demandaRegistrada.create({
        data: { productoId: e.producto.id, bodegaId: e.bodega.id, fecha: new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())), cantidadSolicitada: 10 + i, cantidadAtendida: 10, cantidadNoAtendida: 0 },
      });
    }

    const resultado = await calcularPronostico(e.producto.id, e.bodega.id);
    expect(resultado.suficiente).toBe(true);
    if (resultado.suficiente) {
      expect(Number(resultado.demandaEstimada)).toBeGreaterThan(0);
      expect(resultado.diasHistoriaUsados).toBe(8);
      expect(resultado.limitaciones.length).toBeGreaterThan(0);
    }

    const guardado = await prisma.pronostico.findFirstOrThrow({ where: { productoId: e.producto.id, bodegaId: e.bodega.id } });
    expect(guardado.metodo).toBe("PROMEDIO_MOVIL");
  });
});

describe("Registro de demanda desde solicitudes y despachos reales", () => {
  it("acumula lo solicitado y lo atendido del mismo día sin duplicar", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-DEM-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 40, cantidadAceptada: 40, costoUnitario: 100 }],
    });

    const solicitud = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 12 });
    const { registrarDemandaSolicitada, registrarDemandaAtendida } = await import("../src/modules/analitica/demanda.service.js");
    await registrarDemandaSolicitada(prisma, { productoId: e.producto.id, bodegaId: e.bodega.id, fecha: new Date(), cantidad: 12 });

    const { crearReserva } = await import("../src/modules/inventario/inventario.service.js");
    const { contabilizarDespacho } = await import("../src/modules/despachos/despacho.service.js");
    const reserva = await prisma.$transaction((tx) =>
      crearReserva(tx, { solicitudDetalleId: solicitud.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 12 })
    );
    await contabilizarDespacho({
      empresaId: e.empresa.id,
      folio: "DESP-DEM-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, reservaDetalleId: reserva.detalle[0].id, cantidad: 12 }],
    });

    const dia = new Date();
    const fila = await prisma.demandaRegistrada.findUniqueOrThrow({
      where: { productoId_bodegaId_fecha: { productoId: e.producto.id, bodegaId: e.bodega.id, fecha: new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate())) } },
    });
    expect(fila.cantidadSolicitada.toString()).toBe("12");
    expect(fila.cantidadAtendida.toString()).toBe("12");
    expect(fila.cantidadNoAtendida.toString()).toBe("0");
  });
});

describe("Simulación de escenarios", () => {
  it("muestra sus supuestos, se diferencia de los datos reales y no altera los parámetros reales", async () => {
    const e = await crearEscenario();
    await prisma.parametroReposicion.create({
      data: { productoId: e.producto.id, bodegaId: e.bodega.id, stockMinimo: 10, stockMaximo: 200, stockSeguridad: 5, plazoReposicionDias: 4, demandaDiariaEstimada: 8 },
    });

    const escenario = await simularEscenario({
      nombre: "Aumento de demanda 50% + atraso proveedor 3 días",
      productoId: e.producto.id,
      bodegaId: e.bodega.id,
      creadoPorId: e.usuario.id,
      incrementoDemandaPct: 50,
      retrasoProveedorDias: 3,
    });

    const resultado = escenario.resultado as { esSimulacion: boolean; puntoReposicionActual: string; puntoReposicionSimulado: string };
    expect(resultado.esSimulacion).toBe(true);
    // Punto de reposición actual: 8*4+5 = 37. Simulado: 12*7+5 = 89.
    expect(resultado.puntoReposicionActual).toBe("37.00");
    expect(resultado.puntoReposicionSimulado).toBe("89.00");

    const parametroReal = await prisma.parametroReposicion.findUniqueOrThrow({ where: { productoId_bodegaId: { productoId: e.producto.id, bodegaId: e.bodega.id } } });
    expect(parametroReal.demandaDiariaEstimada?.toString()).toBe("8"); // el parámetro real no cambió
  });

  it("rechaza simular un producto/bodega sin parámetros de reposición configurados", async () => {
    const e = await crearEscenario();
    await expect(
      simularEscenario({ nombre: "Sin parámetros", productoId: e.producto.id, bodegaId: e.bodega.id, creadoPorId: e.usuario.id })
    ).rejects.toThrow();
  });
});
