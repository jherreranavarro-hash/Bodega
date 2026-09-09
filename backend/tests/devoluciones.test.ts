import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";
import { registrarIngresoDevolucion, resolverDevolucionDetalle } from "../src/modules/devoluciones/devolucion.service.js";
import { calcularDisponibilidad } from "../src/modules/inventario/inventario.service.js";

async function crearMotivo(empresaId: string, categoria: string, requiereEvidencia: boolean) {
  return prisma.motivo.create({ data: { empresaId, categoria, codigo: `M-${Date.now()}-${Math.random()}`, nombre: "Motivo de prueba", requiereEvidencia } });
}

describe("Devoluciones: ingreso a cuarentena y resolución", () => {
  it("una devolución recién ingresada no aumenta el stock disponible", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-DEV-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 20, cantidadAceptada: 20, costoUnitario: 100 }],
    });
    // Despachamos 5 para simular que salió y ahora vuelve.
    const motivoDevolucion = await crearMotivo(e.empresa.id, "DEVOLUCION", false);

    const devolucion = await registrarIngresoDevolucion({
      empresaId: e.empresa.id,
      folio: "DEV-0001",
      bodegaId: e.bodega.id,
      motivoId: motivoDevolucion.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ productoId: e.producto.id, cantidad: 5 }],
    });

    expect(devolucion.estado).toBe("PENDIENTE_INSPECCION");

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    // El físico total sube (20 recepción + 5 devolución = 25) pero lo utilizable/disponible sigue en 20:
    // los 5 quedan en cuarentena, no se suman automáticamente al stock disponible.
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("25");
    expect(disponibilidad.stockUtilizable.toString()).toBe("20");
    expect(disponibilidad.stockCuarentena.toString()).toBe("5");
  });

  it("resolver como BAJA exige motivo (con evidencia si corresponde) y da de baja definitivamente", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-DEV-2",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 100 }],
    });
    const motivoDevolucion = await crearMotivo(e.empresa.id, "DEVOLUCION", false);
    const motivoBajaConEvidencia = await crearMotivo(e.empresa.id, "BAJA", true);

    const devolucion = await registrarIngresoDevolucion({
      empresaId: e.empresa.id,
      folio: "DEV-0002",
      bodegaId: e.bodega.id,
      motivoId: motivoDevolucion.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ productoId: e.producto.id, cantidad: 4 }],
    });

    const resolutor = await prisma.usuario.create({
      data: { empresaId: e.empresa.id, email: `resolutor-${Date.now()}@test.local`, nombre: "Resolutor", passwordHash: "x", rolId: e.usuario.rolId },
    });

    // Sin motivo -> rechazado.
    await expect(
      resolverDevolucionDetalle({
        detalleId: devolucion.detalle[0].id,
        resolucion: "BAJA",
        resueltoPorId: resolutor.id,
        fechaEfectiva: new Date(),
      })
    ).rejects.toThrow();

    // Con motivo que exige evidencia pero sin evidencia -> rechazado.
    await expect(
      resolverDevolucionDetalle({
        detalleId: devolucion.detalle[0].id,
        resolucion: "BAJA",
        resueltoPorId: resolutor.id,
        fechaEfectiva: new Date(),
        motivoResolucionId: motivoBajaConEvidencia.id,
      })
    ).rejects.toThrow();

    const resuelto = await resolverDevolucionDetalle({
      detalleId: devolucion.detalle[0].id,
      resolucion: "BAJA",
      resueltoPorId: resolutor.id,
      fechaEfectiva: new Date(),
      motivoResolucionId: motivoBajaConEvidencia.id,
      evidenciaUrl: "https://evidencia.local/foto.jpg",
    });
    expect(resuelto.resolucion).toBe("BAJA");

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("10"); // 4 se dieron de baja del total de 14
    expect(disponibilidad.stockCuarentena.toString()).toBe("0");

    const devolucionActualizada = await prisma.devolucion.findUniqueOrThrow({ where: { id: devolucion.id } });
    expect(devolucionActualizada.estado).toBe("RESUELTA");
  });

  it("resolver como REINGRESO_DISPONIBLE devuelve el producto a stock utilizable", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-DEV-3",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 100 }],
    });
    const motivoDevolucion = await crearMotivo(e.empresa.id, "DEVOLUCION", false);
    const devolucion = await registrarIngresoDevolucion({
      empresaId: e.empresa.id,
      folio: "DEV-0003",
      bodegaId: e.bodega.id,
      motivoId: motivoDevolucion.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ productoId: e.producto.id, cantidad: 3 }],
    });

    const resolutor = await prisma.usuario.create({
      data: { empresaId: e.empresa.id, email: `resolutor2-${Date.now()}@test.local`, nombre: "Resolutor 2", passwordHash: "x", rolId: e.usuario.rolId },
    });

    await resolverDevolucionDetalle({
      detalleId: devolucion.detalle[0].id,
      resolucion: "REINGRESO_DISPONIBLE",
      resueltoPorId: resolutor.id,
      fechaEfectiva: new Date(),
      ubicacionDestinoId: e.ubicacionAlmacen.id,
    });

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockUtilizable.toString()).toBe("13");
    expect(disponibilidad.stockCuarentena.toString()).toBe("0");
  });

  it("quien registra la devolución no puede resolverla (separación de funciones)", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-DEV-4",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 100 }],
    });
    const motivoDevolucion = await crearMotivo(e.empresa.id, "DEVOLUCION", false);
    const devolucion = await registrarIngresoDevolucion({
      empresaId: e.empresa.id,
      folio: "DEV-0004",
      bodegaId: e.bodega.id,
      motivoId: motivoDevolucion.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ productoId: e.producto.id, cantidad: 2 }],
    });

    await expect(
      resolverDevolucionDetalle({
        detalleId: devolucion.detalle[0].id,
        resolucion: "CUARENTENA",
        resueltoPorId: e.usuario.id, // mismo usuario que registró
        fechaEfectiva: new Date(),
      })
    ).rejects.toThrow();
  });
});
