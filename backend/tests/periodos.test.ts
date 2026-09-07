import { describe, it, expect } from "vitest";
import { crearEscenario } from "./fixtures.js";
import { definirFechaCierre, obtenerFechaCierre } from "../src/modules/inventario/periodos.service.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";

describe("Manejo de períodos cerrados", () => {
  it("rechaza registrar una operación con fecha efectiva dentro de un período cerrado", async () => {
    const e = await crearEscenario();
    const fechaCierre = new Date();
    fechaCierre.setUTCDate(fechaCierre.getUTCDate() - 1); // cierra hasta ayer
    await definirFechaCierre(e.empresa.id, fechaCierre);

    const fechaAtrasada = new Date(fechaCierre);
    fechaAtrasada.setUTCDate(fechaAtrasada.getUTCDate() - 5); // muy anterior al cierre

    await expect(
      contabilizarRecepcion({
        empresaId: e.empresa.id,
        folio: "REC-PERIODO-1",
        bodegaId: e.bodega.id,
        fechaEfectiva: fechaAtrasada,
        usuarioId: e.usuario.id,
        detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 5, cantidadAceptada: 5, costoUnitario: 10 }],
      })
    ).rejects.toThrow();
  });

  it("permite operaciones con fecha efectiva posterior al cierre", async () => {
    const e = await crearEscenario();
    const fechaCierre = new Date();
    fechaCierre.setUTCDate(fechaCierre.getUTCDate() - 30);
    await definirFechaCierre(e.empresa.id, fechaCierre);

    const recepcion = await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-PERIODO-2",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 5, cantidadAceptada: 5, costoUnitario: 10 }],
    });
    expect(recepcion.estado).toBe("CONTABILIZADA");
  });

  it("no permite retroceder una fecha de cierre ya establecida", async () => {
    const e = await crearEscenario();
    const primeraFecha = new Date();
    await definirFechaCierre(e.empresa.id, primeraFecha);

    const fechaAnterior = new Date(primeraFecha);
    fechaAnterior.setUTCDate(fechaAnterior.getUTCDate() - 10);
    await expect(definirFechaCierre(e.empresa.id, fechaAnterior)).rejects.toThrow();

    const vigente = await obtenerFechaCierre(e.empresa.id);
    expect(vigente?.getTime()).toBe(primeraFecha.getTime());
  });

  it("sin fecha de cierre configurada, no restringe ninguna fecha efectiva", async () => {
    const e = await crearEscenario();
    const fechaCierre = await obtenerFechaCierre(e.empresa.id);
    expect(fechaCierre).toBeNull();

    const fechaMuyAntigua = new Date("2000-01-01");
    const recepcion = await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-PERIODO-3",
      bodegaId: e.bodega.id,
      fechaEfectiva: fechaMuyAntigua,
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 5, cantidadAceptada: 5, costoUnitario: 10 }],
    });
    expect(recepcion.estado).toBe("CONTABILIZADA");
  });
});
