# Centro de cargas de datos

Módulo prioritario del encargo: permite poblar y mantener la base mediante archivos,
sin modificaciones manuales directas en la base de datos.

## Entidades soportadas en este entregable

| Entidad | Plantilla | Qué hace |
|---|---|---|
| `PRODUCTOS` | `plantillas/productos_ejemplo.csv` | Crea/actualiza productos por código |
| `INVENTARIO_INICIAL` | `plantillas/inventario_inicial_ejemplo.csv` | Registra apertura de inventario como operación trazable (`APERTURA_INICIAL`), nunca como edición directa de saldo |

Ver `docs/plan-implementacion.md` para las entidades pendientes (proveedores, bodegas,
ubicaciones, conversiones, parámetros de reposición, lotes, series como cargas
independientes).

## Diccionario de campos

### Plantilla PRODUCTOS (versión 1.0)
| Campo | Obligatorio | Formato | Ejemplo | Observación |
|---|---|---|---|---|
| `codigo` | Sí | texto, ≤30 | `PROD-100` | Clave de negocio dentro de la empresa |
| `nombre` | Sí | texto, ≤120 | `Aceite de Oliva 500ml` | |
| `descripcion` | No | texto, ≤500 | | |
| `codigo_barras` | No | texto, ≤30 | | |
| `unidad_base_codigo` | Sí | código existente en `unidades_medida` | `UN` | Debe existir previamente; no se crea por suposición |
| `control_lote` | No | `true`/`false` | `true` | |
| `control_serie` | No | `true`/`false` | `false` | |
| `control_vencimiento` | No | `true`/`false` | `true` | |
| `metodo_valorizacion` | No | `PROMEDIO_PONDERADO`\|`FIFO` | `PROMEDIO_PONDERADO` | |

### Plantilla INVENTARIO_INICIAL (versión 1.0)
| Campo | Obligatorio | Formato | Dependencia |
|---|---|---|---|
| `producto_codigo` | Sí | texto | Debe existir en `productos` — si no existe, la fila se **rechaza**, nunca se crea el producto por suposición |
| `bodega_codigo` | Sí | texto | Debe existir en `bodegas` |
| `ubicacion_codigo` | Sí | texto | Debe existir en `ubicaciones` de esa bodega |
| `cantidad` | Sí | decimal > 0 | |
| `unidad_codigo` | Sí | texto | Si difiere de la unidad base del producto, debe existir una `conversion_producto` previa; si no existe, se rechaza (no se asume factor 1) |
| `lote_codigo` | No | texto | |
| `fecha_vencimiento` | No | `YYYY-MM-DD` | |
| `costo_unitario` | No | decimal ≥ 0 | Si se omite, el costo queda **pendiente** (`NULL`) — nunca se asume cero silenciosamente |

## Flujo completo (igual para toda entidad)

1. **Recepción del archivo** — `POST /api/cargas` (multipart, campos `archivo`, `entidad`,
   `modo`). El archivo se parsea y cada fila se guarda en `cargas_filas` (zona de
   preparación). **Nada operativo cambia todavía.**
2. **Validación estructural y de negocio** — `POST /api/cargas/:id/validar`. Revisa
   campos obligatorios, tipos, duplicados dentro del archivo, existencia de
   dependencias (producto/bodega/ubicación/unidad/conversión), y reglas condicionales
   (ej. producto con `control_lote=true` exige lote en la recepción real). Cada error
   queda en `cargas_errores` con severidad `BLOQUEANTE` o `ADVERTENCIA`.
3. **Simulación** — el mismo paso calcula cuántas filas se crearían, actualizarían,
   quedarían sin cambio o se rechazarían (`filasCrear/filasActualizar/filasRechazar/
   filasSinCambio` en la respuesta), sin aplicar nada.
4. **Aprobación** — `POST /api/cargas/:id/aprobar`. Solo procede si la simulación no
   tiene errores bloqueantes.
5. **Ejecución controlada** — `POST /api/cargas/:id/ejecutar`. Se reclama con un
   `UPDATE ... WHERE estado = 'APROBADA'` atómico: si la carga ya está ejecutándose o ya
   se ejecutó, un reintento no la vuelve a procesar. Se ejecuta dentro de una única
   transacción de base de datos.
6. **Resultado y conciliación** — cada fila queda marcada `procesada` con el id de la
   entidad/movimiento que generó; los errores se pueden descargar en
   `GET /api/cargas/:id/errores.csv`.

## Modos de carga (explícitos, sin cambio silencioso)

- `SOLO_CREACION`: rechaza filas cuyo código ya existe.
- `SOLO_ACTUALIZACION`: rechaza filas cuyo código no existe.
- `CREACION_Y_ACTUALIZACION`: crea o actualiza según corresponda.
- `VALIDACION_SIN_APLICAR`: valida y simula, pero `ejecutar` rechaza explícitamente
  la ejecución (útil para probar un archivo antes de comprometerse).

## Idempotencia

La clave de idempotencia es `sha256(empresa_id | entidad | modo | contenido_del_archivo)`,
**no** el nombre del archivo. Subir el mismo contenido dos veces retorna la carga ya
existente en lugar de crear una nueva y duplicar sus efectos (verificado en
`tests/cargas.test.ts`).

## Seguridad del canal de carga

- Límite de tamaño (10 MB) y filtro de extensión (`.csv`/`.txt`) en el middleware de
  subida (`multer`).
- La exportación de errores es CSV plano (no fórmulas), pero **no** se implementó todavía
  un saneo explícito contra "fórmulas peligrosas" en el CSV **de entrada** más allá de
  tratarlo siempre como texto (nunca se evalúa ni interpreta como fórmula) — documentado
  como refuerzo pendiente en `plan-implementacion.md`.

## Archivos de ejemplo

Ver `/plantillas/productos_ejemplo.csv` y `/plantillas/inventario_inicial_ejemplo.csv`
para archivos listos para probar contra los datos de la seed (`PROD-001`,
`BOD-CENTRAL`, ubicación `ALM-A-01`).
