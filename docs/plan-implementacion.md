# Plan de implementación

## Fase 0 — Diseño (completada en este entregable)
Arquitectura, mapa de módulos, modelo de datos conceptual/lógico/físico con scripts de
migración ejecutables. Ver `docs/arquitectura.md` y `docs/modelo-datos.md`.

## Fase 1 — Núcleo transaccional de punta a punta (completada en este entregable)
Orden seguido, tal como exige la sección 17 del encargo:

1. Mantenedores mínimos (empresa, bodega, ubicaciones, unidades, productos, proveedores).
2. Centro de cargas de datos con validación/simulación/aprobación/ejecución (entidades
   PRODUCTOS e INVENTARIO_INICIAL).
3. Compra → recepción (total/parcial) → saldo actualizado.
4. Solicitud → reserva (con control de concurrencia) → despacho (consume la reserva en
   la misma transacción).
5. Indicador de disponibilidad (stock físico/utilizable/reservado/libre) accesible desde
   el tablero, con capacidad de rastrear hasta el movimiento que lo explica.

Criterio de aceptación: los 15 casos de `docs/pruebas.md` pasan contra PostgreSQL real
(`cd backend && npm test`), y el recorrido completo funciona en la aplicación real
(`cd frontend && npm run smoke`), no en una maqueta.

## Fase 2 — Operaciones complementarias (completada en este entregable)
Transferencias entre bodegas (sin doble conteo), conteos cíclicos/generales con ajuste
aprobado por un usuario distinto de quien lo solicitó, valorización FIFO además de
promedio ponderado, indicadores de reposición/sobrestock/vencimientos/exactitud.

## Fase 2.1 — Devoluciones y excepciones (completada en esta iteración)
Flujo devolución → inspección → resolución implementado (`modules/devoluciones`): el
ingreso siempre pasa por una ubicación de cuarentena por bodega (nunca aumenta el stock
disponible automáticamente); la resolución admite reingreso a disponible, permanencia en
cuarentena o baja definitiva (esta última con motivo y evidencia obligatorios cuando el
motivo lo exige); separación de funciones entre quien registra y quien resuelve. Cubierto
por 4 pruebas de aceptación (`tests/devoluciones.test.ts`) y por el smoke test de UI.

## Fase 2.2 — Preparación como paso explícito (completada en esta iteración)
Lista de preparación generada desde una solicitud de salida, con verificación línea a
línea (sin exceder lo solicitado) y transición explícita a `LISTA`. El despacho rechaza
—a nivel de servicio, no solo de UI— referenciar una preparación que no esté `LISTA`
(`modules/despachos/despacho.service.ts`). La preparación es opcional: un despacho
directo desde la reserva sigue funcionando quien no la necesite. Cubierto por 3 pruebas
(`tests/preparaciones.test.ts`) y por el smoke test de UI (flujo completo solicitud →
reserva → preparación → verificación → despacho).

## Fase 2.3 — Solicitudes de compra con aprobación propia (completada en esta iteración)
Las solicitudes de compra nacen siempre `PENDIENTE_APROBACION` (nunca ya aprobadas); la
aprobación y el rechazo exigen un usuario distinto de quien solicitó. Se puede generar
una solicitud directamente desde la alerta de bajo punto de reposición de un
producto/bodega (`POST /api/compras/solicitudes/desde-reposicion`), respetando la
cantidad mínima de compra y el múltiplo de pedido del producto, y rechazando la
generación si el producto no está realmente bajo su punto de reposición. Solo una
solicitud `APROBADA` puede convertirse en orden de compra, exigiendo costo pactado por
línea y sin permitir convertirla dos veces. Cubierto por 5 pruebas
(`tests/solicitudes-compra.test.ts`) y por el smoke test de UI.

