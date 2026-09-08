import { describe, it, expect } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";
import { actualizarPrecio, actualizarValorReferencia, listarPrecios } from "../src/modules/precios/precios.service.js";

describe("Mantenedor de precios de venta", () => {
  it("modo FIJO: el precio calculado es exactamente el precio fijo indicado", async () => {
    const e = await crearEscenario();
    const precio = await actualizarPrecio(e.producto.id, e.empresa.id, { modo: "FIJO", precioFijoClp: 12000 }, e.usuario.id);
    expect(precio.precioVentaCalculado?.toString()).toBe("12000");
  });

  it("modo PORCENTAJE: se calcula sobre el valor de referencia de la última llegada", async () => {
    const e = await crearEscenario();
    await prisma.$transaction((tx) => actualizarValorReferencia(tx, e.producto.id, e.empresa.id, 10000, 11));
    const precio = await actualizarPrecio(e.producto.id, e.empresa.id, { modo: "PORCENTAJE", porcentajeMargen: 30 }, e.usuario.id);
    expect(precio.precioVentaCalculado?.toString()).toBe("13000"); // 10000 * 1.30
  });

  it("modo PORCENTAJE sin valor de referencia todavía: el precio calculado queda vacío (nunca inventa un cero)", async () => {
    const e = await crearEscenario();
    const precio = await actualizarPrecio(e.producto.id, e.empresa.id, { modo: "PORCENTAJE", porcentajeMargen: 25 }, e.usuario.id);
    expect(precio.precioVentaCalculado).toBeNull();
  });

  it("una llegada posterior actualiza el valor de referencia y recalcula el precio en modo porcentaje", async () => {
    const e = await crearEscenario();
    await actualizarPrecio(e.producto.id, e.empresa.id, { modo: "PORCENTAJE", porcentajeMargen: 50 }, e.usuario.id);
    await prisma.$transaction((tx) => actualizarValorReferencia(tx, e.producto.id, e.empresa.id, 8000, null));
    const precio = await prisma.precioVenta.findUniqueOrThrow({ where: { productoId: e.producto.id } });
    expect(precio.precioVentaCalculado?.toString()).toBe("12000"); // 8000 * 1.50
  });

  it("rechaza modo FIJO sin precio o modo PORCENTAJE sin margen", async () => {
    const e = await crearEscenario();
    await expect(actualizarPrecio(e.producto.id, e.empresa.id, { modo: "FIJO" }, e.usuario.id)).rejects.toThrow();
    await expect(actualizarPrecio(e.producto.id, e.empresa.id, { modo: "PORCENTAJE" }, e.usuario.id)).rejects.toThrow();
  });

  it("rechaza actualizar el precio de un producto de otra empresa", async () => {
    const e1 = await crearEscenario();
    const e2 = await crearEscenario();
    await expect(actualizarPrecio(e1.producto.id, e2.empresa.id, { modo: "FIJO", precioFijoClp: 1000 }, e2.usuario.id)).rejects.toThrow();
  });

  it("listarPrecios incluye productos sin configuración de precio todavía", async () => {
    const e = await crearEscenario();
    const lista = await listarPrecios(e.empresa.id);
    const fila = lista.find((p) => p.productoId === e.producto.id);
    expect(fila).toBeTruthy();
    expect(fila?.precio).toBeNull();
  });
});
