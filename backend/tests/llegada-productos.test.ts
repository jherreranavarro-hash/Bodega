import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
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

const ENCABEZADOS = "Grupo,Código,Código ML,Código original,Título,Condición,Status,Sub Status,Grade,Cantidad solicitada,Cantidad colectada,Cantidad enviada,Peso,Valor,Valor en USD\n";

describe("Llegada de productos (Mercado Libre / liquidación): crea producto nuevo y recepciona stock", () => {
  it("con cantidad enviada > 0, genera producto, llegada, movimiento de inventario y valor de referencia para el precio", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(
      ENCABEZADOS + `Electrónica,PROD-ML-1,MLC1,ORIG-1,Audífonos Bluetooth,Usado,Cerrado,Entregado,A,5,5,5,0.35,15000,16.5\n`
    );

    const carga = await ejecutarFlujoCompleto({
      empresaId: e.empresa.id,
      entidad: "LLEGADA_PRODUCTOS",
      modo: "CREACION_Y_ACTUALIZACION",
      nombreArchivo: "llegada.csv",
      contenido,
      usuarioId: e.usuario.id,
      contexto: { bodegaDestinoId: e.bodega.id },
    });
    expect(carga.estado).toBe("EJECUTADA");

    const producto = await prisma.producto.findFirstOrThrow({ where: { empresaId: e.empresa.id, codigo: "PROD-ML-1::MLC1" } });
    expect(producto.nombre).toBe("Audífonos Bluetooth");
    expect(producto.codigoMercadoLibre).toBe("MLC1");
    expect(producto.codigoOriginalProveedor).toBe("ORIG-1");
    expect(producto.grupo).toBe("Electrónica");

    const llegada = await prisma.llegadaProducto.findFirstOrThrow({ where: { productoId: producto.id } });
    expect(llegada.condicion).toBe("Usado");
    expect(llegada.status).toBe("Cerrado");
    expect(llegada.subStatus).toBe("Entregado");
    expect(llegada.grade).toBe("A");
    expect(llegada.cantidadEnviada.toString()).toBe("5");
    expect(llegada.movimientoId).not.toBeNull();

    const disponibilidad = await calcularDisponibilidad(producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("5");

    const precio = await prisma.precioVenta.findUniqueOrThrow({ where: { productoId: producto.id } });
    expect(precio.valorReferenciaClp?.toString()).toBe("15000");
    expect(precio.valorReferenciaUsd?.toString()).toBe("16.5");
  });

  it("con cantidad enviada = 0, no genera movimiento pero sí registra la llegada y el valor de referencia", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(ENCABEZADOS + `,PROD-ML-2,,,Parlante Portátil,Usado,Cerrado,Entregado,B,3,3,0,1.2,22000,24.2\n`);

    const carga = await ejecutarFlujoCompleto({
      empresaId: e.empresa.id,
      entidad: "LLEGADA_PRODUCTOS",
      modo: "CREACION_Y_ACTUALIZACION",
      nombreArchivo: "llegada.csv",
      contenido,
      usuarioId: e.usuario.id,
      contexto: { bodegaDestinoId: e.bodega.id },
    });
    expect(carga.estado).toBe("EJECUTADA");

    const producto = await prisma.producto.findFirstOrThrow({ where: { empresaId: e.empresa.id, codigo: "PROD-ML-2" } });
    const llegada = await prisma.llegadaProducto.findFirstOrThrow({ where: { productoId: producto.id } });
    expect(llegada.movimientoId).toBeNull();

    const disponibilidad = await calcularDisponibilidad(producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("0");

    const precio = await prisma.precioVenta.findUniqueOrThrow({ where: { productoId: producto.id } });
    expect(precio.valorReferenciaClp?.toString()).toBe("22000");
  });

  it("actualiza un producto ya existente sin sobrescribir su nombre curado", async () => {
    const e = await crearEscenario();
    // El código interno del producto es el compuesto Código::CódigoML, tal
    // como lo genera esta misma carga — simula que este producto ya llegó
    // una vez antes.
    await prisma.producto.update({ where: { id: e.producto.id }, data: { codigo: "PROD-ML-3::MLC3" } });

    const contenido = Buffer.from(ENCABEZADOS + `NuevoGrupo,PROD-ML-3,MLC3,,Título ML ignorado,Nuevo,Cerrado,,C,1,1,1,0.1,5000,5.5\n`);
    const carga = await ejecutarFlujoCompleto({
      empresaId: e.empresa.id,
      entidad: "LLEGADA_PRODUCTOS",
      modo: "CREACION_Y_ACTUALIZACION",
      nombreArchivo: "llegada.csv",
      contenido,
      usuarioId: e.usuario.id,
      contexto: { bodegaDestinoId: e.bodega.id },
    });
    expect(carga.estado).toBe("EJECUTADA");

    const producto = await prisma.producto.findUniqueOrThrow({ where: { id: e.producto.id } });
    expect(producto.nombre).toBe("Producto de Prueba"); // no se sobrescribe con el título de la llegada
    expect(producto.grupo).toBe("NuevoGrupo");
    expect(producto.codigoMercadoLibre).toBe("MLC3");
  });

  it("rechaza un producto nuevo sin título (no se puede crear sin nombre)", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(ENCABEZADOS + `,PROD-ML-SIN-TITULO,,,,,,,,,,1,,,\n`);
    const carga = await recibirArchivo({
      empresaId: e.empresa.id,
      entidad: "LLEGADA_PRODUCTOS",
      modo: "CREACION_Y_ACTUALIZACION",
      nombreArchivo: "llegada.csv",
      contenido,
      usuarioId: e.usuario.id,
      contexto: { bodegaDestinoId: e.bodega.id },
    });
    const simulada = await validarYSimular(carga.id);
    expect(simulada.filasRechazar).toBe(1);
    const errores = await prisma.cargaError.findMany({ where: { cargaId: carga.id } });
    expect(errores.some((err) => err.mensaje.includes("título"))).toBe(true);
  });

  it("exige la bodega de destino antes de aceptar el archivo", async () => {
    const e = await crearEscenario();
    const contenido = Buffer.from(ENCABEZADOS + `,PROD-ML-4,,,Algo,,,,,,,1,,,\n`);
    await expect(
      recibirArchivo({
        empresaId: e.empresa.id,
        entidad: "LLEGADA_PRODUCTOS",
        modo: "CREACION_Y_ACTUALIZACION",
        nombreArchivo: "llegada.csv",
        contenido,
        usuarioId: e.usuario.id,
      })
    ).rejects.toThrow();
  });

  it("acepta el mismo archivo en formato .xlsx con los encabezados reales en español", async () => {
    const e = await crearEscenario();

    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Hoja1");
    hoja.addRow(["Grupo", "Código", "Código ML", "Código original", "Título", "Condición", "Status", "Sub Status", "Grade", "Cantidad solicitada", "Cantidad colectada", "Cantidad enviada", "Peso", "Valor", "Valor en USD"]);
    hoja.addRow(["Hogar", "PROD-ML-XLSX", "MLCX1", "ORIGX1", "Freidora de Aire", "Nuevo", "Cerrado", "Entregado", "A", 2, 2, 2, 4.5, 45000, 49.5]);
    const buffer = (await libro.xlsx.writeBuffer()) as unknown as Buffer;

    const carga = await ejecutarFlujoCompleto({
      empresaId: e.empresa.id,
      entidad: "LLEGADA_PRODUCTOS",
      modo: "CREACION_Y_ACTUALIZACION",
      nombreArchivo: "llegada.xlsx",
      contenido: buffer,
      usuarioId: e.usuario.id,
      contexto: { bodegaDestinoId: e.bodega.id },
    });
    expect(carga.estado).toBe("EJECUTADA");

    const producto = await prisma.producto.findFirstOrThrow({ where: { empresaId: e.empresa.id, codigo: "PROD-ML-XLSX::MLCX1" } });
    expect(producto.nombre).toBe("Freidora de Aire");
    const disponibilidad = await calcularDisponibilidad(producto.id, e.bodega.id);
    expect(disponibilidad.stockFisicoTotal.toString()).toBe("2");
  });

  it("un mismo Código con distinto Código ML crea dos productos separados, no los mezcla (caso real de liquidación)", async () => {
    // Verificado con un archivo real: el mismo "Código" puede repetirse con
    // título, peso y valor totalmente distintos en cada fila — "Código" solo
    // no identifica un producto. Código+CódigoML combinados sí.
    const e = await crearEscenario();
    const contenido = Buffer.from(
      ENCABEZADOS +
        `,1141840600-50,WQQX30117,,Quencher H2.0 Adventure Stone,Usado,OK,OK,A,3,3,0,0.8,49990,55\n` +
        `,1141840600-50,GHCX10845,,Mate Térmico Stanley Slim,Usado,OK,OK,A,1,1,0,0.22,25990,29\n`
    );

    const carga = await ejecutarFlujoCompleto({
      empresaId: e.empresa.id,
      entidad: "LLEGADA_PRODUCTOS",
      modo: "CREACION_Y_ACTUALIZACION",
      nombreArchivo: "lote-real.csv",
      contenido,
      usuarioId: e.usuario.id,
      contexto: { bodegaDestinoId: e.bodega.id },
    });
    expect(carga.estado).toBe("EJECUTADA");

    const productos = await prisma.producto.findMany({ where: { empresaId: e.empresa.id, codigo: { startsWith: "1141840600-50" } } });
    expect(productos).toHaveLength(2);
    const nombres = productos.map((p) => p.nombre).sort();
    expect(nombres).toEqual(["Mate Térmico Stanley Slim", "Quencher H2.0 Adventure Stone"]);
  });
});
