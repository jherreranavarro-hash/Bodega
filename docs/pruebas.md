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
✓ tests/alertas.test.ts (6 tests)
✓ tests/cargas.test.ts (4 tests)
✓ tests/preparaciones.test.ts (3 tests)
✓ tests/ajustes.test.ts (1 test)
✓ tests/api.test.ts (3 tests)

Test Files  8 passed (8)
     Tests  33 passed (33)
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
| 14 | Solicitar un pronóstico sin información suficiente | Se informa la limitación, sin precisión inventada | **No implementado** — no existe todavía el módulo de pronósticos (ver `plan-implementacion.md`, fase 5); por lo tanto tampoco existe un endpoint que pudiera inventar una precisión falsa | — |

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

## Evidencia de la aplicación real (no solo servicios)

`frontend/tests/smoke.mjs` (`npm run smoke` desde `frontend/`) automatiza un navegador
real contra el backend y frontend corriendo, y ejercita: login, navegación por los ocho
módulos, creación real de una orden de compra vía formulario, y el flujo completo de
carga de datos (subir CSV → validar y simular → aprobar → ejecutar) verificando el
resultado final en pantalla. Esto confirma que la interfaz no tiene "botones ficticios":
cada acción llama a la API real y persiste en PostgreSQL.
