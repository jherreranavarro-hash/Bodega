import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const RECURSOS_ACCIONES: [string, string[]][] = [
  ["productos", ["consultar", "crear", "modificar", "importar", "exportar"]],
  ["bodegas", ["consultar", "crear", "modificar"]],
  ["ubicaciones", ["consultar", "crear", "modificar"]],
  ["proveedores", ["consultar", "crear", "modificar"]],
  ["cargas", ["consultar", "importar", "aprobar", "ejecutar", "exportar"]],
  ["compras", ["consultar", "crear", "modificar", "aprobar"]],
  ["recepciones", ["consultar", "crear"]],
  ["solicitudes_salida", ["consultar", "crear", "aprobar"]],
  ["reservas", ["consultar", "crear"]],
  ["preparaciones", ["consultar", "crear", "ejecutar"]],
  ["despachos", ["consultar", "ejecutar"]],
  ["transferencias", ["consultar", "ejecutar"]],
  ["devoluciones", ["consultar", "crear", "ejecutar"]],
  ["conteos", ["consultar", "crear", "ejecutar"]],
  ["ajustes", ["consultar", "crear", "aprobar"]],
  ["indicadores", ["consultar"]],
];

const ROLES: Record<string, { nombre: string; permisos: string[] /* "recurso.accion" o "*" */ }> = {
  administrador: { nombre: "Administrador", permisos: ["*"] },
  jefe_bodega: {
    nombre: "Jefe de Bodega",
    permisos: [
      "productos.consultar", "bodegas.*", "ubicaciones.*", "cargas.consultar", "cargas.aprobar",
      "compras.consultar", "recepciones.*", "solicitudes_salida.*", "reservas.*", "preparaciones.*", "despachos.*",
      "transferencias.*", "devoluciones.*", "conteos.*", "ajustes.consultar", "ajustes.aprobar", "indicadores.consultar",
    ],
  },
  operador: {
    nombre: "Operador de Bodega",
    permisos: ["productos.consultar", "recepciones.crear", "reservas.crear", "preparaciones.consultar", "preparaciones.crear", "preparaciones.ejecutar", "despachos.ejecutar", "transferencias.ejecutar", "devoluciones.consultar", "devoluciones.crear", "conteos.ejecutar", "indicadores.consultar"],
  },
  compras: {
    nombre: "Compras",
    permisos: ["productos.consultar", "proveedores.*", "compras.*", "recepciones.consultar", "indicadores.consultar"],
  },
  solicitante: { nombre: "Solicitante", permisos: ["productos.consultar", "solicitudes_salida.consultar", "solicitudes_salida.crear"] },
  aprobador: { nombre: "Aprobador", permisos: ["compras.aprobar", "cargas.aprobar", "ajustes.aprobar", "solicitudes_salida.aprobar", "indicadores.consultar"] },
  auditor: { nombre: "Auditor", permisos: ["productos.consultar", "bodegas.consultar", "ubicaciones.consultar", "cargas.consultar", "compras.consultar", "recepciones.consultar", "solicitudes_salida.consultar", "reservas.consultar", "despachos.consultar", "transferencias.consultar", "conteos.consultar", "ajustes.consultar", "indicadores.consultar"] },
  gerencia: { nombre: "Gerencia", permisos: ["indicadores.consultar", "productos.consultar", "compras.consultar"] },
};

