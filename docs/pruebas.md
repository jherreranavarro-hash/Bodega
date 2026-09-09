# Pruebas de aceptación

Todas las pruebas corren contra una instancia real de PostgreSQL (no se usa un mock de
base de datos), ejecutando los mismos servicios de negocio que expone la API. Se
verifica cada caso mínimo pedido en la sección 16 del encargo.

Ejecutar:
```bash
cd backend
npm test
```

Resultado obtenido en este entregable (ejecución reproducible, corrida dos veces
seguidas para confirmar que las pruebas son idempotentes y no dependen de datos
residuales de una corrida anterior):

```
✓ tests/inventario.test.ts (7 tests)
✓ tests/devoluciones.test.ts (4 tests)
✓ tests/solicitudes-compra.test.ts (5 tests)
✓ tests/pronosticos.test.ts (5 tests)
✓ tests/productos.test.ts (4 tests)
✓ tests/cargas.test.ts (6 tests)
✓ tests/alertas.test.ts (6 tests)
✓ tests/reconciliacion.test.ts (3 tests)
✓ tests/preparaciones.test.ts (3 tests)
✓ tests/administracion.test.ts (4 tests)
✓ tests/llegada-productos.test.ts (7 tests)
✓ tests/ajustes.test.ts (1 test)
✓ tests/periodos.test.ts (4 tests)
✓ tests/multimoneda.test.ts (3 tests)
✓ tests/api.test.ts (3 tests)
✓ tests/precios.test.ts (10 tests)
✓ tests/adjuntos.test.ts (4 tests)

Test Files  17 passed (17)
     Tests  79 passed (79)
```

## Trazabilidad caso del encargo → prueba automatizada

| # | Caso (sección 16 del encargo) | Resultado esperado | Prueba | Archivo |
|---|---|---|---|---|
| 1 | Recibir 100 unidades | Existencia física 100 y movimiento vinculado a la recepción | "recibir 100 unidades deja existencia física de 100 con movimiento vinculado" | `tests/inventario.test.ts` |
| 2 | Reservar 20 unidades | Física 100, reserva 20, libre 80 | "reservar 20 y luego despachar 15..." (primera aserción) | `tests/inventario.test.ts` |
| 3 | Despachar 15 de las reservadas | Física 85, reserva pendiente 5, libre 80 | mismo test, aserción final | `tests/inventario.test.ts` |
| 4 | Reservar simultáneamente más stock del disponible | El sistema evita sobrecomprometer | "no permite sobrecomprometer existencias con reservas simultáneas" (2 reservas de 7 sobre 10 unidades, corridas con `Promise.allSettled`) | `tests/inventario.test.ts` |
| 5 | Repetir una importación ya ejecutada | No se duplican registros ni movimientos | "retorna la misma carga y no crea movimientos adicionales" | `tests/cargas.test.ts` |
| 6 | Importar producto/ubicación inexistente en una operación | Se rechaza; no se crea silenciosamente | "rechaza la fila y no crea nada por suposición" | `tests/cargas.test.ts` |
| 7 | Importar cajas con conversión a unidades | Se conserva cantidad original y factor, unidad base correcta | "conserva cantidad original y factor..." (5 cajas × 12 = 60 unidades) | `tests/cargas.test.ts` |
| 8 | Trasladar mercadería entre bodegas | Origen/tránsito/destino conciliados sin duplicar stock | "origen queda sin disponible, mercadería en tránsito..." (incluye verificación de conservación total: `origen + destino = total inicial`) | `tests/inventario.test.ts` |
| 9 | Recibir una compra parcialmente | Se actualiza lo recibido; el saldo pendiente permanece visible | "actualiza lo recibido y mantiene visible el saldo pendiente" | `tests/inventario.test.ts` |
| 10 | Despachar un producto bloqueado o vencido | La operación se impide | "un saldo en estado BLOQUEADO no está disponible para despacho normal" | `tests/inventario.test.ts` |
| 11 | Ajustar una diferencia de inventario | Exige motivo, autorización y evidencia cuando corresponde; no toca stock hasta aprobar | "no modifica stock hasta que el ajuste es aprobado, y exige motivo con evidencia..." | `tests/ajustes.test.ts` |
| 12 | Consultar otra empresa sin permiso | Se deniega en pantalla y en los servicios | "no permite crear una ubicación en una bodega de otra empresa" + "deniega una acción para la que el rol no tiene permiso" | `tests/api.test.ts` |
| 13 | Consultar un indicador | Se puede llegar a los documentos que explican su cálculo | Cubierto indirectamente: cada movimiento queda ligado a su `operacion.documentoOrigen` (recepción/ajuste/carga), verificado en los tests 1, 7 y 11. La navegación visual desde el tablero hasta el documento fuente está pendiente de UI dedicada (ver `plan-implementacion.md`) | `tests/inventario.test.ts`, `tests/ajustes.test.ts` |
| 14 | Solicitar un pronóstico sin información suficiente | Se informa la limitación, sin precisión inventada | "informa la limitación explícitamente, sin inventar una precisión" — sin historia de demanda, `calcularPronostico` retorna `{suficiente: false, mensaje, diasDisponibles, diasRequeridos}` y no persiste ningún `Pronostico` fabricado | `tests/pronosticos.test.ts` |

