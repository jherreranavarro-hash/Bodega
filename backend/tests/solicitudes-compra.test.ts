import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import {
  crearSolicitudCompra,
  generarSolicitudDesdeReposicion,
  aprobarSolicitudCompra,
  rechazarSolicitudCompra,
  convertirEnOrdenCompra,
} from "../src/modules/compras/solicitud-compra.service.js";

describe("Solicitudes de compra con aprobación propia", () => {
  it("nace pendiente de aprobación y quien la solicita no puede aprobarla ni rechazarla", async () => {
    const e = await crearEscenario();
    const solicitud = await crearSolicitudCompra({
      empresaId: e.empresa.id,
      folio: "SC-0001",
      solicitanteId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, cantidad: 20, unidadId: e.unidad.id, bodegaDestinoId: e.bodega.id }],
    });
    expect(solicitud.estado).toBe("PENDIENTE_APROBACION");

    await expect(aprobarSolicitudCompra(solicitud.id, e.usuario.id)).rejects.toThrow();
    await expect(rechazarSolicitudCompra(solicitud.id, e.usuario.id)).rejects.toThrow();

    const aprobador = await prisma.usuario.create({
      data: { empresaId: e.empresa.id, email: `aprobador-sc-${Date.now()}@test.local`, nombre: "Aprobador SC", passwordHash: "x", rolId: e.usuario.rolId },
    });
    const aprobada = await aprobarSolicitudCompra(solicitud.id, aprobador.id);
    expect(aprobada.estado).toBe("APROBADA");
  });

  it("convierte una solicitud aprobada en orden de compra, exige costo por línea y no permite convertir dos veces", async () => {
    const e = await crearEscenario();
    const solicitud = await crearSolicitudCompra({
      empresaId: e.empresa.id,
      folio: "SC-0002",
      solicitanteId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, cantidad: 15, unidadId: e.unidad.id, bodegaDestinoId: e.bodega.id }],
    });
    const aprobador = await prisma.usuario.create({
      data: { empresaId: e.empresa.id, email: `aprobador-sc2-${Date.now()}@test.local`, nombre: "Aprobador SC2", passwordHash: "x", rolId: e.usuario.rolId },
    });
    await aprobarSolicitudCompra(solicitud.id, aprobador.id);

    const proveedor = await prisma.proveedor.create({ data: { empresaId: e.empresa.id, codigo: `PROV-SC-${Date.now()}`, razonSocial: "Proveedor SC" } });

    // Sin costo para la línea -> rechazado.
    await expect(
      convertirEnOrdenCompra({ solicitudId: solicitud.id, folioOrdenCompra: "OC-SC-0001", proveedorId: proveedor.id, costos: [] })
    ).rejects.toThrow();

    const orden = await convertirEnOrdenCompra({
      solicitudId: solicitud.id,
      folioOrdenCompra: "OC-SC-0001",
      proveedorId: proveedor.id,
      costos: [{ solicitudDetalleId: (await prisma.solicitudCompraDetalle.findFirstOrThrow({ where: { solicitudId: solicitud.id } })).id, costoUnitarioPactado: 250 }],
    });
    expect(orden.detalle[0].cantidadPedida.toString()).toBe("15");
    expect(orden.detalle[0].costoUnitarioPactado.toString()).toBe("250");
    expect(orden.solicitudCompraId).toBe(solicitud.id);

    await expect(
      convertirEnOrdenCompra({
        solicitudId: solicitud.id,
        folioOrdenCompra: "OC-SC-0002",
        proveedorId: proveedor.id,
        costos: [{ solicitudDetalleId: orden.detalle[0].id, costoUnitarioPactado: 250 }],
      })
    ).rejects.toThrow();
  });

  it("no permite convertir una solicitud que aún no fue aprobada", async () => {
    const e = await crearEscenario();
    const solicitud = await crearSolicitudCompra({
      empresaId: e.empresa.id,
      folio: "SC-0003",
      solicitanteId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, cantidad: 5, unidadId: e.unidad.id, bodegaDestinoId: e.bodega.id }],
    });
    const proveedor = await prisma.proveedor.create({ data: { empresaId: e.empresa.id, codigo: `PROV-SC3-${Date.now()}`, razonSocial: "Proveedor SC3" } });
    await expect(
      convertirEnOrdenCompra({
        solicitudId: solicitud.id,
        folioOrdenCompra: "OC-SC-0003",
        proveedorId: proveedor.id,
        costos: [{ solicitudDetalleId: (await prisma.solicitudCompraDetalle.findFirstOrThrow({ where: { solicitudId: solicitud.id } })).id, costoUnitarioPactado: 10 }],
      })
    ).rejects.toThrow();
  });

  it("genera la solicitud desde la alerta de reposición respetando cantidad mínima y múltiplo de pedido", async () => {
    const e = await crearEscenario();
    await prisma.producto.update({ where: { id: e.producto.id }, data: { cantidadMinimaCompra: 50, multiploPedido: 12 } });
    await prisma.parametroReposicion.create({
      data: {
        productoId: e.producto.id,
        bodegaId: e.bodega.id,
        stockMinimo: 10,
        stockSeguridad: 5,
        plazoReposicionDias: 3,
        demandaDiariaEstimada: 2, // punto de reposición = 2*3 + 5 = 11; stock libre actual = 0 -> falta 11
      },
    });

    const solicitud = await generarSolicitudDesdeReposicion({
      productoId: e.producto.id,
      bodegaId: e.bodega.id,
      solicitanteId: e.usuario.id,
      folio: "SC-REP-0001",
    });

    expect(solicitud.origen).toBe("ALERTA_REPOSICION");
    // Faltante real (11) < cantidadMinimaCompra (50) -> usa el mínimo; 50 no es múltiplo de 12 -> sube a 60.
    expect(solicitud.detalle[0].cantidad.toString()).toBe("60");
  });

  it("rechaza generar una solicitud de reposición si el producto no está bajo su punto de reposición", async () => {
    const e = await crearEscenario();
    const { contabilizarRecepcion } = await import("../src/modules/recepciones/recepcion.service.js");
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-SC-REP",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 1000, cantidadAceptada: 1000, costoUnitario: 10 }],
    });
    await prisma.parametroReposicion.create({
      data: { productoId: e.producto.id, bodegaId: e.bodega.id, stockMinimo: 10, stockSeguridad: 5, plazoReposicionDias: 3, demandaDiariaEstimada: 2 },
    });

    await expect(
      generarSolicitudDesdeReposicion({ productoId: e.producto.id, bodegaId: e.bodega.id, solicitanteId: e.usuario.id, folio: "SC-REP-0002" })
    ).rejects.toThrow();
  });
});
