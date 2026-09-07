import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

/** Crea un escenario mínimo aislado (empresa/bodega/ubicaciones/producto/usuario) por prueba. */
export async function crearEscenario(opts?: { controlLote?: boolean; controlVencimiento?: boolean; metodoValorizacion?: "PROMEDIO_PONDERADO" | "FIFO" }) {
  const sufijo = randomUUID().slice(0, 8);

  const empresa = await prisma.empresa.create({
    data: { rut: `RUT-${sufijo}`, razonSocial: `Empresa Test ${sufijo}`, moneda: "CLP" },
  });

  const rol = await prisma.rol.upsert({
    where: { codigo: "test_operador" },
    update: {},
    create: { codigo: "test_operador", nombre: "Operador de Pruebas" },
  });

  const usuario = await prisma.usuario.create({
    data: { empresaId: empresa.id, email: `usuario-${sufijo}@test.local`, nombre: "Usuario de Prueba", passwordHash: "x", rolId: rol.id },
  });

  const bodega = await prisma.bodega.create({ data: { empresaId: empresa.id, codigo: `BOD-${sufijo}`, nombre: "Bodega Test" } });
  const bodegaDestino = await prisma.bodega.create({ data: { empresaId: empresa.id, codigo: `BODB-${sufijo}`, nombre: "Bodega Test Destino" } });

  const ubicacionRecepcion = await prisma.ubicacion.create({ data: { bodegaId: bodega.id, codigo: "REC", nombre: "Recepción", tipo: "RECEPCION" } });
  const ubicacionAlmacen = await prisma.ubicacion.create({ data: { bodegaId: bodega.id, codigo: "ALM", nombre: "Almacén", tipo: "ALMACENAMIENTO" } });
  const ubicacionCuarentena = await prisma.ubicacion.create({ data: { bodegaId: bodega.id, codigo: "CUAR", nombre: "Cuarentena", tipo: "CUARENTENA" } });
  const ubicacionDestino = await prisma.ubicacion.create({ data: { bodegaId: bodegaDestino.id, codigo: "ALM", nombre: "Almacén Destino", tipo: "ALMACENAMIENTO" } });

  const unidad = await prisma.unidadMedida.create({ data: { empresaId: empresa.id, codigo: "UN", nombre: "Unidad" } });
  const unidadCaja = await prisma.unidadMedida.create({ data: { empresaId: empresa.id, codigo: "CJ", nombre: "Caja" } });

  const producto = await prisma.producto.create({
    data: {
      empresaId: empresa.id,
      codigo: `PROD-${sufijo}`,
      nombre: "Producto de Prueba",
      unidadBaseId: unidad.id,
      controlLote: opts?.controlLote ?? false,
      controlVencimiento: opts?.controlVencimiento ?? false,
      metodoValorizacion: opts?.metodoValorizacion ?? "PROMEDIO_PONDERADO",
    },
  });

  await prisma.conversionProducto.create({
    data: { productoId: producto.id, unidadId: unidadCaja.id, factorAUnidadBase: 12, tipoUso: "AMBOS" },
  });

  return {
    empresa,
    usuario,
    bodega,
    bodegaDestino,
    ubicacionRecepcion,
    ubicacionAlmacen,
    ubicacionCuarentena,
    ubicacionDestino,
    unidad,
    unidadCaja,
    producto,
  };
}

export async function crearSolicitudSalida(p: { empresaId: string; bodegaId: string; usuarioId: string; productoId: string; cantidad: number }) {
  return prisma.solicitudSalida.create({
    data: {
      empresaId: p.empresaId,
      folio: `SS-${randomUUID().slice(0, 8)}`,
      bodegaId: p.bodegaId,
      tipoDestino: "AREA_INTERNA",
      estado: "APROBADA",
      solicitanteId: p.usuarioId,
      detalle: { create: [{ productoId: p.productoId, cantidadSolicitada: p.cantidad }] },
    },
    include: { detalle: true },
  });
}
