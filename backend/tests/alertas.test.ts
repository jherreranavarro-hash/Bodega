import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { generarAlertas, aceptarAccion, rechazarAccion, convertirAccionEnSolicitud, descartarAlerta } from "../src/modules/alertas/alertas.service.js";

async function crearParametroReposicionBajo(productoId: string, bodegaId: string) {
  // demanda 2/día * plazo 3 días + seguridad 5 = punto de reposición 11; sin stock -> libre 0 -> bajo el punto.
  return prisma.parametroReposicion.create({
    data: { productoId, bodegaId, stockMinimo: 10, stockSeguridad: 5, plazoReposicionDias: 3, demandaDiariaEstimada: 2 },
  });
}

describe("Bandeja de decisiones: alertas y acciones recomendadas", () => {
  it("genera una alerta con evidencia y acción recomendada, y no la duplica en una segunda corrida", async () => {
    const e = await crearEscenario();
    await crearParametroReposicionBajo(e.producto.id, e.bodega.id);

    const primeraCorrida = await generarAlertas(e.empresa.id);
    expect(primeraCorrida.length).toBeGreaterThan(0);
    const alerta = primeraCorrida.find((a) => a.tipo === "BAJO_PUNTO_REPOSICION")!;
    expect(alerta).toBeDefined();
    expect(alerta.estado).toBe("ABIERTA");
    expect(alerta.accionesRecomendadas).toHaveLength(1);
    expect(alerta.accionesRecomendadas[0].estado).toBe("PROPUESTA");
    expect((alerta.evidencia as Record<string, unknown>).productoCodigo).toBe(e.producto.codigo);

    const segundaCorrida = await generarAlertas(e.empresa.id);
    expect(segundaCorrida).toHaveLength(0); // ya había una alerta abierta para este producto/bodega

    const totalAlertas = await prisma.alerta.count({ where: { empresaId: e.empresa.id, tipo: "BAJO_PUNTO_REPOSICION" } });
    expect(totalAlertas).toBe(1);
  });

  it("rechazar una acción exige justificación", async () => {
    const e = await crearEscenario();
    await crearParametroReposicionBajo(e.producto.id, e.bodega.id);
    const [alerta] = await generarAlertas(e.empresa.id);

    await expect(rechazarAccion(alerta.accionesRecomendadas[0].id, "")).rejects.toThrow();

    const rechazada = await rechazarAccion(alerta.accionesRecomendadas[0].id, "Ya se hizo un pedido manual esta semana");
    expect(rechazada.estado).toBe("RECHAZADA");
    expect(rechazada.justificacion).toBe("Ya se hizo un pedido manual esta semana");
  });

  it("no permite resolver dos veces la misma acción", async () => {
    const e = await crearEscenario();
    await crearParametroReposicionBajo(e.producto.id, e.bodega.id);
    const [alerta] = await generarAlertas(e.empresa.id);

    await aceptarAccion(alerta.accionesRecomendadas[0].id, e.usuario.id, "De acuerdo, se gestionará");
    await expect(aceptarAccion(alerta.accionesRecomendadas[0].id, e.usuario.id)).rejects.toThrow();
  });

  it("convertir en solicitud solo aplica a alertas de reposición y genera una solicitud PENDIENTE_APROBACION", async () => {
    const e = await crearEscenario();
    await crearParametroReposicionBajo(e.producto.id, e.bodega.id);
    const [alerta] = await generarAlertas(e.empresa.id);

    const solicitud = await convertirAccionEnSolicitud(alerta.accionesRecomendadas[0].id, e.usuario.id, "SC-ALERTA-0001", "Se necesita antes de fin de mes");
    expect(solicitud.estado).toBe("PENDIENTE_APROBACION");
    expect(solicitud.origen).toBe("ALERTA_REPOSICION");

    const accionActualizada = await prisma.accionRecomendada.findUniqueOrThrow({ where: { id: alerta.accionesRecomendadas[0].id } });
    expect(accionActualizada.estado).toBe("CONVERTIDA_SOLICITUD");

    const alertaActualizada = await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(alertaActualizada.estado).toBe("ATENDIDA");
  });

  it("no permite convertir una alerta de vencimiento en solicitud de compra", async () => {
    const e = await crearEscenario({ controlLote: true, controlVencimiento: true });
    const { contabilizarRecepcion } = await import("../src/modules/recepciones/recepcion.service.js");
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 5);
    await contabilizarRecepcion({
      empresaId: e.empresa.id,
      folio: "REC-ALERTA-VTO",
      bodegaId: e.bodega.id,
      fechaEfectiva: new Date(),
      usuarioId: e.usuario.id,
      detalle: [{ productoId: e.producto.id, ubicacionDestinoId: e.ubicacionAlmacen.id, cantidadRecibida: 10, cantidadAceptada: 10, costoUnitario: 100, loteCodigo: "LOTE-VTO-1", fechaVencimiento }],
    });

    const alertas = await generarAlertas(e.empresa.id);
    const alertaVencimiento = alertas.find((a) => a.tipo === "VENCIMIENTO_PROXIMO");
    expect(alertaVencimiento).toBeDefined();

    await expect(
      convertirAccionEnSolicitud(alertaVencimiento!.accionesRecomendadas[0].id, e.usuario.id, "SC-NO-APLICA")
    ).rejects.toThrow();
  });

  it("descartar una alerta la marca DESCARTADA", async () => {
    const e = await crearEscenario();
    await crearParametroReposicionBajo(e.producto.id, e.bodega.id);
    const [alerta] = await generarAlertas(e.empresa.id);
    const descartada = await descartarAlerta(alerta.id);
    expect(descartada.estado).toBe("DESCARTADA");
  });
});
