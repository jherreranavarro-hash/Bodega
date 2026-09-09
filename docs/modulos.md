# Módulos: alcance y estado

Convención de estado: **Implementado** (servicio + API + UI + al menos una prueba
automatizada), **Parcial** (servicio y/o API existen pero falta UI o cobertura), **Modelo
de datos** (tablas y relaciones existen; sin servicio de negocio), **Pendiente** (no
iniciado en este entregable).

## Administración y seguridad — Implementado
- Empresas, usuarios, roles, permisos (`recurso.accion`), accesos por bodega, parámetros,
  auditoría.
- Endpoints: `POST /api/auth/login`.
- Middleware `requiereAutenticacion` + `requierePermiso(recurso, accion)` en **todas**
  las rutas de negocio.
- **Panel de administración de roles y permisos** (`modules/administracion`, pantalla
  "Administración"): matriz de permisos por rol donde cada casilla otorga o revoca un
  permiso real (`POST`/`DELETE /api/administracion/roles/:rolId/permisos`), siempre
  verificado también en el servidor, nunca solo en la UI. El rol `administrador` se
  muestra fijo (no editable) porque siempre tiene todos los permisos. Cambio de rol de
  un usuario (`PUT /api/administracion/usuarios/:id/rol`) restringido a usuarios de la
  misma empresa que quien administra (404 si el usuario objetivo es de otra empresa).
  **Roles y permisos son un catálogo global**, no uno por empresa: cambiar los permisos
  de un rol aquí lo cambia para todas las empresas que lo usan — simplificación
  deliberada de esta iteración, documentada en `plan-implementacion.md`. Cubierto por 4
  pruebas (`tests/administracion.test.ts`) y por el smoke test de UI.
- Pendiente: catálogo de roles/permisos por empresa (hoy es global, ver nota arriba);
  recuperación de contraseña; expiración/rotación de tokens.

## Mantenedores — Implementado (subconjunto priorizado)
- Productos (`/api/productos`): CRUD, activar/desactivar, búsqueda por código/nombre/
  código de barras, filtro por activo/categoría. El listado también muestra Grupo,
  Condición, Status, Sub Status y Grade de la **última llegada** de cada producto (los
  mismos campos del Excel de `LLEGADA_PRODUCTOS`, ver `docs/plan-implementacion.md` fase
  6) con filtros por cada uno (`GET /api/productos/filtros/llegada` entrega las opciones
  reales declaradas en las llegadas de la empresa). A pedido explícito del usuario: son
  filtros/columnas de lectura sobre el historial de llegadas, no columnas propias de
  `Producto` — un producto sin llegadas nunca aparece bajo estos filtros y muestra "—".
- Bodegas y ubicaciones (`/api/bodegas`, `/api/ubicaciones`): alta y listado, con tipo de
  ubicación (recepción/almacenamiento/preparación/despacho/cuarentena/tránsito/devolución).
- Proveedores (`/api/proveedores`): alta, listado, desactivación.
- Catálogos de apoyo (`/api/catalogos/unidades-medida`, `/categorias`, `/marcas`, `/motivos`).
- **Modelo de datos completo, sin API/UI dedicada todavía**: clientes, transportistas,
  áreas, centros de costo, conversiones de producto (se cargan hoy vía seed/carga de
  inventario inicial, no vía mantenedor propio), `productos_ubicaciones_permitidas`.
- Pendiente: exportación masiva de mantenedores a Excel/CSV (hoy solo el centro de
  cargas exporta errores); historial de cambios visible en UI (existe `Auditoria` en
  base, falta pantalla).

## Centro de cargas de datos — Implementado (tres entidades)
- Entidades soportadas: `PRODUCTOS`, `INVENTARIO_INICIAL`, `LLEGADA_PRODUCTOS`.
- Flujo completo: recepción a zona de preparación → validación estructural/negocio →
  simulación (crear/actualizar/rechazar/sin cambio) → aprobación → ejecución
  transaccional → errores descargables en CSV.
- Acepta CSV y **Excel (.xlsx)** indistintamente: ambos formatos pasan por el mismo
  parser, con los encabezados normalizados a snake_case ASCII (sin tildes, espacios a
  `_`), así que un archivo con columnas legibles ("Código ML", "Valor en USD") produce
  las mismas claves que uno ya en snake_case.
