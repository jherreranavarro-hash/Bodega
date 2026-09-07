# Arquitectura y diseño funcional

## 1. Objetivo y alcance

Sistema de administración de bodegas e inventario para una o varias bodegas/sucursales
de una misma empresa, con un modelo multiempresa en la base (varias empresas pueden
convivir en la misma instalación, cada una con sus propios datos aislados).

La aplicación debe responder en todo momento: **qué tenemos, cuánto, dónde, comprometido
a quién, cuánto vale, qué falta, qué sobra, qué vence y qué corresponde comprar, trasladar
o corregir.** El diseño prioriza la integridad de los datos y el control operativo sobre
la apariencia visual de los tableros (mandato explícito del encargo, sección 17).

## 2. Arquitectura técnica

```
┌─────────────────────┐      HTTPS/JSON       ┌──────────────────────────┐
│   Frontend (SPA)     │ ───────────────────▶ │   API REST (Express)     │
│  React + TypeScript  │ ◀─────────────────── │   Node.js + TypeScript   │
│  Vite, en español    │        JWT Bearer     │                          │
└─────────────────────┘                       │  ┌────────────────────┐  │
                                               │  │ Middlewares:       │  │
                                               │  │  autenticación     │  │
                                               │  │  autorización RBAC │  │
                                               │  │  auditoría         │  │
                                               │  └────────────────────┘  │
                                               │  ┌────────────────────┐  │
                                               │  │ Servicios de       │  │
                                               │  │ negocio (motor de  │  │
                                               │  │ inventario, cargas,│  │
                                               │  │ compras, ajustes)  │  │
                                               │  └─────────┬──────────┘  │
                                               └────────────┼─────────────┘
                                                             │ Prisma ORM
                                                   ┌─────────▼─────────┐
                                                   │   PostgreSQL       │
                                                   │  (fuente de verdad)│
                                                   └────────────────────┘
```

- **Interfaz web**: React 19 + TypeScript + Vite. Consume la API vía `fetch`, guarda el
  token JWT en `localStorage`. Enrutamiento con `react-router-dom`. Todo el texto de la
  interfaz está en español.
- **Servicios de negocio**: Node.js + TypeScript + Express. Cada módulo vive en
  `backend/src/modules/<módulo>` con su propio `*.service.ts` (reglas de negocio y
  transacciones) y `*.routes.ts` (HTTP + validación de entrada con Zod).
- **Base de datos relacional**: PostgreSQL, con Prisma como ORM/migrador. El **motor de
  inventario** (`modules/inventario/inventario.service.ts`) es el único punto de escritura
  de existencias: todo movimiento pasa por una única primitiva transaccional
  (`registrarMovimiento`) que crea el registro inmutable y actualiza el saldo derivado
  dentro de la misma transacción, con bloqueo de filas (`SELECT ... FOR UPDATE`) para
  evitar condiciones de carrera.
- **Procesamiento de cargas**: el Centro de Cargas de Datos parsea CSV (`csv-parse`),
  dejando las filas en una zona de preparación (`cargas_filas`) antes de tocar datos
  operativos, con clave de idempotencia por contenido de archivo.
- **Almacenamiento de evidencias**: tabla `adjuntos` (URL + metadatos); en este entorno de
  demostración no se implementa un backend de almacenamiento de archivos (S3 o similar)
  — se documenta como pendiente en `plan-implementacion.md`.
- **Monitoreo**: `auditoria` registra toda acción sensible (quién, cuándo, sobre qué,
  resultado). No se implementó un stack de observabilidad (métricas/trazas) — pendiente.

## 3. Mapa de módulos

