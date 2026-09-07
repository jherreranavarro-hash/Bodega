import { describe, it, expect } from "vitest";
import { crearEscenario, crearSolicitudSalida } from "./fixtures.js";
import { contabilizarRecepcion } from "../src/modules/recepciones/recepcion.service.js";
import { crearReserva } from "../src/modules/inventario/inventario.service.js";
import { crearPreparacion, registrarVerificacion, marcarPreparacionLista } from "../src/modules/preparaciones/preparacion.service.js";
import { contabilizarDespacho } from "../src/modules/despachos/despacho.service.js";
import { prisma } from "../src/lib/prisma.js";

describe("Preparación como paso explícito entre reserva y despacho", () => {
  it("impide despachar referenciando una preparación que no está LISTA", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-PREP-1",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 30, cantidadAceptada: 30, costoUnitario: 100 }],
    });
    const solicitud = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 10 });
    const reserva = await prisma.$transaction((tx) =>
      crearReserva(tx, { solicitudDetalleId: solicitud.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 10 })
    );

    const preparacion = await crearPreparacion({ folio: "PREP-0001", solicitudId: solicitud.id, responsableId: e.usuario.id });
    expect(preparacion.estado).toBe("PENDIENTE");
    expect(preparacion.detalle[0].cantidadSolicitada.toString()).toBe("10");

    // Aún no verificada -> el despacho referenciando esta preparación debe rechazarse.
    await expect(
      contabilizarDespacho({
        empresaId: e.empresa.id,
        folio: "DESP-PREP-1",
        bodegaId: e.bodega.id,
        preparacionId: preparacion.id,
        fechaEfectiva: new Date(),
        usuarioId: e.usuario.id,
        detalle: [{ productoId: e.producto.id, reservaDetalleId: reserva.detalle[0].id, cantidad: 10 }],
      })
    ).rejects.toThrow();
  });

  it("solo permite marcar LISTA cuando toda línea fue completamente verificada, y luego permite despachar", async () => {
    const e = await crearEscenario();
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-PREP-2",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 30, cantidadAceptada: 30, costoUnitario: 100 }],
    });
    const solicitud = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 8 });
    const reserva = await prisma.$transaction((tx) =>
      crearReserva(tx, { solicitudDetalleId: solicitud.detalle[0].id, productoId: e.producto.id, bodegaId: e.bodega.id, cantidad: 8 })
    );

    const preparacion = await crearPreparacion({ folio: "PREP-0002", solicitudId: solicitud.id, responsableId: e.usuario.id });

    // Verificación parcial: no se puede marcar lista todavía.
    await registrarVerificacion(preparacion.detalle[0].id, 5);
    await expect(marcarPreparacionLista(preparacion.id)).rejects.toThrow();

    const preparacionEnProceso = await prisma.preparacion.findUniqueOrThrow({ where: { id: preparacion.id } });
    expect(preparacionEnProceso.estado).toBe("EN_PROCESO");

    // Completar la verificación.
    await registrarVerificacion(preparacion.detalle[0].id, 8);
    const lista = await marcarPreparacionLista(preparacion.id);
    expect(lista.estado).toBe("LISTA");

    const despacho = await contabilizarDespacho({
      empresaId: e.empresa.id,
      folio: "DESP-PREP-2",
      bodegaId: e.bodega.id,
      preparacionId: preparacion.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, reservaDetalleId: reserva.detalle[0].id, cantidad: 8 }],
    });
    expect(despacho.preparacionId).toBe(preparacion.id);
  });

  it("no permite verificar cantidades por sobre lo solicitado", async () => {
    const e = await crearEscenario();
    const solicitud = await crearSolicitudSalida({ empresaId: e.empresa.id, bodegaId: e.bodega.id, usuarioId: e.usuario.id, productoId: e.producto.id, cantidad: 3 });
    const preparacion = await crearPreparacion({ folio: "PREP-0003", solicitudId: solicitud.id, responsableId: e.usuario.id });
    await expect(registrarVerificacion(preparacion.detalle[0].id, 999)).rejects.toThrow();
  });
});
