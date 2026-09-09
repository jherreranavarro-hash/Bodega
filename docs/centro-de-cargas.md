# Centro de cargas de datos

Módulo prioritario del encargo: permite poblar y mantener la base mediante archivos,
sin modificaciones manuales directas en la base de datos.

## Entidades soportadas en este entregable

| Entidad | Plantilla | Qué hace |
|---|---|---|
| `PRODUCTOS` | `plantillas/productos_ejemplo.csv` | Crea/actualiza productos por código |
| `INVENTARIO_INICIAL` | `plantillas/inventario_inicial_ejemplo.csv` | Registra apertura de inventario como operación trazable (`APERTURA_INICIAL`), nunca como edición directa de saldo |
| `LLEGADA_PRODUCTOS` | `plantillas/llegada_productos_ejemplo.csv` | Llegada de mercadería (Mercado Libre / liquidación): crea o actualiza el producto y, si trae cantidad enviada, registra una recepción real (`RECEPCION`). Ver detalle abajo. |

Ver `docs/plan-implementacion.md` para las entidades pendientes (proveedores, bodegas,
ubicaciones, conversiones, parámetros de reposición, lotes, series como cargas
independientes).

## Formato de archivo: CSV o Excel (.xlsx)

Ambos formatos pasan por el mismo parser y los mismos validadores. Los encabezados se
normalizan automáticamente a snake_case ASCII (minúsculas, sin tildes, espacios y
símbolos convertidos a `_`), así que un archivo con encabezados legibles como los que
exporta Mercado Libre ("Código ML", "Valor en USD") y uno ya en snake_case
(`codigo_ml`, `valor_en_usd`) producen exactamente las mismas claves internamente. No
hace falta re-formatear un Excel real antes de subirlo.

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

### Plantilla LLEGADA_PRODUCTOS (versión 1.0)
| Campo | Obligatorio | Formato | Observación |
|---|---|---|---|
| `grupo` | No | texto | Se guarda en el producto (`Producto.grupo`) |
| `codigo` | Sí | texto | **No es, por sí solo, la clave de negocio del producto** — ver nota abajo |
| `codigo_ml` | No | texto | Código de la publicación en Mercado Libre (`Producto.codigoMercadoLibre`). **No es único**: una misma publicación puede agrupar varias unidades físicas distintas |
| `codigo_original` | No | texto | Código del proveedor/origen (`Producto.codigoOriginalProveedor`) |
| `titulo` | Solo si el producto no existe | texto | Se usa como `Producto.nombre` al crear; si el producto **ya existe**, no se sobrescribe su nombre (se guarda igual como snapshot en `LlegadaProducto.tituloOriginal`) |
| `condicion`, `status`, `sub_status`, `grade` | No | texto libre | Informativos, snapshot de esta llegada (`llegadas_producto`) |
| `cantidad_solicitada`, `cantidad_colectada` | No | decimal ≥ 0 | Puramente informativos: **nunca** mueven inventario |
| `cantidad_enviada` | No (default 0) | decimal ≥ 0 | Si es mayor a 0, genera una recepción real (`TipoOperacion.RECEPCION`) hacia la ubicación técnica "Recepción" de la bodega de destino, en estado `DISPONIBLE` |
| `peso` | No | decimal ≥ 0 | Informativo |
| `valor` | No | decimal ≥ 0 | Valor **unitario** en pesos (CLP); si falta y `cantidad_enviada > 0`, el costo del movimiento queda **pendiente** (igual criterio que `costo_unitario` en `INVENTARIO_INICIAL`); además alimenta el valor de referencia del mantenedor de precios |
| `valor_en_usd` | No | decimal ≥ 0 | Solo referencial (no se usa para costear el inventario, que siempre queda en la moneda base) |

