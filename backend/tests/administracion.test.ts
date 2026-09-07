import { describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { crearEscenario } from "./fixtures.js";

const app = crearApp();

async function crearUsuarioAdministrador(empresaId: string) {
  const rolAdmin = await prisma.rol.findUniqueOrThrow({ where: { codigo: "administrador" } });
  const email = `admin-test-${Date.now()}-${Math.random()}@test.local`;
  await prisma.usuario.create({
    data: { empresaId, email, nombre: "Admin de Prueba", passwordHash: await bcrypt.hash("Clave123!", 10), rolId: rolAdmin.id },
  });
  return { email, password: "Clave123!" };
}

describe("Panel de administración de roles y permisos", () => {
  it("un administrador puede otorgar y revocar un permiso de un rol", async () => {
    const e = await crearEscenario();
    const { email, password } = await crearUsuarioAdministrador(e.empresa.id);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token as string;

    const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { codigo: "operador" } });
    const permiso = await prisma.permiso.upsert({
      where: { recurso_accion: { recurso: "productos", accion: "exportar" } },
      update: {},
      create: { recurso: "productos", accion: "exportar" },
    });
    await prisma.rolPermiso.deleteMany({ where: { rolId: rolOperador.id, permisoId: permiso.id } });

    const otorgar = await request(app)
      .post(`/api/administracion/roles/${rolOperador.id}/permisos`)
      .set("authorization", `Bearer ${token}`)
      .send({ permisoId: permiso.id });
    expect(otorgar.status).toBe(201);

    const rolesConPermiso = await request(app).get("/api/administracion/roles").set("authorization", `Bearer ${token}`);
    const operadorActualizado = rolesConPermiso.body.find((r: { codigo: string }) => r.codigo === "operador");
    expect(operadorActualizado.permisos.some((p: { id: string }) => p.id === permiso.id)).toBe(true);

    const revocar = await request(app)
      .delete(`/api/administracion/roles/${rolOperador.id}/permisos/${permiso.id}`)
      .set("authorization", `Bearer ${token}`);
    expect(revocar.status).toBe(204);
  });

  it("un administrador puede cambiar el rol de un usuario de su misma empresa", async () => {
    const e = await crearEscenario();
    const { email, password } = await crearUsuarioAdministrador(e.empresa.id);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const tokenAdmin = login.body.token as string;

    const rolCompras = await prisma.rol.findUniqueOrThrow({ where: { codigo: "compras" } });
    const cambio = await request(app)
      .put(`/api/administracion/usuarios/${e.usuario.id}/rol`)
      .set("authorization", `Bearer ${tokenAdmin}`)
      .send({ rolId: rolCompras.id });
    expect(cambio.status).toBe(200);
    expect(cambio.body.rolCodigo).toBe("compras");
  });

  it("no permite cambiar el rol de un usuario de otra empresa", async () => {
    const e1 = await crearEscenario();
    const e2 = await crearEscenario();
    const { email, password } = await crearUsuarioAdministrador(e1.empresa.id);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const tokenAdmin = login.body.token as string;

    const rolCompras = await prisma.rol.findUniqueOrThrow({ where: { codigo: "compras" } });
    const respuesta = await request(app)
      .put(`/api/administracion/usuarios/${e2.usuario.id}/rol`)
      .set("authorization", `Bearer ${tokenAdmin}`)
      .send({ rolId: rolCompras.id });
    expect(respuesta.status).toBe(404);
  });

  it("no permite administrar roles/permisos de una empresa a un usuario sin el permiso de administración", async () => {
    const e = await crearEscenario();
    const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { codigo: "operador" } });
    const usuarioOperador = await prisma.usuario.create({
      data: { empresaId: e.empresa.id, email: `operador-test-${Date.now()}@test.local`, nombre: "Operador", passwordHash: await bcrypt.hash("Clave123!", 10), rolId: rolOperador.id },
    });
    const login = await request(app).post("/api/auth/login").send({ email: usuarioOperador.email, password: "Clave123!" });
    const token = login.body.token as string;

    const respuesta = await request(app).get("/api/administracion/roles").set("authorization", `Bearer ${token}`);
    expect(respuesta.status).toBe(403);
  });
});