Adicionalmente se prueba (más allá del mínimo pedido):
- Impide despachar más cantidad que la disponible (existencias negativas).
- Recepción parcial deja el saldo pendiente correctamente calculado en la orden de compra.
- Login rechaza credenciales inválidas.
- **Devoluciones (sección 9 del encargo — "no deben volver automáticamente al stock
  disponible")**: una devolución recién ingresada aumenta el stock físico total pero no
  el utilizable/disponible (`tests/devoluciones.test.ts`); resolverla como `BAJA` exige
  motivo y evidencia cuando el motivo la requiere; resolverla como
  `REINGRESO_DISPONIBLE` sí libera el stock; y quien registró la devolución no puede
  resolverla (separación de funciones).
- **Preparación como paso explícito** (`tests/preparaciones.test.ts`): un despacho que
  referencia una preparación se rechaza si esa preparación no está `LISTA`; no se puede
  marcar `LISTA` con líneas parcialmente verificadas; no se puede verificar más cantidad
  de la solicitada; y una vez lista, el despacho procede normalmente.
- **Solicitudes de compra con aprobación propia** (`tests/solicitudes-compra.test.ts`):
  toda solicitud nace `PENDIENTE_APROBACION`; quien la solicita no puede aprobarla ni
  rechazarla; solo una solicitud `APROBADA` puede convertirse en orden de compra, exige
  costo por línea y no se puede convertir dos veces; y generarla desde la alerta de
  reposición respeta la cantidad mínima de compra y el múltiplo de pedido del producto
  (y se rechaza si el producto no está realmente bajo su punto de reposición).
- **Bandeja de decisiones** (`tests/alertas.test.ts` — sección 12 del encargo): generar
  alertas dos veces seguidas no duplica una alerta ya abierta para el mismo
  producto/bodega; cada alerta trae evidencia consultable y una acción `PROPUESTA`;
  rechazar exige justificación; una acción ya resuelta no puede resolverse de nuevo;
  convertir en solicitud de compra solo aplica a alertas de reposición (se rechaza para
  vencimientos) y deja tanto la acción como la alerta en su estado final correcto.
- **Pronósticos y escenarios** (`tests/pronosticos.test.ts` — sección 11 del encargo,
  además del caso 14 ya listado arriba): con historia suficiente calcula demanda
  estimada y su error frente a una regla simple, declarando limitaciones; registra
  demanda solicitada y atendida del mismo día sin duplicar (una sola fila por
  producto/bodega/día); un escenario simulado muestra sus supuestos, se diferencia de
  los datos reales y **no** altera los parámetros reales de reposición; simular sin
  parámetros de reposición configurados se rechaza.
- **Reconciliación de saldos** (`tests/reconciliacion.test.ts` — sección 4 del encargo,
  "el saldo... debe poder reconstruirse y conciliarse"): sin diferencias tras un
  recorrido normal de recepción/reserva/despacho y tras una transferencia completa
  (incluyendo el estado intermedio en tránsito); detecta una alteración manual directa
  de `saldos_inventario` que no pasó por el motor de movimientos, reportando el valor
  calculado, el registrado y la diferencia exacta.
- **Períodos cerrados** (`tests/periodos.test.ts`): rechaza una operación con fecha
  efectiva dentro de un período cerrado; permite fechas posteriores al cierre; no
  permite retroceder un cierre ya establecido; sin fecha de cierre configurada, no
  restringe ninguna fecha (comportamiento por defecto, sin activar una regla sensible
  sin que se le pida).
- **Multimoneda en recepciones** (`tests/multimoneda.test.ts` — sección 10 del
  encargo): exige tipo de cambio si la moneda de la línea difiere de la moneda de la
  empresa; convierte el costo a la moneda base para la capa de costo y el movimiento,
  conservando el costo tal como fue facturado en el documento de recepción, y guardando
  moneda original y tipo de cambio en la capa de costo; sin moneda indicada, asume la
  moneda de la empresa sin exigir tipo de cambio.
- **Límite de filas del centro de cargas** (`tests/cargas.test.ts`): un archivo con más
  filas que `MAXIMO_FILAS_POR_CARGA` se rechaza antes de crear la carga.
- **Reintento tras una carga RECHAZADA** (`tests/cargas.test.ts`): subir el mismo archivo
  después de que su ejecución se revirtió (`RECHAZADA`, p. ej. por un timeout de
  transacción) crea una carga nueva desde cero — nunca devuelve la carga rota bajo la
  misma clave de idempotencia — y el reintento completa el flujo (validar, aprobar,
  ejecutar) normalmente.
- **Adjuntos en disco** (`tests/adjuntos.test.ts`): guarda el archivo real y permite
  leerlo de vuelta con el mismo contenido; rechaza una extensión no permitida; rechaza
  un archivo que excede el tamaño máximo; eliminar el adjunto borra también el archivo
  del disco.
- **Administración de roles y permisos** (`tests/administracion.test.ts`): otorgar y
  revocar un permiso de un rol se refleja de inmediato en lo que ese rol puede hacer;
  un administrador puede cambiar el rol de un usuario de su misma empresa; no puede
  cambiar el rol de un usuario de otra empresa (404); un rol sin el permiso
  `administracion.consultar` recibe 403 al listar roles.
- **Llegada de productos vía centro de cargas** (`tests/llegada-productos.test.ts`):
  crea el producto, la fila de llegada, el movimiento de inventario y el valor de
  referencia del precio cuando `cantidad_enviada > 0`; con `cantidad_enviada = 0` deja
  la llegada registrada pero sin movimiento; al llegar un producto ya existente
  actualiza sus datos de origen (grupo, código ML) sin sobrescribir el nombre curado;
  rechaza un producto nuevo sin título; exige la bodega de destino antes de aceptar el
  archivo; acepta el mismo contenido en formato `.xlsx` con los encabezados reales en
  español (Grupo, Código, Código ML, etc.), probando que la normalización de
  encabezados funciona igual que con CSV; y —caso encontrado con un archivo real de
  liquidación de 619 filas— un mismo `Código` con distinto `Código ML` crea dos
  productos separados en vez de mezclar sus datos.
- **Catálogo de productos** (`tests/productos.test.ts`): el listado expone en
  `ultimaLlegada` los campos de la llegada más reciente (no de la primera, si un
  producto tuvo varias); filtrar por grupo/condición usa solo la última llegada, no
  cualquier llegada histórica del producto; un producto sin llegadas nunca aparece bajo
  un filtro de llegada y su `ultimaLlegada` queda `null`; `GET /productos/filtros/
  llegada` retorna los valores distintos realmente declarados en las llegadas de la
  empresa.
- **Precios de venta** (`tests/precios.test.ts`): modo fijo calcula exactamente el
  precio indicado; modo porcentaje calcula sobre el valor de referencia de la última
  llegada; sin valor de referencia todavía, el precio calculado queda vacío (nunca
  inventa una cifra); una llegada posterior recalcula el precio automáticamente si el
  modo es porcentaje; rechaza guardar sin el dato requerido según el modo; rechaza
  actualizar el precio de un producto de otra empresa; IVA (19%) afecto por defecto
  suma el 19% al precio neto; un producto marcado no afecto a IVA no le suma nada;
  cambiar solo el margen/precio fijo conserva la opción de IVA elegida previamente
  para ese producto.

## Evidencia de la aplicación real (no solo servicios)

`frontend/tests/smoke.mjs` (`npm run smoke` desde `frontend/`, con backend y frontend
corriendo) automatiza un navegador real de punta a punta, sin ningún paso manual fuera
de la UI: login; detectar una alerta real en el Centro de Decisiones y convertirla en
solicitud de compra; navegación por los mantenedores; registrar una recepción real vía
formulario (la base de stock para el resto del recorrido); registrar una solicitud de
compra (queda pendiente de aprobación); el flujo completo solicitud → reserva →
preparación → verificación → despacho; registrar una devolución y verificar que no
queda disponible; crear una orden de compra; el flujo completo de carga de datos (subir
CSV → validar y simular → aprobar → ejecutar); calcular un pronóstico (declara datos
insuficientes) y simular un escenario real; en Administración, otorgar/revocar un
permiso real de un rol y confirmar que la casilla cambia de estado tras la llamada al
servidor; y subir una llegada de productos real (CSV con encabezados en español) por el
centro de cargas, validarla/aprobarla/ejecutarla, confirmar que el producto nuevo
aparece en el mantenedor de Productos, y en Precios de Venta configurar un margen
porcentual y verificar que el precio calculado sale del valor real declarado en el
archivo (no de una cifra arbitraria). Esto confirma que la interfaz no tiene "botones
ficticios": cada acción llama a la API real y persiste en PostgreSQL.
