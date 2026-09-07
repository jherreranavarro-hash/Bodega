-- CreateEnum
CREATE TYPE "TipoUbicacion" AS ENUM ('RECEPCION', 'ALMACENAMIENTO', 'PREPARACION', 'DESPACHO', 'CUARENTENA', 'TRANSITO', 'DEVOLUCION');

-- CreateEnum
CREATE TYPE "MetodoValorizacion" AS ENUM ('PROMEDIO_PONDERADO', 'FIFO');

-- CreateEnum
CREATE TYPE "TipoOperacion" AS ENUM ('RECEPCION', 'DESPACHO', 'TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA', 'RESERVA', 'LIBERACION_RESERVA', 'DEVOLUCION', 'AJUSTE', 'BAJA', 'APERTURA_INICIAL', 'RECLASIFICACION');

-- CreateEnum
CREATE TYPE "EstadoOperacion" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'CONTABILIZADA', 'RECHAZADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoInventario" AS ENUM ('DISPONIBLE', 'CUARENTENA', 'BLOQUEADO', 'TRANSITO', 'DANADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "EstadoDocumentoCompra" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'ENVIADA', 'RECEPCION_PARCIAL', 'RECIBIDA_TOTAL', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoRecepcion" AS ENUM ('BORRADOR', 'EN_INSPECCION', 'CONTABILIZADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoSolicitudSalida" AS ENUM ('BORRADOR', 'APROBADA', 'EN_PREPARACION', 'DESPACHADA_PARCIAL', 'DESPACHADA_TOTAL', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('ACTIVA', 'CONSUMIDA_PARCIAL', 'CONSUMIDA_TOTAL', 'LIBERADA', 'VENCIDA');

-- CreateEnum
CREATE TYPE "EstadoPreparacion" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'LISTA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoDespacho" AS ENUM ('BORRADOR', 'CONTABILIZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "EstadoTransferencia" AS ENUM ('BORRADOR', 'EN_TRANSITO', 'RECIBIDA_PARCIAL', 'RECIBIDA_TOTAL', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoDevolucion" AS ENUM ('PENDIENTE_INSPECCION', 'RESUELTA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoConteo" AS ENUM ('PLANIFICADO', 'EN_PROCESO', 'PENDIENTE_APROBACION', 'APROBADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "EstadoAjuste" AS ENUM ('PENDIENTE_APROBACION', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "ModoCarga" AS ENUM ('SOLO_CREACION', 'SOLO_ACTUALIZACION', 'CREACION_Y_ACTUALIZACION', 'VALIDACION_SIN_APLICAR');

-- CreateEnum
CREATE TYPE "EstadoCarga" AS ENUM ('RECIBIDA', 'VALIDANDO', 'VALIDADA_CON_ERRORES', 'SIMULADA', 'PENDIENTE_APROBACION', 'APROBADA', 'EJECUTANDO', 'EJECUTADA', 'RECHAZADA', 'ANULADA');

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreFantasia" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'CLP',
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Santiago',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursales" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol_id" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "accion" TEXT NOT NULL,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol_permisos" (
    "rol_id" TEXT NOT NULL,
    "permiso_id" TEXT NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "accesos_bodega" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,

    CONSTRAINT "accesos_bodega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "parametros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "resultado" TEXT NOT NULL,
    "detalle" JSONB,
    "ip" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aprobaciones" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "solicitado_por_id" TEXT NOT NULL,
    "resuelto_por_id" TEXT,
    "comentario" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMP(3),

    CONSTRAINT "aprobaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjuntos" (
    "id" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tipo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bodegas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "sucursal_id" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bodegas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones" (
    "id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoUbicacion" NOT NULL,
    "zona" TEXT,
    "pasillo" TEXT,
    "estanteria" TEXT,
    "nivel" TEXT,
    "restricciones" JSONB,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria_padre_id" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marcas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "marcas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades_medida" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unidades_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "codigoBarras" TEXT,
    "categoria_id" TEXT,
    "marca_id" TEXT,
    "atributos" JSONB,
    "unidad_base_id" TEXT NOT NULL,
    "pesoKg" DECIMAL(14,4),
    "largoCm" DECIMAL(10,2),
    "anchoCm" DECIMAL(10,2),
    "altoCm" DECIMAL(10,2),
    "control_lote" BOOLEAN NOT NULL DEFAULT false,
    "control_serie" BOOLEAN NOT NULL DEFAULT false,
    "control_vencimiento" BOOLEAN NOT NULL DEFAULT false,
    "vida_util_minima_dias" INTEGER,
    "metodo_valorizacion" "MetodoValorizacion" NOT NULL DEFAULT 'PROMEDIO_PONDERADO',
    "moneda" TEXT NOT NULL DEFAULT 'CLP',
    "cantidad_minima_compra" DECIMAL(14,4),
    "multiplo_pedido" DECIMAL(14,4),
    "plazo_reposicion_dias" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "creado_por_id" TEXT,
    "actualizado_por_id" TEXT,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_ubicaciones_permitidas" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "ubicacion_id" TEXT,

    CONSTRAINT "productos_ubicaciones_permitidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversiones_producto" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "factor_a_unidad_base" DECIMAL(18,6) NOT NULL,
    "tipoUso" TEXT NOT NULL,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMP(3),

    CONSTRAINT "conversiones_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_reposicion" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "stock_minimo" DECIMAL(14,4) NOT NULL,
    "stock_maximo" DECIMAL(14,4),
    "stock_seguridad" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "plazo_reposicion_dias" INTEGER NOT NULL,
    "demanda_diaria_estimada" DECIMAL(14,4),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_reposicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "rut" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_proveedores" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "proveedor_id" TEXT NOT NULL,
    "codigo_proveedor" TEXT,
    "unidad_compra_id" TEXT,
    "plazo_entrega_dias" INTEGER,
    "costo_referencia" DECIMAL(18,4),
    "es_preferente" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "productos_proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "rut" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transportistas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "transportistas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centros_costo" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "centros_costo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "requiere_evidencia" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "motivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "codigo_lote" TEXT NOT NULL,
    "fecha_fabricacion" TIMESTAMP(3),
    "fecha_vencimiento" TIMESTAMP(3),
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "numero_serie" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'DISPONIBLE',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operaciones_inventario" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "tipo" "TipoOperacion" NOT NULL,
    "estado" "EstadoOperacion" NOT NULL DEFAULT 'BORRADOR',
    "documento_origen" TEXT,
    "fecha_efectiva" TIMESTAMP(3) NOT NULL,
    "fecha_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" TEXT NOT NULL,
    "autorizado_por_id" TEXT,
    "operacion_origen_id" TEXT,
    "observacion" TEXT,

    CONSTRAINT "operaciones_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" TEXT NOT NULL,
    "operacion_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "ubicacion_origen_id" TEXT,
    "ubicacion_destino_id" TEXT,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "estado_inventario" "EstadoInventario" NOT NULL DEFAULT 'DISPONIBLE',
    "cantidad" DECIMAL(18,6) NOT NULL,
    "costo_unitario" DECIMAL(18,6),
    "fecha_efectiva" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldos_inventario" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "ubicacion_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "estado_inventario" "EstadoInventario" NOT NULL DEFAULT 'DISPONIBLE',
    "cantidad_fisica" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saldos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capas_costo" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "costo_unitario" DECIMAL(18,6) NOT NULL,
    "cantidad_original" DECIMAL(18,6) NOT NULL,
    "cantidad_disponible" DECIMAL(18,6) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'CLP',
    "tipo_cambio" DECIMAL(18,6),
    "fuente_tipo" TEXT NOT NULL,
    "fuente_id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capas_costo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aplicaciones_costo" (
    "id" TEXT NOT NULL,
    "capa_costo_id" TEXT NOT NULL,
    "movimiento_id" TEXT NOT NULL,
    "cantidad_aplicada" DECIMAL(18,6) NOT NULL,
    "costo_unitario" DECIMAL(18,6) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aplicaciones_costo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_compra" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "proveedor_sugerido_id" TEXT,
    "estado" "EstadoDocumentoCompra" NOT NULL DEFAULT 'BORRADOR',
    "origen" TEXT NOT NULL DEFAULT 'MANUAL',
    "solicitante_id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_compra_detalle" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "bodega_destino_id" TEXT NOT NULL,
    "fecha_requerida" TIMESTAMP(3),

    CONSTRAINT "solicitudes_compra_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_compra" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "proveedor_id" TEXT NOT NULL,
    "solicitud_compra_id" TEXT,
    "estado" "EstadoDocumentoCompra" NOT NULL DEFAULT 'BORRADOR',
    "moneda" TEXT NOT NULL DEFAULT 'CLP',
    "fecha_emision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_compromiso_original" TIMESTAMP(3),
    "fecha_compromiso_actual" TIMESTAMP(3),
    "aprobada_por_id" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_compra_detalle" (
    "id" TEXT NOT NULL,
    "orden_compra_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "unidad_id" TEXT NOT NULL,
    "cantidad_pedida" DECIMAL(18,6) NOT NULL,
    "cantidad_recibida" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cantidad_rechazada" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "costo_unitario_pactado" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "ordenes_compra_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepciones" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "orden_compra_id" TEXT,
    "bodega_id" TEXT NOT NULL,
    "estado" "EstadoRecepcion" NOT NULL DEFAULT 'BORRADOR',
    "fecha_efectiva" TIMESTAMP(3) NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "operacion_id" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recepciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepciones_detalle" (
    "id" TEXT NOT NULL,
    "recepcion_id" TEXT NOT NULL,
    "orden_compra_detalle_id" TEXT,
    "producto_id" TEXT NOT NULL,
    "ubicacion_destino_id" TEXT NOT NULL,
    "lote_codigo" TEXT,
    "fecha_vencimiento" TIMESTAMP(3),
    "cantidad_recibida" DECIMAL(18,6) NOT NULL,
    "cantidad_aceptada" DECIMAL(18,6) NOT NULL,
    "cantidad_rechazada" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "costo_unitario" DECIMAL(18,6) NOT NULL,
    "motivo_rechazo_id" TEXT,

    CONSTRAINT "recepciones_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_salida" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "tipoDestino" TEXT NOT NULL,
    "area_id" TEXT,
    "centro_costo_id" TEXT,
    "cliente_id" TEXT,
    "prioridad" TEXT NOT NULL DEFAULT 'NORMAL',
    "fecha_requerida" TIMESTAMP(3),
    "estado" "EstadoSolicitudSalida" NOT NULL DEFAULT 'BORRADOR',
    "solicitante_id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_salida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_salida_detalle" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "cantidad_solicitada" DECIMAL(18,6) NOT NULL,
    "cantidad_atendida" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "cantidad_cancelada" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "motivo_no_atencion" TEXT,

    CONSTRAINT "solicitudes_salida_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas" (
    "id" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "solicitud_detalle_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "estado" "EstadoReserva" NOT NULL DEFAULT 'ACTIVA',
    "fecha_vencimiento" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas_detalle" (
    "id" TEXT NOT NULL,
    "reserva_id" TEXT NOT NULL,
    "saldo_id" TEXT NOT NULL,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "cantidad_consumida" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "reservas_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparaciones" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "solicitud_id" TEXT NOT NULL,
    "estado" "EstadoPreparacion" NOT NULL DEFAULT 'PENDIENTE',
    "responsable_id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preparaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparaciones_detalle" (
    "id" TEXT NOT NULL,
    "preparacion_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "cantidad_solicitada" DECIMAL(18,6) NOT NULL,
    "cantidad_verificada" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "preparaciones_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despachos" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "preparacion_id" TEXT,
    "cliente_id" TEXT,
    "transportista_id" TEXT,
    "referencia_comercial" TEXT,
    "estado" "EstadoDespacho" NOT NULL DEFAULT 'BORRADOR',
    "fecha_efectiva" TIMESTAMP(3) NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "operacion_id" TEXT,
    "evidencia_url" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "despachos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despachos_detalle" (
    "id" TEXT NOT NULL,
    "despacho_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "reserva_detalle_id" TEXT,
    "ubicacion_origen_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "cantidad" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "despachos_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencias" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "bodega_origen_id" TEXT NOT NULL,
    "bodega_destino_id" TEXT NOT NULL,
    "transportista_id" TEXT,
    "estado" "EstadoTransferencia" NOT NULL DEFAULT 'BORRADOR',
    "fecha_despacho" TIMESTAMP(3),
    "fecha_recepcion" TIMESTAMP(3),
    "usuario_id" TEXT NOT NULL,
    "operacion_salida_id" TEXT,
    "operacion_entrada_id" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transferencias_detalle" (
    "id" TEXT NOT NULL,
    "transferencia_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "cantidad_enviada" DECIMAL(18,6) NOT NULL,
    "cantidad_recibida" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "transferencias_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devoluciones" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "despacho_origen_id" TEXT,
    "bodega_id" TEXT NOT NULL,
    "motivo_id" TEXT NOT NULL,
    "estado" "EstadoDevolucion" NOT NULL DEFAULT 'PENDIENTE_INSPECCION',
    "usuario_id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devoluciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devoluciones_detalle" (
    "id" TEXT NOT NULL,
    "devolucion_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "resolucion" TEXT,
    "ubicacion_destino_id" TEXT,

    CONSTRAINT "devoluciones_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conteos" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "conteo_ciego" BOOLEAN NOT NULL DEFAULT true,
    "estado" "EstadoConteo" NOT NULL DEFAULT 'PLANIFICADO',
    "responsable_id" TEXT NOT NULL,
    "fecha_corte" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conteos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conteos_detalle" (
    "id" TEXT NOT NULL,
    "conteo_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "ubicacion_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "cantidad_esperada" DECIMAL(18,6) NOT NULL,
    "cantidad_contada" DECIMAL(18,6),
    "reconteo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conteos_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajustes" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "conteo_id" TEXT,
    "bodega_id" TEXT NOT NULL,
    "motivo_id" TEXT NOT NULL,
    "estado" "EstadoAjuste" NOT NULL DEFAULT 'PENDIENTE_APROBACION',
    "solicitado_por_id" TEXT NOT NULL,
    "aprobado_por_id" TEXT,
    "evidencia_url" TEXT,
    "operacion_id" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajustes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajustes_detalle" (
    "id" TEXT NOT NULL,
    "ajuste_id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "ubicacion_id" TEXT NOT NULL,
    "lote_id" TEXT,
    "serie_id" TEXT,
    "cantidad_esperada" DECIMAL(18,6) NOT NULL,
    "cantidad_contada" DECIMAL(18,6) NOT NULL,
    "diferencia" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "ajustes_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demanda_registrada" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "cantidad_solicitada" DECIMAL(18,6) NOT NULL,
    "cantidad_atendida" DECIMAL(18,6) NOT NULL,
    "cantidad_no_atendida" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "demanda_registrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pronosticos" (
    "id" TEXT NOT NULL,
    "producto_id" TEXT NOT NULL,
    "bodega_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "demanda_estimada" DECIMAL(18,6) NOT NULL,
    "metodo" TEXT NOT NULL,
    "error_absoluto_medio" DECIMAL(18,6),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pronosticos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escenarios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "supuestos" JSONB NOT NULL,
    "resultado" JSONB,
    "creado_por_id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_carga" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT,
    "entidad" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "descripcionCampos" JSONB NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plantillas_carga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapeos_carga" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "plantilla_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correspondencia" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapeos_carga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargas_datos" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "plantilla_id" TEXT NOT NULL,
    "clave_idempotencia" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "modo" "ModoCarga" NOT NULL,
    "estado" "EstadoCarga" NOT NULL DEFAULT 'RECIBIDA',
    "total_filas" INTEGER NOT NULL DEFAULT 0,
    "filas_crear" INTEGER NOT NULL DEFAULT 0,
    "filas_actualizar" INTEGER NOT NULL DEFAULT 0,
    "filas_rechazar" INTEGER NOT NULL DEFAULT 0,
    "filas_sin_cambio" INTEGER NOT NULL DEFAULT 0,
    "creado_por_id" TEXT NOT NULL,
    "aprobado_por_id" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMP(3),

    CONSTRAINT "cargas_datos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargas_filas" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "numero_fila" INTEGER NOT NULL,
    "datos_originales" JSONB NOT NULL,
    "datos_propuestos" JSONB,
    "accion" TEXT NOT NULL,
    "entidad_resultante_id" TEXT,
    "procesada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cargas_filas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargas_errores" (
    "id" TEXT NOT NULL,
    "carga_id" TEXT NOT NULL,
    "numero_fila" INTEGER NOT NULL,
    "campo" TEXT,
    "severidad" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,

    CONSTRAINT "cargas_errores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "entidad" TEXT,
    "entidad_id" TEXT,
    "severidad" TEXT NOT NULL,
    "evidencia" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acciones_recomendadas" (
    "id" TEXT NOT NULL,
    "alerta_id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "impactoEstimado" JSONB,
    "responsable_id" TEXT,
    "fecha_objetivo" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'PROPUESTA',
    "justificacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acciones_recomendadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_rut_key" ON "empresas"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_empresa_id_codigo_key" ON "sucursales"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_codigo_key" ON "roles"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_recurso_accion_key" ON "permisos"("recurso", "accion");

-- CreateIndex
CREATE UNIQUE INDEX "accesos_bodega_usuario_id_bodega_id_key" ON "accesos_bodega"("usuario_id", "bodega_id");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_empresa_id_clave_key" ON "parametros"("empresa_id", "clave");

-- CreateIndex
CREATE INDEX "auditoria_empresa_id_entidad_entidad_id_idx" ON "auditoria"("empresa_id", "entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "aprobaciones_empresa_id_entidad_entidad_id_idx" ON "aprobaciones"("empresa_id", "entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "adjuntos_entidad_entidad_id_idx" ON "adjuntos"("entidad", "entidad_id");

-- CreateIndex
CREATE UNIQUE INDEX "bodegas_empresa_id_codigo_key" ON "bodegas"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_bodega_id_codigo_key" ON "ubicaciones"("bodega_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_empresa_id_codigo_key" ON "categorias"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "marcas_empresa_id_codigo_key" ON "marcas"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_medida_empresa_id_codigo_key" ON "unidades_medida"("empresa_id", "codigo");

-- CreateIndex
CREATE INDEX "productos_empresa_id_codigoBarras_idx" ON "productos"("empresa_id", "codigoBarras");

-- CreateIndex
CREATE UNIQUE INDEX "productos_empresa_id_codigo_key" ON "productos"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "productos_ubicaciones_permitidas_producto_id_bodega_id_ubic_key" ON "productos_ubicaciones_permitidas"("producto_id", "bodega_id", "ubicacion_id");

-- CreateIndex
CREATE INDEX "conversiones_producto_producto_id_unidad_id_idx" ON "conversiones_producto"("producto_id", "unidad_id");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_reposicion_producto_id_bodega_id_key" ON "parametros_reposicion"("producto_id", "bodega_id");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_empresa_id_codigo_key" ON "proveedores"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "productos_proveedores_producto_id_proveedor_id_key" ON "productos_proveedores"("producto_id", "proveedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_empresa_id_codigo_key" ON "clientes"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "transportistas_empresa_id_codigo_key" ON "transportistas"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "areas_empresa_id_codigo_key" ON "areas"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "centros_costo_empresa_id_codigo_key" ON "centros_costo"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "motivos_empresa_id_categoria_codigo_key" ON "motivos"("empresa_id", "categoria", "codigo");

-- CreateIndex
CREATE INDEX "lotes_producto_id_fecha_vencimiento_idx" ON "lotes"("producto_id", "fecha_vencimiento");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_producto_id_codigo_lote_key" ON "lotes"("producto_id", "codigo_lote");

-- CreateIndex
CREATE UNIQUE INDEX "series_producto_id_numero_serie_key" ON "series"("producto_id", "numero_serie");

-- CreateIndex
CREATE INDEX "operaciones_inventario_empresa_id_bodega_id_tipo_estado_idx" ON "operaciones_inventario"("empresa_id", "bodega_id", "tipo", "estado");

-- CreateIndex
CREATE INDEX "movimientos_inventario_producto_id_ubicacion_destino_id_lot_idx" ON "movimientos_inventario"("producto_id", "ubicacion_destino_id", "lote_id", "serie_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_producto_id_ubicacion_origen_id_lote_idx" ON "movimientos_inventario"("producto_id", "ubicacion_origen_id", "lote_id", "serie_id");

-- CreateIndex
CREATE UNIQUE INDEX "saldos_inventario_producto_id_ubicacion_id_lote_id_serie_id_key" ON "saldos_inventario"("producto_id", "ubicacion_id", "lote_id", "serie_id", "estado_inventario");

-- CreateIndex
CREATE INDEX "capas_costo_producto_id_creadoEn_idx" ON "capas_costo"("producto_id", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_compra_empresa_id_folio_key" ON "solicitudes_compra"("empresa_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_compra_empresa_id_folio_key" ON "ordenes_compra"("empresa_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "recepciones_bodega_id_folio_key" ON "recepciones"("bodega_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_salida_empresa_id_folio_key" ON "solicitudes_salida"("empresa_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "preparaciones_folio_key" ON "preparaciones"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "despachos_bodega_id_folio_key" ON "despachos"("bodega_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "transferencias_folio_key" ON "transferencias"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "devoluciones_folio_key" ON "devoluciones"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "conteos_folio_key" ON "conteos"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "ajustes_folio_key" ON "ajustes"("folio");

-- CreateIndex
CREATE INDEX "demanda_registrada_producto_id_bodega_id_fecha_idx" ON "demanda_registrada"("producto_id", "bodega_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_carga_entidad_version_key" ON "plantillas_carga"("entidad", "version");

-- CreateIndex
CREATE UNIQUE INDEX "cargas_datos_clave_idempotencia_key" ON "cargas_datos"("clave_idempotencia");

-- CreateIndex
CREATE INDEX "cargas_filas_carga_id_numero_fila_idx" ON "cargas_filas"("carga_id", "numero_fila");

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_bodega" ADD CONSTRAINT "accesos_bodega_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_bodega" ADD CONSTRAINT "accesos_bodega_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros" ADD CONSTRAINT "parametros_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones" ADD CONSTRAINT "aprobaciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones" ADD CONSTRAINT "aprobaciones_solicitado_por_id_fkey" FOREIGN KEY ("solicitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones" ADD CONSTRAINT "aprobaciones_resuelto_por_id_fkey" FOREIGN KEY ("resuelto_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bodegas" ADD CONSTRAINT "bodegas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bodegas" ADD CONSTRAINT "bodegas_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_categoria_padre_id_fkey" FOREIGN KEY ("categoria_padre_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marcas" ADD CONSTRAINT "marcas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_medida" ADD CONSTRAINT "unidades_medida_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "marcas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_unidad_base_id_fkey" FOREIGN KEY ("unidad_base_id") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_ubicaciones_permitidas" ADD CONSTRAINT "productos_ubicaciones_permitidas_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_ubicaciones_permitidas" ADD CONSTRAINT "productos_ubicaciones_permitidas_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_ubicaciones_permitidas" ADD CONSTRAINT "productos_ubicaciones_permitidas_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversiones_producto" ADD CONSTRAINT "conversiones_producto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversiones_producto" ADD CONSTRAINT "conversiones_producto_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "unidades_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_reposicion" ADD CONSTRAINT "parametros_reposicion_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_reposicion" ADD CONSTRAINT "parametros_reposicion_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_proveedores" ADD CONSTRAINT "productos_proveedores_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_proveedores" ADD CONSTRAINT "productos_proveedores_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_proveedores" ADD CONSTRAINT "productos_proveedores_unidad_compra_id_fkey" FOREIGN KEY ("unidad_compra_id") REFERENCES "unidades_medida"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transportistas" ADD CONSTRAINT "transportistas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centros_costo" ADD CONSTRAINT "centros_costo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motivos" ADD CONSTRAINT "motivos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operaciones_inventario" ADD CONSTRAINT "operaciones_inventario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operaciones_inventario" ADD CONSTRAINT "operaciones_inventario_bodega_id_fkey" FOREIGN KEY ("bodega_id") REFERENCES "bodegas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operaciones_inventario" ADD CONSTRAINT "operaciones_inventario_operacion_origen_id_fkey" FOREIGN KEY ("operacion_origen_id") REFERENCES "operaciones_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_operacion_id_fkey" FOREIGN KEY ("operacion_id") REFERENCES "operaciones_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ubicacion_origen_id_fkey" FOREIGN KEY ("ubicacion_origen_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ubicacion_destino_id_fkey" FOREIGN KEY ("ubicacion_destino_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_inventario" ADD CONSTRAINT "saldos_inventario_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas_costo" ADD CONSTRAINT "capas_costo_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas_costo" ADD CONSTRAINT "capas_costo_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_costo" ADD CONSTRAINT "aplicaciones_costo_capa_costo_id_fkey" FOREIGN KEY ("capa_costo_id") REFERENCES "capas_costo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_compra" ADD CONSTRAINT "solicitudes_compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_compra" ADD CONSTRAINT "solicitudes_compra_proveedor_sugerido_id_fkey" FOREIGN KEY ("proveedor_sugerido_id") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_compra_detalle" ADD CONSTRAINT "solicitudes_compra_detalle_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_solicitud_compra_id_fkey" FOREIGN KEY ("solicitud_compra_id") REFERENCES "solicitudes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra_detalle" ADD CONSTRAINT "ordenes_compra_detalle_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones" ADD CONSTRAINT "recepciones_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "ordenes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones_detalle" ADD CONSTRAINT "recepciones_detalle_recepcion_id_fkey" FOREIGN KEY ("recepcion_id") REFERENCES "recepciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepciones_detalle" ADD CONSTRAINT "recepciones_detalle_orden_compra_detalle_id_fkey" FOREIGN KEY ("orden_compra_detalle_id") REFERENCES "ordenes_compra_detalle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_salida" ADD CONSTRAINT "solicitudes_salida_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_salida" ADD CONSTRAINT "solicitudes_salida_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_salida" ADD CONSTRAINT "solicitudes_salida_centro_costo_id_fkey" FOREIGN KEY ("centro_costo_id") REFERENCES "centros_costo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_salida_detalle" ADD CONSTRAINT "solicitudes_salida_detalle_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_salida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_salida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_solicitud_detalle_id_fkey" FOREIGN KEY ("solicitud_detalle_id") REFERENCES "solicitudes_salida_detalle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_detalle" ADD CONSTRAINT "reservas_detalle_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_detalle" ADD CONSTRAINT "reservas_detalle_saldo_id_fkey" FOREIGN KEY ("saldo_id") REFERENCES "saldos_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparaciones" ADD CONSTRAINT "preparaciones_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_salida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparaciones_detalle" ADD CONSTRAINT "preparaciones_detalle_preparacion_id_fkey" FOREIGN KEY ("preparacion_id") REFERENCES "preparaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_preparacion_id_fkey" FOREIGN KEY ("preparacion_id") REFERENCES "preparaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_transportista_id_fkey" FOREIGN KEY ("transportista_id") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despachos_detalle" ADD CONSTRAINT "despachos_detalle_despacho_id_fkey" FOREIGN KEY ("despacho_id") REFERENCES "despachos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_transportista_id_fkey" FOREIGN KEY ("transportista_id") REFERENCES "transportistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias_detalle" ADD CONSTRAINT "transferencias_detalle_transferencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "transferencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devoluciones_detalle" ADD CONSTRAINT "devoluciones_detalle_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "devoluciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteos_detalle" ADD CONSTRAINT "conteos_detalle_conteo_id_fkey" FOREIGN KEY ("conteo_id") REFERENCES "conteos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_conteo_id_fkey" FOREIGN KEY ("conteo_id") REFERENCES "conteos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajustes_detalle" ADD CONSTRAINT "ajustes_detalle_ajuste_id_fkey" FOREIGN KEY ("ajuste_id") REFERENCES "ajustes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demanda_registrada" ADD CONSTRAINT "demanda_registrada_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pronosticos" ADD CONSTRAINT "pronosticos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_carga" ADD CONSTRAINT "plantillas_carga_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapeos_carga" ADD CONSTRAINT "mapeos_carga_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_datos" ADD CONSTRAINT "cargas_datos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_datos" ADD CONSTRAINT "cargas_datos_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_datos" ADD CONSTRAINT "cargas_datos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_datos" ADD CONSTRAINT "cargas_datos_aprobado_por_id_fkey" FOREIGN KEY ("aprobado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_filas" ADD CONSTRAINT "cargas_filas_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "cargas_datos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargas_errores" ADD CONSTRAINT "cargas_errores_carga_id_fkey" FOREIGN KEY ("carga_id") REFERENCES "cargas_datos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acciones_recomendadas" ADD CONSTRAINT "acciones_recomendadas_alerta_id_fkey" FOREIGN KEY ("alerta_id") REFERENCES "alertas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
