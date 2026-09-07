import { describe, it, expect, beforeAll } from "vitest";
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
  const email = `api-test-${Date.now()}-${Math.random()}@test.local`;
  const usuario = await prisma.usuario.create({
    data: { empresaId, email, nombre: "Usuario API Test", passwordHash: await bcrypt.hash("Clave123!", 10), rolId: rol.id },
  });
  return { usuario, email, password: "Clave123!" };
}

describe("Caso 12: consultar otra empresa sin permiso se deniega en pantalla y en los servicios", () => {
  it("no permite crear una ubicación en una bodega de otra empresa", async () => {
    const e1 = await crearEscenario();
    const e2 = await crearEscenario();
    const { email, password } = await crearUsuarioConRol(e1.empresa.id, "test", [
      ["ubicaciones", "crear"],
      ["ubicaciones", "consultar"],
    ]);

    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    // Intenta crear una ubicación en una bodega que pertenece a la empresa 2.
    const respuesta = await request(app)
      .post("/api/ubicaciones")
      .set("authorization", `Bearer ${token}`)
      .send({ bodegaId: e2.bodega.id, codigo: "INTRUSO", nombre: "Intento cruzado", tipo: "ALMACENAMIENTO" });

    expect(respuesta.status).toBe(403);

    const ubicacionCreada = await prisma.ubicacion.findFirst({ where: { bodegaId: e2.bodega.id, codigo: "INTRUSO" } });
    expect(ubicacionCreada).toBeNull();
  });

  it("deniega una acción para la que el rol no tiene permiso", async () => {
    const e = await crearEscenario();
    const { email, password } = await crearUsuarioConRol(e.empresa.id, "solo-consulta", [["productos", "consultar"]]);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token as string;

    const respuesta = await request(app)
      .post("/api/productos")
      .set("authorization", `Bearer ${token}`)
      .send({ codigo: "X", nombre: "X", unidadBaseId: e.unidad.id });

    expect(respuesta.status).toBe(403);
  });
});

describe("Autenticación", () => {
  it("rechaza credenciales inválidas", async () => {
    const respuesta = await request(app).post("/api/auth/login").send({ email: "no-existe@test.local", password: "loquesea" });
    expect(respuesta.status).toBe(401);
  });
});