## Fase 2.4 — Bandeja de decisiones (completada en esta iteración)
`POST /api/alertas/generar` detecta condiciones de alerta a partir de los indicadores
de reposición, sobrestock y vencimientos próximos, sin duplicar alertas ya abiertas para
la misma entidad. Cada alerta trae la evidencia numérica y una acción recomendada
explícita, con severidad calculada. Cada acción se acepta, rechaza (exige
justificación), posterga (con nueva fecha objetivo), o —solo para reposición— se
convierte en una solicitud de compra real que nace igualmente pendiente de aprobación.
Ninguna acción ejecuta una compra, baja, transferencia o ajuste por sí sola: siempre
desemboca en el paso ya controlado y auditado del flujo correspondiente. La generación
es a pedido (botón "Detectar alertas ahora"), no una tarea programada. Cubierto por 6
pruebas (`tests/alertas.test.ts`) y por el smoke test de UI (detectar → convertir en
solicitud).

## Fase 3 — Pronósticos, integridad de datos y multimoneda (completada en esta iteración)
Las cuatro brechas de alta prioridad detectadas tras la fase 2 quedaron resueltas:

1. **Pronósticos y escenarios de simulación** (`modules/analitica`): demanda real
   acumulada por día desde solicitudes y despachos (nunca inferida del saldo);
   pronóstico por promedio móvil que exige un mínimo de historia y declara la
   insuficiencia explícitamente en vez de inventar una cifra (caso de aceptación 14 del
   encargo), con *backtesting* contra una regla simple sobre el propio historial y
   limitaciones siempre expuestas. Simulación de escenarios (demanda, plazo de
   proveedor, stock de seguridad) que nunca toca los parámetros reales y siempre se
   etiqueta como simulación. 5 pruebas (`tests/pronosticos.test.ts`).
2. **Reconciliación de saldos** (`modules/inventario/reconciliacion.service.ts`,
   `GET /api/indicadores/reconciliacion`, `npm run reconciliar` como script de línea de
   comandos): reconstruye cada saldo desde `movimientos_inventario` — incluyendo el
   caso de un movimiento con estados distintos en origen y destino, como una
   transferencia, que ahora se registra con `estado_inventario_origen` propio además de
   `estado_inventario` (migración `20260907190000_movimiento_estado_origen`) — y
   reporta cualquier desviación frente a `saldos_inventario`. 3 pruebas, incluyendo una
   que fuerza una alteración manual de la base y confirma que se detecta
   (`tests/reconciliacion.test.ts`).
3. **Períodos cerrados** (`modules/inventario/periodos.service.ts`,
   `GET/PUT /api/parametros/periodo-cierre`): toda operación de inventario pasa por
   `crearOperacion`, que rechaza una fecha efectiva igual o anterior al cierre
   configurado salvo autorización explícita (que ningún flujo activa por sí solo); el
   cierre no se puede retroceder. 4 pruebas (`tests/periodos.test.ts`).
4. **Multimoneda en recepciones** (`recepcion.service.ts`): una línea puede facturarse
   en una moneda distinta a la de la empresa con su tipo de cambio; el documento
   conserva el costo tal como fue facturado, mientras que el movimiento y la capa de
   costo quedan valorizados en la moneda base, guardando moneda original y tipo de
   cambio para trazabilidad (sección 10 del encargo); sin tipo de cambio y con moneda
   distinta, se rechaza explícitamente. 3 pruebas (`tests/multimoneda.test.ts`). La
   consolidación multimoneda en tableros/reportes queda pendiente (fase 4) — hoy no
   mezcla monedas porque todo se convierte a la moneda base desde el ingreso, pero no
   hay una vista en una moneda de reporte distinta a la base.

## Fase 4 — Endurecimiento operativo (parcialmente completada en esta iteración)

Completado:

1. **Límite de filas por carga** (`modules/cargas/carga.service.ts`): `recibirArchivo`
   rechaza explícitamente un archivo con más de 5000 filas (`MAXIMO_FILAS_POR_CARGA`)
   antes de simularlo o ejecutarlo, para que una carga mal formada no pueda saturar el
   proceso de validación. Cubierto en `tests/cargas.test.ts`.
