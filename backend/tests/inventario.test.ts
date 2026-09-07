import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario, crearSolicitudSalida } from "./fixtures.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";
import { contabilizarDespacho } from "../src/modules/despachos/despacho.service.js";
import { crearReserva, calcularDisponibilidad, registrarMovimiento, crearOperacion } from "../src/modules/inventario/inventario.service.js";
import { despacharTransferencia, recibirTransferencia } from "../src/modules/transferencias/transferencia.service.js";
import { EstadoInventario, TipoOperacion } from "@prisma/client";

describe("Caso 1-3: recepción, reserva y despacho parcial (sección 16 del prompt)", () => {
  it("recibir 100 unidades deja existencia física de 100 con movimiento vinculado", async () => {
    const e = await crearEscenario();
    const recepcion = await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-0001",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [
        {
          productoId: e.producto.id,
          ubicacionDestinoId: e.ubicacionAlmacen.id,
          cantidadRecibida: 100,
          cantidadAceptada: 100,
          costoUnitario: 1000,
        },
      ],
    });

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("100");
    expect(disponibilidad.stockUtilizable.toString()).toBe("100");
    expect(disponibilidad.stockLibre.toString()).toBe("100");

    const movimientos = await prisma.movimientoInventario.findMany({ where: { productoId: e.producto.id, operacion: { documentoOrigen: "REC-0001" } } });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].cantidad.toString()).toBe("100");
    expect(movimientos[0].ubicacionDestinoId).toBe(e.ubicacionAlmacen.id);
    expect(recepcion.estado).toBe("CONTABILIZADA");
  });

  it("reservar 20 y luego despachar 15 deja física 85, reserva pendiente 5 y libre 80", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-0002",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 100, cantidadAceptada: 100, costoUnitario: 1000 }],
    });

    const solicitud = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 20 });
    const reserva = await prisma.$transaction((tx) =>
      crearReserva(tx, { solicitudDetalleId: solicitud.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 20 })
    );

    let disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("100");
    expect(disponibilidad.stockReservado.toString()).toBe("20");
    expect(disponibilidad.stockLibre.toString()).toBe("80");

    await contabilizarDespacho({
      empresaId: e.empresa.id,
      folio: "DESP-0001",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, reservaDetalleId: reserva.detalle[0].id, cantidad: 15 }],
    });

    disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("85");
    expect(disponibilidad.stockReservado.toString()).toBe("5");
    expect(disponibilidad.stockLibre.toString()).toBe("80");

    const reservaActualizada = await prisma.reserva.findUniqueOrThrow({ where: { id: reserva.id } });
    expect(reservaActualizada.estado).toBe("CONSUMIDA_PARCIAL");
  });
});

describe("Caso 4: control de concurrencia en reservas", () => {
  it("no permite sobrecomprometer existencias con reservas simultáneas", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-0003",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 500 }],
    });

    const s1 = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 7 });
    const s2 = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 7 });

    const resultados = await Promise.allSettled([
      prisma.$transaction((tx) => crearReserva(tx, { solicitudDetalleId: s1.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 7 })),
      prisma.$transaction((tx) => crearReserva(tx, { solicitudDetalleId: s2.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 7 })),
    ]);

    const exitosas = resultados.filter((r) => r.status === "fulfilled");
    const fallidas = resultados.filter((r) => r.status === "rejected");
    expect(exitosas).toHaveLength(1);
    expect(fallidas).toHaveLength(1);

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockReservado.toString()).toBe("7");
    expect(Number(disponibilidad.stockLibre.toString())).toBeGreaterThanOrEqual(0);
  });
});

describe("Caso: impide existencias negativas por defecto", () => {
  it("rechaza un despacho directo por más cantidad de la disponible", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-0004",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 5, cantidadAceptada: 5, costoUnitario: 100 }],
    });

    await expect(
      contabilizarDespacho({
        empresaId: e.empresa.id,
        folio: "DESP-0002",
        bodegaId: e.bodega.id,
        fechaEfectiva: new Date(),
        usuarioId: e.usuario.id,
        detalle: [{ productoId: e.producto.id, ubicacionOrigenId: e.ubicacionAlmacen.id, cantidad: 999 }],
      })
    ).rejects.toThrow();

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("5");
  });
});