async function main() {
  console.log("Creando permisos y roles...");
  const permisoIds = new Map<string, string>();
  for (const [recurso, acciones] of RECURSOS_ACCIONES) {
    for (const accion of acciones) {
      const permiso = await prisma.permiso.upsert({
        where: { recurso_accion: { recurso, accion } },
        update: {},
        create: { recurso, accion },
      });
      permisoIds.set(`${recurso}.${accion}`, permiso.id);
    }
  }

  for (const [codigo, def] of Object.entries(ROLES)) {
    const rol = await prisma.rol.upsert({ where: { codigo }, update: { nombre: def.nombre }, create: { codigo, nombre: def.nombre } });
    const claves = def.permisos.includes("*")
      ? [...permisoIds.keys()]
      : def.permisos.flatMap((p) => {
          if (p.endsWith(".*")) {
            const recurso = p.slice(0, -2);
            return [...permisoIds.keys()].filter((k) => k.startsWith(`${recurso}.`));
          }
          return [p];
        });
    for (const clave of claves) {
      const permisoId = permisoIds.get(clave);
      if (!permisoId) continue;
      await prisma.rolPermiso.upsert({
        where: { rolId_permisoId: { rolId: rol.id, permisoId } },
        update: {},
        create: { rolId: rol.id, permisoId },
      });
    }
  }

  console.log("Creando empresa demo...");
  const empresa = await prisma.empresa.upsert({
    where: { rut: "76.123.456-7" },
    update: {},
    create: { rut: "76.123.456-7", razonSocial: "Bodega Demo S.A.", nombreFantasia: "Bodega Demo", moneda: "CLP", zonaHoraria: "America/Santiago" },
  });

  const sucursal = await prisma.sucursal.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "CASA_MATRIZ" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "CASA_MATRIZ", nombre: "Casa Matriz", direccion: "Av. Siempre Viva 123, Santiago" },
  });

  const bodegaCentral = await prisma.bodega.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "BOD-CENTRAL" } },
    update: {},
    create: { empresaId: empresa.id, sucursalId: sucursal.id, codigo: "BOD-CENTRAL", nombre: "Bodega Central" },
  });
  const bodegaSucursal = await prisma.bodega.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "BOD-SUCURSAL-1" } },
    update: {},
    create: { empresaId: empresa.id, sucursalId: sucursal.id, codigo: "BOD-SUCURSAL-1", nombre: "Bodega Sucursal 1" },
  });

  for (const bodega of [bodegaCentral, bodegaSucursal]) {
    const ubicaciones: [string, string, "RECEPCION" | "ALMACENAMIENTO" | "PREPARACION" | "DESPACHO" | "CUARENTENA"][] = [
      ["REC-01", "Andén de recepción", "RECEPCION"],
      ["ALM-A-01", "Estantería A - Nivel 1", "ALMACENAMIENTO"],
      ["ALM-A-02", "Estantería A - Nivel 2", "ALMACENAMIENTO"],
      ["PREP-01", "Zona de preparación", "PREPARACION"],
      ["DESP-01", "Andén de despacho", "DESPACHO"],
      ["CUAR-01", "Cuarentena", "CUARENTENA"],
    ];
    for (const [codigo, nombre, tipo] of ubicaciones) {
      await prisma.ubicacion.upsert({
        where: { bodegaId_codigo: { bodegaId: bodega.id, codigo } },
        update: {},
        create: { bodegaId: bodega.id, codigo, nombre, tipo },
      });
    }
  }

  console.log("Creando unidades de medida, categorías y marcas...");
  const unidadUN = await prisma.unidadMedida.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "UN" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "UN", nombre: "Unidad" },
  });
  const unidadCJ = await prisma.unidadMedida.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "CJ" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "CJ", nombre: "Caja" },
  });
  const unidadKG = await prisma.unidadMedida.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "KG" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "KG", nombre: "Kilogramo" },
  });

  const categoria = await prisma.categoria.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "ABARROTES" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "ABARROTES", nombre: "Abarrotes" },
  });
  const marca = await prisma.marca.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "GENERICA" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "GENERICA", nombre: "Marca Genérica" },
  });

  console.log("Creando productos demo...");
  const productoUnidad = await prisma.producto.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "PROD-001" } },
    update: {},
    create: {
      empresaId: empresa.id,
      codigo: "PROD-001",
      nombre: "Arroz Grado 1 - 1kg",
      categoriaId: categoria.id,
      marcaId: marca.id,
      unidadBaseId: unidadUN.id,
      controlLote: true,
      controlVencimiento: true,
      vidaUtilMinimaDias: 30,
    },
  });
  await prisma.conversionProducto.upsert({
    where: { id: "seed-conv-prod-001-cj" },
    update: {},
    create: { id: "seed-conv-prod-001-cj", productoId: productoUnidad.id, unidadId: unidadCJ.id, factorAUnidadBase: 12, tipoUso: "AMBOS" },
  });

  const productoSerie = await prisma.producto.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "PROD-002" } },
    update: {},
    create: {
      empresaId: empresa.id,
      codigo: "PROD-002",
      nombre: "Refrigerador Industrial",
      categoriaId: categoria.id,
      marcaId: marca.id,
      unidadBaseId: unidadUN.id,
      controlSerie: true,
    },
  });
  void productoSerie;
  void unidadKG;

  await prisma.parametroReposicion.upsert({
    where: { productoId_bodegaId: { productoId: productoUnidad.id, bodegaId: bodegaCentral.id } },
    update: {},
    create: {
      productoId: productoUnidad.id,
      bodegaId: bodegaCentral.id,
      stockMinimo: 50,
      stockMaximo: 500,
      stockSeguridad: 20,
      plazoReposicionDias: 7,
      demandaDiariaEstimada: 10,
    },
  });

  console.log("Creando proveedor demo...");
  const proveedor = await prisma.proveedor.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: "PROV-001" } },
    update: {},
    create: { empresaId: empresa.id, codigo: "PROV-001", razonSocial: "Distribuidora Andina Ltda.", rut: "77.888.999-0" },
  });
  await prisma.productoProveedor.upsert({
    where: { productoId_proveedorId: { productoId: productoUnidad.id, proveedorId: proveedor.id } },
    update: {},
    create: { productoId: productoUnidad.id, proveedorId: proveedor.id, plazoEntregaDias: 7, costoReferencia: 950, esPreferente: true },
  });

  console.log("Creando motivos...");
  await prisma.motivo.upsert({
    where: { empresaId_categoria_codigo: { empresaId: empresa.id, categoria: "AJUSTE", codigo: "MERMA_OPERATIVA" } },
    update: {},
    create: { empresaId: empresa.id, categoria: "AJUSTE", codigo: "MERMA_OPERATIVA", nombre: "Merma operativa", requiereEvidencia: true },
  });
  await prisma.motivo.upsert({
    where: { empresaId_categoria_codigo: { empresaId: empresa.id, categoria: "AJUSTE", codigo: "ERROR_CONTEO" } },
    update: {},
    create: { empresaId: empresa.id, categoria: "AJUSTE", codigo: "ERROR_CONTEO", nombre: "Error de conteo anterior", requiereEvidencia: false },
  });
  await prisma.motivo.upsert({
    where: { empresaId_categoria_codigo: { empresaId: empresa.id, categoria: "DEVOLUCION", codigo: "CLIENTE_RECHAZO" } },
    update: {},
    create: { empresaId: empresa.id, categoria: "DEVOLUCION", codigo: "CLIENTE_RECHAZO", nombre: "Rechazo del cliente", requiereEvidencia: false },
  });
  await prisma.motivo.upsert({
    where: { empresaId_categoria_codigo: { empresaId: empresa.id, categoria: "DEVOLUCION", codigo: "PRODUCTO_DEFECTUOSO" } },
    update: {},
    create: { empresaId: empresa.id, categoria: "DEVOLUCION", codigo: "PRODUCTO_DEFECTUOSO", nombre: "Producto defectuoso", requiereEvidencia: true },
  });
  await prisma.motivo.upsert({
    where: { empresaId_categoria_codigo: { empresaId: empresa.id, categoria: "BAJA", codigo: "DANO_IRREPARABLE" } },
    update: {},
    create: { empresaId: empresa.id, categoria: "BAJA", codigo: "DANO_IRREPARABLE", nombre: "Daño irreparable", requiereEvidencia: true },
  });

  console.log("Creando usuarios demo (contraseña: Demo1234!) ...");
  const passwordHash = await bcrypt.hash("Demo1234!", 10);
  for (const [email, nombre, rolCodigo] of [
    ["admin@bodegademo.cl", "Administradora del Sistema", "administrador"],
    ["jefe.bodega@bodegademo.cl", "Jefe de Bodega", "jefe_bodega"],
    ["operador@bodegademo.cl", "Operador de Bodega", "operador"],
    ["compras@bodegademo.cl", "Analista de Compras", "compras"],
    ["solicitante@bodegademo.cl", "Solicitante de Área", "solicitante"],
    ["aprobador@bodegademo.cl", "Aprobador", "aprobador"],
    ["auditor@bodegademo.cl", "Auditor Interno", "auditor"],
    ["gerencia@bodegademo.cl", "Gerencia", "gerencia"],
  ] as const) {
    const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: rolCodigo } });
    await prisma.usuario.upsert({
      where: { email },
      update: {},
      create: { empresaId: empresa.id, email, nombre, passwordHash, rolId: rol.id },
    });
  }

  console.log("Creando plantillas de carga...");
  await prisma.plantillaCarga.upsert({
    where: { entidad_version: { entidad: "PRODUCTOS", version: "1.0" } },
    update: {},
    create: {
      entidad: "PRODUCTOS",
      version: "1.0",
      descripcionCampos: [
        { campo: "codigo", obligatorio: true, formato: "texto", longitud: 30, ejemplo: "PROD-100" },
        { campo: "nombre", obligatorio: true, formato: "texto", longitud: 120, ejemplo: "Aceite de Oliva 500ml" },
        { campo: "descripcion", obligatorio: false, formato: "texto", longitud: 500 },
        { campo: "codigo_barras", obligatorio: false, formato: "texto", longitud: 30 },
        { campo: "unidad_base_codigo", obligatorio: true, formato: "texto", valoresAdmitidos: "código existente en unidades_medida", ejemplo: "UN" },
        { campo: "control_lote", obligatorio: false, formato: "true/false", ejemplo: "true" },
        { campo: "control_serie", obligatorio: false, formato: "true/false", ejemplo: "false" },
        { campo: "control_vencimiento", obligatorio: false, formato: "true/false", ejemplo: "true" },
        { campo: "metodo_valorizacion", obligatorio: false, valoresAdmitidos: "PROMEDIO_PONDERADO|FIFO", ejemplo: "PROMEDIO_PONDERADO" },
      ],
    },
  });
  await prisma.plantillaCarga.upsert({
    where: { entidad_version: { entidad: "INVENTARIO_INICIAL", version: "1.0" } },
    update: {},
    create: {
      entidad: "INVENTARIO_INICIAL",
      version: "1.0",
      descripcionCampos: [
        { campo: "producto_codigo", obligatorio: true, formato: "texto", dependencia: "debe existir en productos" },
        { campo: "bodega_codigo", obligatorio: true, formato: "texto", dependencia: "debe existir en bodegas" },
        { campo: "ubicacion_codigo", obligatorio: true, formato: "texto", dependencia: "debe existir en ubicaciones de la bodega" },
        { campo: "cantidad", obligatorio: true, formato: "decimal > 0", ejemplo: "10" },
        { campo: "unidad_codigo", obligatorio: true, formato: "texto", ejemplo: "CJ", dependencia: "si difiere de la unidad base, debe existir conversión" },
        { campo: "lote_codigo", obligatorio: false, formato: "texto" },
        { campo: "fecha_vencimiento", obligatorio: false, formato: "YYYY-MM-DD" },
        { campo: "costo_unitario", obligatorio: false, formato: "decimal >= 0", observacion: "si se omite, el costo queda pendiente (nunca se asume cero)" },
      ],
    },
  });

  console.log("Seed completo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
