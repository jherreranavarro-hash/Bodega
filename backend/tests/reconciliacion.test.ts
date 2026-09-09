import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";
import { contabilizarDespacho } from "../src/modules/despachos/despacho.service.js";
import { crearReserva } from "../src/modules/inventario/inventario.service.js";
import { despacharTransferencia, recibirTransferencia } from "../src/modules/transferencias/transferencia.service.js";
import { reconciliarSaldos } from "../src/modules/inventario/reconciliacion.service.js";
import { crearSolicitudSalida } from "./fixtures.js";

describe("Reconciliación de saldos contra el historial de movimientos", () => {
  it("no reporta diferencias tras un recorrido normal de recepción, reserva y despacho", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-RECON-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 30, cantidadAceptada: 30, costoUnitario: 100 }],
    });
    const solicitud = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 10 });
    const reserva = await prisma.$transaction((tx) =>
      crearReserva(tx, { solicitudDetalleId: solicitud.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 10 })
    );
    await contabilizarDespacho({
      empresaId: e.empresa.id,
      folio: "DESP-RECON-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, reservaDetalleId: reserva.detalle[0].id, cantidad: 7 }],
    });

    const { diferencias } = await reconciliarSaldos(e.empresa.id);
    expect(diferencias.filter((d) => d.productoId === e.producto.id)).toHaveLength(0);
  });

  it("no reporta diferencias tras una transferencia entre bodegas (origen, tránsito y destino)", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-RECON-2",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 20, cantidadAceptada: 20, costoUnitario: 100 }],
    });
    const transferencia = await despacharTransferencia({
      empresaId: e.empresa.id,
      folio: "TRF-RECON-1",
      bodegaOrigenId: e.bodega.id,
      bodegaDestinoId: e.bodegaDestino.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ productoId: e.producto.id, ubicacionOrigenId: e.ubicacionAlmacen.id, cantidad: 8 }],
    });

    // Estado intermedio (parte en tránsito) también debe reconciliar sin diferencias.
    let resultado = await reconciliarSaldos(e.empresa.id);
    expect(resultado.diferencias.filter((d) => d.productoId === e.producto.id)).toHaveLength(0);

    await recibirTransferencia({
      transferenciaId: transferencia.id,
      usuarioId: e.usuario.id,
      fechaEfectiva: new Date(),
      detalle: [{ transferenciaDetalleId: transferencia.detalle[0].id, productoId: e.producto.id, cantidad: 8, ubicacionDestinoId: e.ubicacionDestino.id }],
    });

    resultado = await reconciliarSaldos(e.empresa.id);
    expect(resultado.diferencias.filter((d) => d.productoId === e.producto.id)).toHaveLength(0);
  });

  it("detecta una alteración directa de saldos_inventario que no pasó por el motor de movimientos", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-RECON-3",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 15, cantidadAceptada: 15, costoUnitario: 100 }],
    });

    // Simula una edición manual indebida directamente en la base (lo que la reconciliación existe para detectar).
    await prisma.saldoInventario.updateMany({
      where: { productoId: e.producto.id, ubicacionId: e.ubicacionAlmacen.id },
      data: { cantidadFisica: 999 },
    });

    const { diferencias } = await reconciliarSaldos(e.empresa.id);
    const diferenciaProducto = diferencias.find((d) => d.productoId === e.producto.id);
    expect(diferenciaProducto).toBeDefined();
    expect(diferenciaProducto!.cantidadCalculada).toBe("15.000000");
    expect(diferenciaProducto!.cantidadRegistrada).toBe("999.000000");
  });
});
