import { describe, it, expect } from "vitest";
import { guardarAdjunto, listarAdjuntos, leerAdjunto, eliminarAdjunto } from "../src/modules/adjuntos/adjuntos.service.js";

describe("Almacenamiento de evidencias (adjuntos)", () => {
  it("guarda un archivo en disco y permite leerlo de vuelta con su contenido intacto", async () => {
    const contenido = Buffer.from("contenido de prueba de la evidencia");
    const adjunto = await guardarAdjunto({
      entidad: "ajustes",
      entidadId: "test-entidad-1",
      nombreOriginal: "evidencia.pdf",
      contenido,
      tipo: "application/pdf",
    });

    expect(adjunto.nombre).toBe("evidencia.pdf");

    const leido = await leerAdjunto(adjunto.id);
    expect(leido.contenido.toString()).toBe("contenido de prueba de la evidencia");
    expect(leido.nombre).toBe("evidencia.pdf");

    await eliminarAdjunto(adjunto.id);
    await expect(leerAdjunto(adjunto.id)).rejects.toThrow();
  });

  it("lista los adjuntos de una entidad específica", async () => {
    const entidadId = `test-entidad-${Date.now()}`;
    await guardarAdjunto({ entidad: "devoluciones", entidadId, nombreOriginal: "foto1.jpg", contenido: Buffer.from("a") });
    await guardarAdjunto({ entidad: "devoluciones", entidadId, nombreOriginal: "foto2.png", contenido: Buffer.from("b") });

    const lista = await listarAdjuntos("devoluciones", entidadId);
    expect(lista).toHaveLength(2);
  });

  it("rechaza extensiones no permitidas", async () => {
    await expect(
      guardarAdjunto({ entidad: "ajustes", entidadId: "test-x", nombreOriginal: "script.exe", contenido: Buffer.from("x") })
    ).rejects.toThrow();
  });

  it("rechaza archivos que superan el tamaño máximo", async () => {
    const contenidoGrande = Buffer.alloc(11 * 1024 * 1024, 1);
    await expect(
      guardarAdjunto({ entidad: "ajustes", entidadId: "test-y", nombreOriginal: "grande.pdf", contenido: contenidoGrande })
    ).rejects.toThrow();
  });
});
