import { describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";

const app = crearApp();

async function crearUsuarioConRol(empresaId: string, rolCodigo: string, permisos: [string, string][]) {
  const rol = await prisma.rol.create({ data: { codigo: `${rolCodigo}-${Date.now()}-${Math.random()}`, nombre: rolCodigo } });
  for (const [recurso, accion] of permisos) {
    const permiso = await prisma.permiso.upsert({ where: { recurso_accion: { recurso, accion } }, update: {}, create: { recurso, accion } });
    await prisma.rolPermiso.create({ data: { rolId: rol.id, permisoId: permiso.id } });
  }
  const email = `productos-test-${Date.now()}-${Math.random()}@test.local`;
  const usuario = await prisma.usuario.create({
    data: { empresaId, email, nombre: "Usuario Productos Test", passwordHash: await bcrypt.hash("Clave123!", 10), rolId: rol.id },
  });
  return { usuario, email, password: "Clave123!" };
}

describe("Catálogo de productos: filtros y columnas sobre la última llegada", () => {
  it("expone en ultimaLlegada los campos de la llegada más reciente, no de la primera", async () => {
    const e = await crearEscenario();
    await prisma.llegadaProducto.create({
      data: { empresaId: e.empresa.id, productoId: e.producto.id, bodegaId: e.bodega.id, grupo: "Deportes", condicion: "Nuevo", fechaLlegada: new Date("2026-01-01") },
    });
    await prisma.llegadaProducto.create({
      data: { empresaId: e.empresa.id, productoId: e.producto.id, bodegaId: e.bodega.id, grupo: "Hogar", condicion: "Usado", fechaLlegada: new Date("2026-06-01") },
    });
    const { email, password } = await crearUsuarioConRol(e.empresa.id, "productos-test", [["productos", "consultar"]]);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token as string;

    const respuesta = await request(app).get("/api/productos").set("authorization", `Bearer ${token}`);
    expect(respuesta.status).toBe(200);
    const fila = respuesta.body.find((p: { id: string }) => p.id === e.producto.id);
    expect(fila.ultimaLlegada.grupo).toBe("Hogar");
    expect(fila.ultimaLlegada.condicion).toBe("Usado");
  });

  it("filtra por grupo/condición usando solo la última llegada, no cualquier llegada histórica", async () => {
    const e = await crearEscenario();
    // Llegada antigua con grupo "Deportes"; la más reciente cambia a "Hogar" — filtrar
    // por "Deportes" no debe traer este producto (ya no es su condición vigente).
    await prisma.llegadaProducto.create({
      data: { empresaId: e.empresa.id, productoId: e.producto.id, bodegaId: e.bodega.id, grupo: "Deportes", fechaLlegada: new Date("2026-01-01") },
    });
    await prisma.llegadaProducto.create({
      data: { empresaId: e.empresa.id, productoId: e.producto.id, bodegaId: e.bodega.id, grupo: "Hogar", fechaLlegada: new Date("2026-06-01") },
    });
    const { email, password } = await crearUsuarioConRol(e.empresa.id, "productos-test", [["productos", "consultar"]]);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token as string;

    const porDeportes = await request(app).get("/api/productos?grupo=Deportes").set("authorization", `Bearer ${token}`);
    expect(porDeportes.body.find((p: { id: string }) => p.id === e.producto.id)).toBeUndefined();

    const porHogar = await request(app).get("/api/productos?grupo=Hogar").set("authorization", `Bearer ${token}`);
    expect(porHogar.body.find((p: { id: string }) => p.id === e.producto.id)).toBeTruthy();
  });

  it("un producto sin llegadas nunca aparece bajo un filtro de llegada, y ultimaLlegada queda null", async () => {
    const e = await crearEscenario();
    const { email, password } = await crearUsuarioConRol(e.empresa.id, "productos-test", [["productos", "consultar"]]);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token as string;

    const sinFiltro = await request(app).get("/api/productos").set("authorization", `Bearer ${token}`);
    const fila = sinFiltro.body.find((p: { id: string }) => p.id === e.producto.id);
    expect(fila.ultimaLlegada).toBeNull();

    const conFiltro = await request(app).get("/api/productos?grupo=Hogar").set("authorization", `Bearer ${token}`);
    expect(conFiltro.body.find((p: { id: string }) => p.id === e.producto.id)).toBeUndefined();
  });

  it("GET /productos/filtros/llegada retorna los valores distintos declarados en las llegadas de la empresa", async () => {
    const e = await crearEscenario();
    await prisma.llegadaProducto.create({
      data: { empresaId: e.empresa.id, productoId: e.producto.id, bodegaId: e.bodega.id, grupo: "Deportes", grade: "A" },
    });
    await prisma.llegadaProducto.create({
      data: { empresaId: e.empresa.id, productoId: e.producto.id, bodegaId: e.bodega.id, grupo: "Hogar", grade: "B" },
    });
    const { email, password } = await crearUsuarioConRol(e.empresa.id, "productos-test", [["productos", "consultar"]]);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token as string;

    const respuesta = await request(app).get("/api/productos/filtros/llegada").set("authorization", `Bearer ${token}`);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.grupo.sort()).toEqual(["Deportes", "Hogar"]);
    expect(respuesta.body.grade.sort()).toEqual(["A", "B"]);
  });
});
