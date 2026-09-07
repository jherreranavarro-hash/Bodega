import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { recibirArchivo, validarYSimular, aprobarCarga, ejecutarCarga } from "../src/modules/cargas/carga.service.js";
import { calcularDisponibilidad } from "../src/modules/inventario/inventario.service.js";

async function ejecutarFlujoCompleto(params: Parameters<typeof recibirArchivo>[0]) {
  const carga = await recibirArchivo(params);
  await validarYSimular(carga.id);
  await aprobarCarga(carga.id, params.usuarioId);
  return ejecutarCarga(carga.id, params.usuarioId);
}

describe("Caso 5: repetir una importación ya ejecutada no duplica registros", () => {
  it("retorna la misma carga y no crea movimientos adicionales", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(
      `producto_codigo,bodega_codigo,ubicacion_codigo,cantidad,unidad_codigo,costo_unitario\n${e.producto.codigo},${e.bodega.codigo},${e.ubicacionAlmacen.codigo},10,UN,100\n`
    );

    const params = { empresaId: e.empresa.id, entidad: "INVENTARIO_INICIAL", modo: "CREACION_Y_ACTUALIZACION" as const, nombreArchivo: "inicial.csv", contenido, usuarioId: e.usuario.id };

    const primeraCarga = await ejecutarFlujoCompleto(params);
    expect(primeraCarga.estado).toBe("EJECUTADA");

    // Se "sube" el mismo archivo otra vez, simulando un reintento del usuario.
    const segundaRecepcion = await recibirArchivo(params);
    expect(segundaRecepcion.id).toBe(primeraCarga.id); // misma carga por clave de idempotencia

    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("10");

    const movimientos = await prisma.movimientoInventario.findMany({ where: { productoId: e.producto.id } });
    expect(movimientos).toHaveLength(1);
  });
});

describe("Caso 6: importar una operación que referencia un producto/ubicación inexistente", () => {
  it("rechaza la fila y no crea nada por suposición", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(
      `producto_codigo,bodega_codigo,ubicacion_codigo,cantidad,unidad_codigo\nNO-EXISTE-999,${e.bodega.codigo},${e.ubicacionAlmacen.codigo},10,UN\n`
    );

    const carga = await recibirArchivo({ empresaId: e.empresa.id, entidad: "INVENTARIO_INICIAL", modo: "CREACION_Y_ACTUALIZACION", nombreArchivo: "malo.csv", contenido, usuarioId: e.usuario.id });
    const simulada = await validarYSimular(carga.id);
    expect(simulada.filasRechazar).toBe(1);
    expect(simulada.filasCrear).toBe(0);

    const errores = await prisma.cargaError.findMany({ where: { cargaId: carga.id } });
    expect(errores.some((err) => err.mensaje.includes("no existe"))).toBe(true);

    // No queda en estado aprobable porque tiene errores bloqueantes.
    await expect(aprobarCarga(carga.id, e.usuario.id)).rejects.toThrow();
  });
});

describe("Caso 8: importar cajas con conversión a unidades", () => {
  it("conserva cantidad original y factor, registrando la unidad base", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(
      `producto_codigo,bodega_codigo,ubicacion_codigo,cantidad,unidad_codigo,costo_unitario\n${e.producto.codigo},${e.bodega.codigo},${e.ubicacionAlmacen.codigo},5,CJ,120\n`
    );

    const carga = await ejecutarFlujoCompleto({ empresaId: e.empresa.id, entidad: "INVENTARIO_INICIAL", modo: "CREACION_Y_ACTUALIZACION", nombreArchivo: "cajas.csv", contenido, usuarioId: e.usuario.id });
    expect(carga.estado).toBe("EJECUTADA");

    // 5 cajas x factor 12 (definido en el fixture) = 60 unidades base.
    const disponibilidad = await calcularDisponibilidad(e.producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("60");

    const fila = await prisma.cargaFila.findFirstOrThrow({ where: { cargaId: carga.id } });
    const propuesta = fila.datosPropuestos as { cantidadOriginal: number; factorAUnidadBase: number; cantidadBase: number };
    expect(propuesta.cantidadOriginal).toBe(5);
    expect(propuesta.factorAUnidadBase).toBe(12);
    expect(propuesta.cantidadBase).toBe(60);
  });
});

describe("Costos desconocidos no se asumen cero", () => {
  it("deja el costo unitario en null (pendiente) si no se informa", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(`producto_codigo,bodega_codigo,ubicacion_codigo,cantidad,unidad_codigo\n${e.producto.codigo},${e.bodega.codigo},${e.ubicacionAlmacen.codigo},8,UN\n`);
    const carga = await ejecutarFlujoCompleto({ empresaId: e.empresa.id, entidad: "INVENTARIO_INICIAL", modo: "CREACION_Y_ACTUALIZACION", nombreArchivo: "sin-costo.csv", contenido, usuarioId: e.usuario.id });
    const movimiento = await prisma.movimientoInventario.findFirstOrThrow({ where: { operacion: { documentoOrigen: `CARGA-${carga.id}` } } });
    expect(movimiento.costoUnitario).toBeNull();
  });
});