describe("Caso: producto bloqueado o vencido no se puede despachar", () => {
  it("un saldo en estado BLOQUEADO no está disponible para despacho normal", async () => {
    const e = await crearEscenario();
    const operacion = await prisma.$transaction((tx) =>
      crearOperacion(tx, { empresaId: e.empresa.id, bodegaId: e.bodega.id, tipo: TipoOperacion.RECEPCION, fechaEfectiva: new Date(), usuarioId: e.usuario.id })
    );
    await prisma.$transaction((tx) =>
      registrarMovimiento(tx, {
        operacionId: operacion.id,
        productoId: e.producto.id,
        ubicacionDestinoId: e.ubicacionCuarentena.id,
        estadoInventario: EstadoInventario.BLOQUEADO,
        cantidad: 10,
        fechaEfectiva: new Date(),
      })
    );

    await expect(
      contabilizarDespacho({
        empresaId: e.empresa.id,
        folio: "DESP-0003",
        bodegaId: e.bodega.id,
        fechaEfectiva: new Date(),
        usuarioId: e.usuario.id,
        detalle: [{ productoId: e.producto.id, ubicacionOrigenId: e.ubicacionCuarentena.id, cantidad: 5 }],
      })
    ).rejects.toThrow();
  });
});

describe("Caso 7: transferencia entre bodegas sin doble conteo", () => {
  it("origen queda sin disponible, mercadería en tránsito y destino solo aumenta al recibir", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-0005",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 50, cantidadAceptada: 50, costoUnitario: 200 }],
    });

    const transferencia = await despacharTransferencia({
      empresaId: e.empresa.id,
      folio: "TRF-0001",
      bodegaOrigenId: e.bodega.id,
      bodegaDestinoId: e.bodegaDestino.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ productoId: e.producto.id, ubicacionOrigenId: e.ubicacionAlmacen.id, cantidad: 30 }],
    });

    let dispOrigen = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    let dispDestino = await calcularDisponibilidad(e.producto.id, e.bodegaDestino.id);
    expect(dispOrigen.stockUtilizable.toString()).toBe("20");
    expect(dispDestino.stockTransito.toString()).toBe("30");
    expect(dispDestino.stockUtilizable.toString()).toBe("0");

    await recibirTransferencia({
      transferenciaId: transferencia.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ transferenciaDetalleId: transferencia.detalle[0].id, productoId: e.producto.id, cantidad: 30, ubicacionDestinoId: e.ubicacionDestino.id }],
    });

    dispOrigen = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    dispDestino = await calcularDisponibilidad(e.producto.id, e.bodegaDestino.id);
    expect(dispOrigen.stockUtilizable.toString()).toBe("20");
    expect(dispDestino.stockTransito.toString()).toBe("0");
    expect(dispDestino.stockUtilizable.toString()).toBe("30");

    // Conservación total: nada se creó ni se perdió en el traslado.
    const totalSistema = dispOrigen.stockFisicoTotal.plus(dispDestino.stockFisicoTotal);
    expect(totalSistema.toString()).toBe("50");
  });
});

describe("Caso 9: recepción parcial de una compra", () => {
  it("actualiza lo recibido y mantiene visible el saldo pendiente", async () => {
    const e = await crearEscenario();
    const oc = await prisma.ordenCompra.create({
      data: {
        empresaId: e.empresa.id,
        folio: "OC-0001",
        proveedorId: (await prisma.proveedor.create({ data: { empresaId: e.empresa.id, codigo: "PROV-T", razonSocial: "Proveedor Test" } })).id,
        estado: "APROBADA",
        detalle: { create: [{ productoId: e.producto.id, unidadId: e.unidad.id, cantidadPedida: 100, costoUnitarioPactado: 10 }] },
      },
      include: { detalle: true },
    });

    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-PARCIAL-1",
      bodegaId: e.bodega.id,
      ordenCompraId: oc.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ ordenCompraDetalleId: oc.detalle[0].id, productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 60, cantidadAceptada: 60, costoUnitario: 10 }],
    });

    const ocActualizada = await prisma.ordenCompra.findUniqueOrThrow({ where: { id: oc.id }, include: { detalle: true } });
    expect(ocActualizada.estado).toBe("RECEPCION_PARCIAL");
    expect(ocActualizada.detalle[0].cantidadRecibida.toString()).toBe("60");
    const pendiente = ocActualizada.detalle[0].cantidadPedida.minus(ocActualizada.detalle[0].cantidadRecibida);
    expect(pendiente.toString()).toBe("40");
  });
});
