import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";

describe("Multimoneda: recepción en moneda distinta a la de la empresa", () => {
  it("exige tipo de cambio si la moneda de la línea difiere de la moneda de la empresa", async () => {
    const e = await crearEscenario(); // empresa creada en CLP (default)
    await expect(
      contabilizarRecepcion({
        empresaId: e.empresa.id,
        folio: "REC-USD-1",
        bodegaId: e.bodega.id,
        fechaEfectiva: new Date(),
        usuarioId: e.usuario.id,
        detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 5, moneda: "USD" }],
      })
    ).rejects.toThrow();
  });

  it("convierte el costo a la moneda base y guarda moneda original y tipo de cambio en la capa de costo", async () => {
    const e = await crearEscenario();
    const recepcion = await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-USD-2",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 5, moneda: "USD", tipoCambio: 950 }],
    });

    // El documento de recepción conserva el costo tal como fue facturado (en USD).
    const detalle = await prisma.recepcionDetalle.findFirstOrThrow({ where: { recepcionId: recepcion.id } });
    expect(detalle.costoUnitario.toString()).toBe("5");

    // La capa de costo y el movimiento quedan valorizados en la moneda base (CLP): 5 * 950 = 4750.
    const capa = await prisma.capaCosto.findFirstOrThrow({ where: { productoId: e.producto.id } });
    expect(capa.costoUnitario.toString()).toBe("4750");
    expect(capa.moneda).toBe("USD");
    expect(capa.tipoCambio?.toString()).toBe("950");

    const movimiento = await prisma.movimientoInventario.findFirstOrThrow({ where: { productoId: e.producto.id, operacion: { documentoOrigen: "REC-USD-2" } } });
    expect(movimiento.costoUnitario?.toString()).toBe("4750");
  });

  it("sin moneda indicada, asume la moneda de la empresa y no exige tipo de cambio", async () => {
    const e = await crearEscenario();
    const recepcion = await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-CLP-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 100 }],
    });
    expect(recepcion.estado).toBe("CONTABILIZADA");
    const capa = await prisma.capaCosto.findFirstOrThrow({ where: { productoId: e.producto.id, fuenteId: recepcion.id } });
    expect(capa.costoUnitario.toString()).toBe("100");
    expect(capa.moneda).toBe("CLP");
    expect(capa.tipoCambio).toBeNull();
  });
});