- **`LLEGADA_PRODUCTOS`** (mercadería de Mercado Libre / liquidación): crea o actualiza
  el producto por código (a diferencia de `INVENTARIO_INICIAL`, aquí sí se espera
  mercadería nueva, nunca rechaza por producto inexistente) y, cuando la fila trae
  cantidad enviada, registra una recepción real (`TipoOperacion.RECEPCION`) hacia una
  ubicación técnica "Recepción" autoprovisionada por bodega, en estado `DISPONIBLE`. Las
  cantidades solicitada/colectada son puramente informativas y nunca mueven inventario.
  El valor unitario declarado alimenta además el valor de referencia del mantenedor de
  precios de venta (ver más abajo). Requiere indicar la bodega de destino (no viene en
  el archivo). Detalle completo, incluyendo el diccionario de campos, en
  `docs/centro-de-cargas.md`. Cubierto por 6 pruebas (`tests/llegada-productos.test.ts`).
- Idempotencia por hash de contenido y, cuando aplica, del contexto de la carga (p. ej.
  la bodega de destino) — no por nombre de archivo.
- Límite de 5000 filas por archivo (`MAXIMO_FILAS_POR_CARGA`): un archivo mayor se
  rechaza explícitamente antes de simularlo o ejecutarlo, para que una carga mal
  formada no pueda saturar el proceso de validación.
- Pendiente: entidades adicionales (proveedores, bodegas, ubicaciones, conversiones,
  parámetros de reposición, lotes, series como cargas independientes — hoy solo se
  crean por mantenedor o como parte de inventario inicial); mapeo de columnas
  configurable por el usuario (`mapeos_carga` existe en el modelo, sin UI); escaneo
  antivirus de archivos maliciosos más allá del filtro de
  extensión/tamaño.

## Compras y abastecimiento — Implementado
- Solicitudes de compra (`/api/compras/solicitudes`): nacen **siempre**
  `PENDIENTE_APROBACION` (nunca se crean ya aprobadas); `POST .../:id/aprobar` y
  `.../:id/rechazar` exigen que el aprobador sea un usuario distinto de quien solicitó
  (separación de funciones, igual criterio que ajustes y devoluciones).
- `POST /api/compras/solicitudes/desde-reposicion`: genera la solicitud directamente
  desde la alerta de bajo punto de reposición de un producto/bodega, respetando la
  cantidad mínima de compra y el múltiplo de pedido del producto (sección 11 del
  encargo); falla explícitamente si el producto no está realmente bajo su punto de
  reposición en ese momento (no se genera una solicitud injustificada).
- `POST /api/compras/solicitudes/:id/convertir-orden`: solo convierte solicitudes en
  estado `APROBADA`, exige un costo pactado por cada línea, y no permite convertir la
  misma solicitud dos veces (queda vinculada 1:1 con la orden de compra resultante vía
  `OrdenCompra.solicitudCompraId`).
- Órdenes de compra (`/api/compras/ordenes`) con detalle, reprogramación de fecha
  comprometida conservando la fecha original; también admite creación directa sin pasar
  por una solicitud, para operaciones simples que no requieren ese control adicional.
- Pendiente: aprobación multinivel configurable por monto; conversión parcial de una
  solicitud en varias órdenes de compra (hoy es 1:1); vínculo automático entre la
  bandeja de decisiones (aún no implementada) y la generación de estas solicitudes.

## Recepción y almacenamiento — Implementado
- `POST /api/compras/recepciones`: recepción total o parcial, actualización de
  `cantidad_recibida`/`cantidad_rechazada` en la OC, apertura de capa de costo,
  exige lote cuando el producto lo controla.
- Pendiente: inspección de calidad como paso explícito con estados intermedios (hoy la
  aceptación/rechazo se registra en la misma recepción); asignación automática de
  ubicación sugerida.

## Inventario y trazabilidad — Implementado (motor central)
- `calcularDisponibilidad`, `registrarMovimiento`, `crearReserva`, control de
  concurrencia con `SELECT ... FOR UPDATE`.