2. **Almacenamiento real de evidencias** (`modules/adjuntos`): API genérica de adjuntos
   (`entidad` + `entidadId`) que ahora guarda el archivo real en disco
   (`backend/storage/adjuntos/`, fuera del árbol servido estáticamente y excluido de git),
   con un nombre de archivo aleatorio (UUID) que nunca se expone al cliente — la descarga
   siempre pasa por `GET /api/adjuntos/:id/descargar`, una ruta autenticada que resuelve
   el archivo real a partir del registro en base de datos, nunca por una ruta de archivo
   entregada por el cliente. Extensión restringida a `.jpg/.jpeg/.png/.pdf/.webp` y tamaño
   máximo de 10 MB. Cubierto por 4 pruebas (`tests/adjuntos.test.ts`). **Pendiente**:
   conectar esta API genérica con los campos `evidenciaUrl` propios de ajustes,
   devoluciones y despachos (hoy siguen siendo un campo de texto independiente,
   sin pasar por este módulo) — ver notas puntuales en `docs/modulos.md`.
3. **Panel de administración de roles y permisos en la UI** (`modules/administracion`,
   pantalla "Administración"): matriz de permisos por rol (otorgar/revocar con un clic,
   verificado siempre en el servidor) y cambio de rol de un usuario, restringido a
   usuarios de la misma empresa (`PUT /api/administracion/usuarios/:id/rol` responde 404
   si el usuario pertenece a otra empresa). El rol `administrador` no se puede editar
   desde la matriz (siempre tiene todos los permisos). **Nota de diseño importante**:
   roles y permisos son hoy un catálogo global compartido entre todas las empresas, no
   uno por empresa — editar los permisos de un rol aquí afecta a ese rol para **todas**
   las empresas que lo usan. Es una simplificación deliberada de esta iteración, no un
   error; separar el catálogo por empresa (o clonar el rol al editarlo) queda como mejora
   futura si se necesitan permisos distintos por empresa. Cubierto por 4 pruebas
   (`tests/administracion.test.ts`) y por el smoke test de UI (otorgar y revocar un
   permiso real y confirmar que la casilla cambia de estado).

Pendiente (requiere infraestructura externa a este entorno de desarrollo, no se debe
activar sin decidirlo con el equipo de operaciones):

- Observabilidad (métricas, trazas, alertas de infraestructura).
- Backups automatizados y prueba periódica de restauración (`docs/operacion.md` describe
  el procedimiento manual mínimo; falta automatizarlo con un orquestador/cron real).
- Escaneo antivirus de archivos subidos (cargas y adjuntos) — hoy el control es solo
  extensión permitida + tamaño máximo, sin inspección de contenido malicioso.

## Fase 5 — Asistente de IA (pendiente, fuera de alcance de esta iteración)
El asistente de lenguaje natural descrito en la sección 13 del encargo, con acceso
acotado a los mismos indicadores/documentos ya trazables (incluyendo pronósticos y sus
limitaciones, ya implementados en la fase 3) — nunca con acceso irrestricto a la base ni
ejecución de operaciones sin las aprobaciones del sistema.

## Fase 6 — Llegada de productos (Mercado Libre / liquidación) y precios de venta

A pedido explícito: una interfaz de carga en Excel para la llegada de mercadería
(columnas Grupo, Código, Código ML, Código original, Título, Condición, Status, Sub
Status, Grade, Cantidad solicitada/colectada/enviada, Peso, Valor, Valor en USD), con el
objetivo declarado de poder fijar el precio de venta de cada producto en pesos o como
porcentaje de margen.