| Módulo | Estado | Ubicación |
|---|---|---|
| Administración y seguridad (empresas, usuarios, roles, permisos, auditoría) | Implementado | `modules/auth`, `middleware/*` |
| Mantenedores (productos, bodegas, ubicaciones, proveedores, catálogos) | Implementado (subconjunto priorizado) | `modules/productos`, `modules/maestros` |
| Centro de cargas de datos | Implementado (entidades PRODUCTOS e INVENTARIO_INICIAL) | `modules/cargas` |
| Compras y abastecimiento | Implementado (solicitud con aprobación propia → orden de compra → recepción) | `modules/compras` |
| Recepción y almacenamiento | Implementado | `modules/recepciones` |
| Inventario y trazabilidad | Implementado (motor central + reconciliación de saldos + períodos cerrados) | `modules/inventario` |
| Solicitudes y reservas | Implementado | `modules/salidas` |
| Preparación y despacho | Implementado (preparación opcional, exigida como `LISTA` cuando el despacho la referencia) | `modules/preparaciones`, `modules/despachos` |
| Transferencias | Implementado | `modules/transferencias` |
| Devoluciones y excepciones | Implementado (ingreso a cuarentena → resolución reingreso/cuarentena/baja) | `modules/devoluciones` |
| Conteos y ajustes | Implementado | `modules/ajustes` |
| Inteligencia de inventario | Implementado: indicadores, bandeja de decisiones, pronósticos y escenarios | `modules/indicadores`, `modules/alertas`, `modules/analitica` |
| Costos y valorización | Implementado: FIFO/promedio ponderado, multimoneda en recepciones | `modules/recepciones`, `modules/despachos` |
| Reportes e integraciones | Exportación CSV de errores de carga; sin integraciones externas | `modules/cargas` |
| Asistente de IA | No implementado (fuera de alcance de esta iteración) | — |

Ver el detalle módulo por módulo, con lo que falta explícitamente, en `docs/modulos.md`.

## 4. Seguridad y control de acceso

- Autenticación: JWT firmado por el servidor (`lib/auth.ts`), expiración de 8 horas.
- Autorización: modelo `Rol` → `RolPermiso` → `Permiso (recurso, accion)`. Cada ruta exige
  un permiso explícito vía `requierePermiso(recurso, accion)`, verificado en el servidor
  (nunca solo en la interfaz).
- Aislamiento por empresa: toda entidad operativa lleva `empresaId` (directa o vía su
  bodega); las consultas siempre filtran por la empresa del usuario autenticado, y las
  rutas de creación verifican que la bodega referenciada pertenezca a esa empresa
  (`403` si no, ver prueba `api.test.ts`).
- Separación de funciones: por ejemplo, `ajustesRouter` rechaza que el mismo usuario que
  solicitó un ajuste lo apruebe.
- Auditoría: `registrarAuditoria` deja constancia de accesos denegados y de las acciones
  de negocio relevantes (crear producto, aprobar carga, aprobar ajuste, etc.), con
  usuario, empresa, entidad, resultado y fecha.

## 5. Principios de datos que gobiernan el diseño

1. **El saldo nunca se edita directamente.** Se deriva de `movimientos_inventario`
   (tabla de solo inserción) dentro de la misma transacción que lo origina.
2. **Una reserva es un compromiso, no una salida física.** Descuenta stock libre, no
   stock físico. El despacho y el consumo de la reserva se contabilizan juntos.
3. **Los documentos en borrador no afectan existencias.** Solo las operaciones
   contabilizadas mueven saldo.
4. **Las correcciones son compensatorias, no destructivas.** No se reescribe historial;
   `operaciones_inventario.operacion_origen_id` permite encadenar una compensación con
   la operación que corrige.
5. **La concurrencia se controla con bloqueo pesimista** (`FOR UPDATE`) sobre los saldos
   afectados, en un orden determinístico, para permitir que dos reservas o despachos
   simultáneos sobre el mismo stock nunca sobrecomprometan existencias.

## 6. Cómo se llegó a esto (orden de ejecución seguido)

Tal como pide la sección 17 del encargo: primero arquitectura + mapa de módulos + modelo
de datos (este documento y `modelo-datos.md`); luego una operación completa de punta a
punta — mantenedores → carga validada de inventario inicial → recepción de compra →
reserva → despacho → indicador de disponibilidad —, verificada con pruebas automatizadas
reales contra PostgreSQL. A partir de ese núcleo se added transferencias, conteos/ajustes
y valorización FIFO/promedio ponderado. El detalle de qué sigue pendiente y en qué orden
se aborda está en `plan-implementacion.md`.