- **Reconciliación de saldos** (`GET /api/indicadores/reconciliacion`, o
  `npm run reconciliar -- <rut>` desde `backend/`): reconstruye cada saldo desde
  `movimientos_inventario` (incluyendo el estado propio de cada lado de un movimiento con
  origen y destino distintos, como una transferencia) y reporta cualquier desviación
  frente a lo registrado en `saldos_inventario`. Es el control independiente que
  detecta si esa proyección de lectura se desvió alguna vez de su fuente de verdad.
- **Períodos cerrados** (`GET/PUT /api/parametros/periodo-cierre`, rol administrador):
  toda operación de inventario pasa por `crearOperacion`, que rechaza una fecha
  efectiva igual o anterior a la fecha de cierre configurada, salvo que el propio
  llamador pase explícitamente `permitirPeriodoCerrado` — ningún flujo lo activa por
  sí solo en este entregable. El cierre no se puede retroceder una vez establecido.
- Pendiente: consulta de "vista 360°" de un producto (existencias + reservas +
  movimientos + compras pendientes + vencimientos + costos + alertas en una sola
  pantalla) — hoy esa información existe pero repartida en varias pantallas/endpoints;
  una UI dedicada para configurar el cierre de período (hoy es API/administración).

## Costos y valorización — Implementado
- Promedio ponderado o FIFO por producto (`Producto.metodoValorizacion`); el despacho
  aplica el método correspondiente y, si no hay capas de costo suficientes para cubrir
  la cantidad, el costo de lo no cubierto queda **pendiente** en vez de asumirse cero.
- **Multimoneda en recepciones**: una línea de recepción puede facturarse en una moneda
  distinta a la de la empresa, indicando el tipo de cambio aplicado; el documento de
  recepción conserva el costo tal como fue facturado (moneda original), mientras que el
  movimiento de inventario y la capa de costo quedan valorizados en la moneda base de
  la empresa — la capa de costo además guarda `moneda` y `tipoCambio` para trazabilidad
  (sección 10 del encargo). Falta el tipo de cambio y la moneda difiere de la de la
  empresa → la recepción se rechaza explícitamente, nunca asume una tasa de 1:1.
- Pendiente: conversión/consolidación multimoneda en los indicadores y tableros (hoy
  todo costo ya llega convertido a la moneda base desde el ingreso, por lo que los
  indicadores no mezclan monedas, pero no hay una vista que muestre el valor en una
  moneda de reporte distinta a la base); traslados internos entre bodegas de distinta
  empresa (no aplica en este modelo: una transferencia siempre es intraempresa).

## Precios de venta — Implementado
- Mantenedor por producto (`GET/PUT /api/precios`, pantalla "Precios de Venta"): cada
  producto tiene un precio de venta en modo **Fijo** (un monto en pesos definido a
  mano) o **Porcentaje** (un margen sobre el último valor declarado en su llegada más
  reciente vía `LLEGADA_PRODUCTOS`). El precio calculado se recalcula y persiste cada
  vez que cambia el modo, el margen/precio fijo, o llega un nuevo valor de referencia
  — nunca se recalcula "al vuelo" en cada lectura ni se muestra una cifra inventada: en
  modo porcentaje, sin valor de referencia todavía, la pantalla muestra "Sin calcular"
  en vez de asumir un valor.
- El valor de referencia (`valorReferenciaClp`/`valorReferenciaUsd`) se actualiza
  automáticamente desde `modules/cargas` cada vez que llega una fila de
  `LLEGADA_PRODUCTOS` con valor declarado, dentro de la misma transacción que registra
  la llegada — no requiere ninguna acción manual para mantenerse al día.
- IVA (19%) opcional por producto (`afectoIva`, por defecto `true`): junto al precio
  neto (`precioVentaCalculado`) se persiste también el precio con IVA
  (`precioVentaConIva`), recalculado en el mismo momento que el neto — nunca "al
  vuelo" al leer. Un producto puede marcarse como no afecto (exento) desde el
  mantenedor; si no se envía `afectoIva` en una actualización, se conserva la última
  opción elegida para ese producto en vez de resetearla a afecto.
