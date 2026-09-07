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

## Fase 4 — Endurecimiento operativo (pendiente)
- Almacenamiento de evidencias en un backend de archivos real (hoy `adjuntos` solo
  guarda una URL).
- Observabilidad (métricas, trazas, alertas de infraestructura).
- Backups automatizados y prueba periódica de restauración (`docs/operacion.md` describe
  el procedimiento manual mínimo; falta automatizarlo).
- Endurecimiento de la carga de archivos (escaneo antivirus, límite de filas por carga,
  cuotas por usuario).
- Panel de administración de roles/permisos en la UI.

## Fase 5 — Asistente de IA (pendiente, fuera de alcance de esta iteración)
El asistente de lenguaje natural descrito en la sección 13 del encargo, con acceso
acotado a los mismos indicadores/documentos ya trazables (incluyendo pronósticos y sus
limitaciones, ya implementados en la fase 3) — nunca con acceso irrestricto a la base ni
ejecución de operaciones sin las aprobaciones del sistema.

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
