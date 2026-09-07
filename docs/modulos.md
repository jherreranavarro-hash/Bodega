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
- Pendiente: pantalla de administración de roles/permisos desde la UI (hoy se gestionan
  vía seed/API); recuperación de contraseña; expiración/rotación de tokens.

## Mantenedores — Implementado (subconjunto priorizado)
- Productos (`/api/productos`): CRUD, activar/desactivar, búsqueda por código/nombre/
  código de barras, filtro por activo/categoría.
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

## Centro de cargas de datos — Implementado (dos entidades)
- Entidades soportadas: `PRODUCTOS`, `INVENTARIO_INICIAL`.
- Flujo completo: recepción a zona de preparación → validación estructural/negocio →
  simulación (crear/actualizar/rechazar/sin cambio) → aprobación → ejecución
  transaccional → errores descargables en CSV.
- Idempotencia por hash de contenido (no por nombre de archivo).
- Detalle completo en `docs/centro-de-cargas.md`.
- Pendiente: entidades adicionales (proveedores, bodegas, ubicaciones, conversiones,
  parámetros de reposición, lotes, series como cargas independientes — hoy solo se
  crean por mantenedor o como parte de inventario inicial); mapeo de columnas
  configurable por el usuario (`mapeos_carga` existe en el modelo, sin UI); soporte Excel
  (.xlsx) además de CSV; escaneo de archivos maliciosos más allá del filtro de
  extensión/tamaño.

## Compras y abastecimiento — Implementado (núcleo)
- Órdenes de compra (`/api/compras/ordenes`) con detalle, reprogramación de fecha
  comprometida conservando la fecha original.
- **Modelo de datos completo, sin flujo de aprobación propio**: `solicitudes_compra` —
  el modelo soporta generar una OC desde una solicitud, pero el flujo de aprobación de
  la solicitud en sí (previo a convertirse en OC) no tiene endpoint dedicado en esta
  iteración.
- Pendiente: aprobación multinivel configurable por monto; alertas automáticas que
  generen solicitudes de compra (el indicador de reposición existe; la conversión
  automática a solicitud es manual/futura, ver `docs/plan-implementacion.md`).

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
- Pendiente: consulta de "vista 360°" de un producto (existencias + reservas +
  movimientos + compras pendientes + vencimientos + costos + alertas en una sola
  pantalla) — hoy esa información existe pero repartida en varias pantallas/endpoints.

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

## Inteligencia de inventario — Parcial
- Implementado: stock bajo punto de reposición, sobrestock, vencimientos próximos,
  disponibilidad por producto/bodega, exactitud de inventario por conteo.
- **Modelo de datos, sin cálculo automático**: `demanda_registrada`, `pronosticos`,
  `escenarios`, `alertas`, `acciones_recomendadas` — las tablas existen para soportar
  el diseño, pero el cálculo de pronósticos, la generación automática de alertas y la
  bandeja de decisiones con aceptar/rechazar/postergar **no están implementados**.

## Reportes e integraciones — Parcial
- Exportación CSV de errores de carga.
- Pendiente: exportaciones generales de mantenedores/movimientos, integraciones con
  sistemas externos (autenticación, reintentos, conciliación).

## Asistente de IA — No implementado
Fuera de alcance de esta iteración. El diseño de datos (fuentes de indicadores,
trazabilidad de movimientos y documentos) es la base sobre la que se podría construir
sin exponer acceso irrestricto a la base, tal como exige el encargo.