1. **Soporte de archivos Excel (.xlsx) en el centro de cargas** (`modules/cargas`): antes
   solo se aceptaba CSV. Ahora ambos formatos comparten el mismo parser; los
   encabezados se normalizan a snake_case ASCII (sin tildes, minúsculas, espacios a
   `_`), de modo que un archivo con las columnas reales de Mercado Libre no necesita
   editarse antes de subirlo. Este era un pendiente ya documentado en fases anteriores.
2. **Nueva entidad de carga `LLEGADA_PRODUCTOS`**: cada fila puede crear o actualizar el
   producto (a diferencia de `INVENTARIO_INICIAL`, aquí sí se espera mercadería nueva) y,
   si trae cantidad enviada, registra una recepción real. Nunca se marca una fila como
   "sin cambio": cada fila es un evento de llegada distinto, incluso si el producto ya
   existía. Detalle completo en `docs/centro-de-cargas.md`.
3. **Mantenedor de precios de venta** (`modules/precios`, pantalla "Precios de Venta"):
   precio fijo en pesos o porcentaje de margen sobre el valor declarado en la llegada
   más reciente del producto, con el precio calculado siempre persistido (nunca
   recomputado silenciosamente en el momento de leer, para poder auditar qué precio
   estuvo vigente).

Decisiones tomadas explícitamente (confirmadas con el usuario antes de tocar el modelo
de datos):

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Los productos de esta carga son el mismo catálogo (`Producto`), no uno aparte | Catálogo independiente de mercadería ML | El usuario lo pidió así explícitamente: se integra con inventario, bodegas y el resto del sistema |
| `cantidad_enviada` genera una recepción real de inventario; `cantidad_solicitada`/`cantidad_colectada` son solo informativas | Que ninguna cantidad afecte stock | El usuario confirmó que "cantidad enviada = ingreso real a bodega" |
| El porcentaje de margen se aplica sobre el `valor`/`valor_en_usd` del Excel (el valor de referencia más reciente) | Aplicarlo sobre otro campo de costo del sistema | Confirmado por el usuario como la base del cálculo |
| `Valor` (sin USD) se interpreta como pesos chilenos (CLP) | Otra moneda | Confirmado por el usuario |
| El código interno del producto es `Código` + `Código ML` combinados (`"<codigo>::<codigo_ml>"`), no `Código` solo | Usar `Código` solo como código de producto | Verificado con un archivo real de 619 filas: el mismo `Código` se repite hasta 7 veces con título/peso/valor completamente distintos (ej. `1141840600-50` cubre un vaso térmico, un mate y otro mate, todos productos distintos) — `Código` por sí solo habría mezclado productos no relacionados bajo un mismo registro. `Código`+`Código ML` juntos sí fueron 100% únicos en ese archivo. Confirmado por el usuario: "cada fila es su propia unidad/producto". |

Supuestos adicionales, no confirmados explícitamente por tratarse de detalles de
implementación no cubiertos en las preguntas anteriores — documentados aquí en vez de
asumidos en silencio:

- **`Valor` es un valor unitario**, no el total de la línea — mismo criterio que
  `costo_unitario` en el resto del sistema (`INVENTARIO_INICIAL`, recepciones de
  compra). Si en la práctica el Excel trae un valor total, hay que dividirlo por la
  cantidad antes de cargarlo, o pedir que se ajuste este supuesto.
- **Unidad de medida por defecto al crear un producto nuevo**: `UN` (Unidad). El Excel
  no trae unidad de medida; si no existe una unidad con código `UN` en la empresa, la
  fila se rechaza con un mensaje explícito en vez de inventar una unidad.
- **El título de la llegada no sobrescribe el nombre de un producto ya existente**: solo
  se usa como `Producto.nombre` al crear el producto por primera vez. En llegadas
  posteriores del mismo producto, el título se guarda como snapshot informativo
  (`LlegadaProducto.tituloOriginal`) pero el nombre curado del producto no se toca —
  para no dejar que un título ruidoso de una publicación reemplace un nombre ya
  ordenado por el equipo.