- Cubierto por 10 pruebas (`tests/precios.test.ts`, incluye 3 específicas de IVA: valor
  por defecto afecto, producto exento, y que cambiar solo el margen conserva la
  opción de IVA ya elegida) y por el smoke test de UI (sube una llegada real, configura
  un margen porcentual, verifica que el precio calculado se obtiene del valor real
  declarado en el Excel —no de una cifra arbitraria—, y verifica que desmarcar "Afecto a
  IVA" deja el precio con IVA igual al neto).
- Pendiente: historial de cambios de precio (hoy solo se guarda el estado vigente, no
  quién cambió qué y cuándo más allá de `actualizadoPorId`/`actualizadoEn`); reglas de
  precio por lote de compra o por canal de venta (hoy es un precio único por producto).

## Solicitudes y reservas — Implementado
- `/api/salidas/solicitudes`, `/api/salidas/reservas`. FEFO opcional
  (`priorizarVencimiento`) para productos con control de vencimiento.
- Pendiente: aprobación explícita de la solicitud antes de reservar (hoy se crea ya
  `APROBADA` para simplificar la demo — el estado y el campo existen para endurecerlo).

## Preparación y despacho — Implementado
- `/api/preparaciones`: crea una lista de preparación desde una solicitud de salida (una
  línea por línea de la solicitud), permite verificar cada línea
  (`cantidadVerificada`, sin poder exceder lo solicitado) y marcar la preparación como
  `LISTA` — que exige que **toda** línea esté completamente verificada.
- `/api/salidas/despachos`: consume la reserva en la misma transacción, aplica costo
  FIFO o deja el costo pendiente si no hay capas suficientes. Si el despacho referencia
  una `preparacionId`, se **rechaza** a menos que esa preparación esté en estado `LISTA`
  (validación de negocio, no solo de UI).
- La preparación es opcional: un despacho puede seguir haciéndose directo desde la
  reserva sin pasar por preparación cuando la operación no lo requiere (p.ej. bodegas
  pequeñas de un solo operador).
- Pendiente: embalaje multi-bulto y evidencia de entrega como archivo adjunto (hoy
  `Despacho.evidenciaUrl` es solo una URL de texto).

## Transferencias — Implementado
- Despacho (origen → tránsito) y recepción (tránsito → destino) en dos pasos, sin doble
  conteo (`docs/modelo-datos.md` y prueba de aceptación dedicada).
- Pendiente: anulación/reversa de una transferencia en tránsito.

## Devoluciones y excepciones — Implementado
- Flujo devolución → inspección → resolución (`/api/devoluciones`): el ingreso siempre
  se registra en una ubicación técnica de cuarentena por bodega (estado `CUARENTENA`),
  autoprovisionada igual que la de tránsito de transferencias — **nunca** aumenta el
  stock disponible automáticamente.
- La resolución (`POST /api/devoluciones/detalle/:id/resolver`) admite
  `REINGRESO_DISPONIBLE` (mueve a una ubicación de destino en estado `DISPONIBLE`),
  `CUARENTENA` (queda donde está, sin nuevo movimiento) o `BAJA` (sale definitivamente
  del stock físico). Dar de baja exige un motivo de categoría `BAJA` y evidencia si el
  motivo la requiere (igual criterio que en ajustes).
- Separación de funciones: el usuario que registró el ingreso de la devolución no puede
  resolver sus líneas.
- Pendiente: vínculo automático con el despacho de origen para prellenar cantidades
  (`despachoOrigenId` ya existe en el modelo, hoy se informa manualmente); pantalla de
  reconteo/inspección con evidencia fotográfica adjunta como archivo (hoy es una URL).

## Conteos y ajustes — Implementado
- Conteo ciego opcional, congela `cantidad_esperada` al planificar, genera ajuste desde
  diferencias, exige motivo (y evidencia si el motivo la requiere), separación de
  funciones (quien solicita no aprueba), y solo aplica el movimiento de inventario al
  aprobar.
- Pendiente: bloqueo de movimientos durante el conteo (hoy es responsabilidad operativa,
  no forzada por el sistema) o conciliación de operaciones posteriores al conteo.

## Inteligencia de inventario — Implementado
- Implementado: stock bajo punto de reposición, sobrestock, vencimientos próximos,
  disponibilidad por producto/bodega, exactitud de inventario por conteo.
- **Bandeja de decisiones implementada** (`modules/alertas`, pantalla "Centro de
  Decisiones"): `POST /api/alertas/generar` detecta condiciones de alerta a partir de
  los tres indicadores anteriores (bajo punto de reposición, sobrestock, vencimiento
  próximo), sin duplicar una alerta ya abierta para el mismo producto/bodega o lote.
  Cada alerta guarda la evidencia numérica que la sustenta y trae una acción recomendada
  explícita, con severidad calculada (ALTA si el faltante supera el 50% del punto de
  reposición, o si el vencimiento es en 7 días o menos). Cada acción se puede aceptar,
  rechazar (exige justificación), postergar (con nueva fecha objetivo) o —solo para
  alertas de reposición— convertir en una solicitud de compra real (que nace igualmente
  `PENDIENTE_APROBACION`, ver módulo de Compras). **Ninguna acción ejecuta por sí sola**
  una compra, baja, transferencia o ajuste — solo llega hasta el paso ya controlado y
  auditado de cada flujo correspondiente (sección 12 del encargo).
- La generación de alertas es una acción explícita a pedido (botón "Detectar alertas
  ahora"), no un proceso automático en segundo plano — documentado como supuesto en
  `plan-implementacion.md`.
- **Pronósticos implementados** (`modules/analitica`, pantalla "Pronósticos y
  Escenarios"): la demanda real (`demanda_registrada`) se acumula por día desde hechos
  concretos — lo solicitado en cada solicitud de salida y lo efectivamente despachado —,
  nunca inferida desde el saldo. `POST /api/analitica/pronosticos` calcula un promedio
  móvil sobre una ventana de 30 días, exigiendo al menos 7 días de historia; si no hay
  suficiente historia, **declara la insuficiencia explícitamente en vez de inventar una
  cifra** (caso de aceptación 14 del encargo). Cuando sí calcula, hace *backtesting* del
  propio método contra una regla simple (repetir el valor del día anterior) sobre el
  mismo historial, y siempre expone sus limitaciones en texto (tamaño de la muestra,
  que la demanda registrada incluye lo no atendido, etc.).
- **Escenarios de simulación implementados**: `POST /api/analitica/escenarios` simula
  el efecto de un aumento de demanda, un atraso de proveedor y/o un cambio en el stock
  de seguridad sobre el punto de reposición y la cobertura estimada, sin tocar los
  parámetros reales ni generar ninguna operación; el resultado queda etiquetado como
  simulación (`esSimulacion: true`) y siempre junto a sus supuestos, para no confundirse
  con datos reales.
- Pendiente: alertas de tipo `PROVEEDOR_INCUMPLIMIENTO` y `DATO_INCOMPLETO` (el modelo
  las contempla; no hay una fuente de datos implementada que las genere todavía);
  programar la generación de alertas como tarea periódica en vez de manual; métodos de
  pronóstico adicionales (estacionalidad, suavizado exponencial) más allá del promedio
  móvil con evaluación simple.

## Adjuntos y evidencias — Implementado (API genérica, sin integrar aún a flujos puntuales)
- `POST /api/adjuntos` (multipart, campo `archivo` + `entidad`/`entidadId`),
  `GET /api/adjuntos?entidad=&entidadId=`, `GET /api/adjuntos/:id/descargar`,
  `DELETE /api/adjuntos/:id`: almacenamiento real en disco
  (`backend/storage/adjuntos/`), con nombre de archivo aleatorio (nunca expuesto al
  cliente) y descarga siempre a través de una ruta autenticada que resuelve el archivo
  real desde el registro en base de datos. Extensión restringida
  (`.jpg/.jpeg/.png/.pdf/.webp`) y tamaño máximo de 10 MB. Cubierto por 4 pruebas
  (`tests/adjuntos.test.ts`).
- Pendiente: conectar esta API con los campos `evidenciaUrl` de ajustes, devoluciones y
  despachos (hoy cada uno sigue teniendo su propio campo de texto, ver notas en sus
  secciones); escaneo antivirus del contenido subido.

## Reportes e integraciones — Parcial
- Exportación CSV de errores de carga.
- Pendiente: exportaciones generales de mantenedores/movimientos, integraciones con
  sistemas externos (autenticación, reintentos, conciliación).

## Asistente de IA — No implementado
Fuera de alcance de esta iteración. El diseño de datos (fuentes de indicadores,
trazabilidad de movimientos y documentos) es la base sobre la que se podría construir
sin exponer acceso irrestricto a la base, tal como exige el encargo.