> **Identidad del producto — `codigo` + `codigo_ml` combinados**: verificado con un
> archivo real de liquidación (619 filas), `codigo` por sí solo **no** identifica un
> producto de forma confiable — el mismo `codigo` puede repetirse hasta 7 veces con
> título, peso y valor completamente distintos (son unidades/pallets distintos dentro
> de un mismo lote de descarte). El código interno real del producto
> (`Producto.codigo`) es la combinación `"<codigo>::<codigo_ml>"` (o solo `codigo` si
> la fila no trae `codigo_ml`) — verificado como único fila a fila en ese archivo.
> Confirmado explícitamente por el usuario: "cada fila es su propia unidad/producto".
>
> Los campos numéricos (`peso`, `valor`, `valor_en_usd`, cantidades) admiten un formato
> moneda simple como `"$ 0"` (símbolo y espacio, tal como los exporta Mercado Libre): se
> les quita el `$` y los espacios antes de convertir a número, pero **nunca** se
> interpretan separadores de miles (un valor como `"16.5"` siempre es dieciséis coma
> cinco, jamás mil seiscientos cincuenta).

Esta entidad requiere además un parámetro que no viene en el archivo: la **bodega de
destino**, enviada en el campo `contexto` del formulario (`{"bodegaDestinoId": "..."}"`),
validada al recibir el archivo (rechaza si la bodega no existe en la empresa). Ver
`docs/modulos.md` y `docs/plan-implementacion.md` para el resto de las decisiones de
diseño (relación con el catálogo de productos, unidad por defecto al crear productos
nuevos, y la actualización automática del mantenedor de precios de venta).

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

La clave de idempotencia es `sha256(empresa_id | entidad | modo | contenido_del_archivo
| contexto)`, **no** el nombre del archivo (el `contexto` —p. ej. la bodega de
destino— solo se suma al hash cuando la entidad lo usa). Subir el mismo contenido dos
veces retorna la carga ya existente en lugar de crear una nueva y duplicar sus efectos
(verificado en `tests/cargas.test.ts`); subir el mismo contenido con un `contexto`
distinto (p. ej. otra bodega de destino) sí se trata como una carga nueva.

**Excepción explícita: una carga en estado `RECHAZADA`.** `RECHAZADA` solo ocurre cuando
`ejecutar` falla y su transacción se revierte completa (por ejemplo, un timeout en un
archivo grande) — a diferencia de `EJECUTADA`, nunca llegó a tocar los datos operativos,
así que no hay nada que la idempotencia deba proteger de duplicar. Devolverla tal cual
dejaría al usuario atascado para siempre bajo la misma clave, sin ninguna acción posible
en la UI (el botón "Ejecutar" solo aparece en estado `APROBADA`). Por eso, al recibir un
archivo cuya clave de idempotencia coincide con una carga `RECHAZADA`, esa carga vieja se
descarta (se borran sus filas y errores) y se crea una nueva desde cero — verificado en
`tests/cargas.test.ts`.

## Ejecución: una sola transacción con timeout ampliado

`ejecutar` procesa todas las filas de la carga dentro de una única transacción de
Prisma, para conservar la garantía de "todo o nada": si una fila falla a mitad de
camino, ninguna de las anteriores queda aplicada. El timeout por defecto de Prisma para
una transacción interactiva es 5 segundos, insuficiente para un archivo real de varios
cientos de filas en un equipo con disco más lento que el de desarrollo (un archivo de
619 filas ya tomó ~4,3 s en las pruebas de este mismo entorno) — se subió explícitamente
a 120 s (`timeout`) con 10 s de espera para adquirir conexión (`maxWait`) en vez de subir
el límite de filas por archivo (`MAXIMO_FILAS_POR_CARGA`, 5000) sin tener margen real
para procesarlas.

## Seguridad del canal de carga

- Límite de tamaño (10 MB) y filtro de extensión (`.csv`/`.txt`/`.xlsx`) en el
  middleware de subida (`multer`).
- La exportación de errores es CSV plano (no fórmulas), pero **no** se implementó todavía
  un saneo explícito contra "fórmulas peligrosas" en el CSV **de entrada** más allá de
  tratarlo siempre como texto (nunca se evalúa ni interpreta como fórmula) — documentado
  como refuerzo pendiente en `plan-implementacion.md`.

## Archivos de ejemplo

Ver `/plantillas/productos_ejemplo.csv`, `/plantillas/inventario_inicial_ejemplo.csv` y
`/plantillas/llegada_productos_ejemplo.csv` (este último con los encabezados en español
tal como los exporta Mercado Libre) para archivos listos para probar contra los datos
de la seed (`PROD-001`, `BOD-CENTRAL`, ubicación `ALM-A-01`).