- **`Código ML` no es único** (ni siquiera dentro de un mismo `Código`): una misma
  publicación de Mercado Libre agrupa varias unidades físicas distintas. `Producto` lo
  guarda indexado, pero no como restricción `UNIQUE`.
- **Los valores numéricos admiten formato moneda simple** (`"$ 0"`, con símbolo y
  espacio, tal como los exporta Mercado Libre): se les quita el símbolo `$` y los
  espacios antes de convertir a número. **No** se interpretan separadores de miles —
  un valor como `"1.234"` se lee tal cual (mil doscientos treinta y cuatro), nunca como
  `1,234` en formato anglosajón ni se reinterpreta como `1234` en formato chileno,
  para no repetir el bug real que esto causó al confundir `"16.5"` con `"165"`.
- **Las mercancías llegan directamente a estado `DISPONIBLE`** (no a cuarentena, a
  diferencia de las devoluciones): se asumió que la llegada de mercadería para la venta
  no necesita inspección previa, dado que el objetivo declarado es "poder poner los
  precios de venta". Si en la práctica se necesita revisión antes de habilitar la venta,
  este es el punto exacto a cambiar (bastaría con usar la ubicación técnica de
  cuarentena en vez de la de recepción).
- **La bodega de destino es un único valor por carga completa**, no por fila — el Excel
  no trae una columna de bodega. Si en la práctica llegan productos a distintas bodegas
  en un mismo archivo, hay que subir un archivo por bodega, o el archivo se debe
  extender con una columna de bodega (cambio de plantilla, no solo de código).
- **`compras`** es el rol al que se le otorgó el permiso completo sobre `cargas.*` y
  `precios.*` (antes no tenía acceso a cargas en absoluto) — es la mejor aproximación
  disponible al "equipo comercial" que gestionaría este flujo; ajustar en
  `backend/prisma/seed.ts` si corresponde a otro rol en la operación real.

## Supuestos explícitos tomados (parámetros, no reglas fijas)

| Supuesto | Dónde se configuró | Cómo cambiarlo |
|---|---|---|
| Stock negativo no permitido por defecto | `registrarMovimiento({ permitirNegativo: false })` como default | Parámetro por operación; no hay toggle global todavía — se deja intencionalmente restrictivo |
| Solicitudes de salida y órdenes de compra creadas directamente (sin pasar por una solicitud de compra) nacen ya "aprobadas" en esta demo | `salidas.routes.ts`, `compras.routes.ts` (endpoint `POST /ordenes`) | Cambiar el estado inicial a `BORRADOR`/`PENDIENTE_APROBACION` y agregar el endpoint de aprobación correspondiente (el estado ya existe en el enum). Nótese que las **solicitudes de compra** (`POST /solicitudes`) ya nacen `PENDIENTE_APROBACION` desde la fase 2.3 — este supuesto solo aplica a los dos casos indicados |
| Ningún flujo pasa `permitirPeriodoCerrado` | `crearOperacion` (`inventario.service.ts`) | Se deja así intencionalmente: reabrir un período cerrado debe ser una decisión explícita de un flujo de corrección futuro, no un parámetro que cualquier operación pueda activar |
| Conteo ciego oculta `cantidadEsperada` mientras el conteo está `EN_PROCESO` | `ajustes.routes.ts` | Configurable por conteo vía el campo `conteoCiego` |
| Ajuste requiere motivo; evidencia solo si el motivo la exige | `motivos.requiereEvidencia` | Editable por mantenedor de motivos |
| Método de valorización por defecto: promedio ponderado | `Producto.metodoValorizacion` | Editable por producto; **no** hay migración guiada para cambiar el método con inventario existente (queda pendiente, sección 10 del encargo lo exige explícitamente como control) |

No se activó ninguna regla sensible por defecto sin control (stock negativo, aprobación
automática de ajustes, ejecución automática de recomendaciones), conforme exige la
sección 17 del encargo.
