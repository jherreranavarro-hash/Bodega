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

## Fase 3 — Pendiente explícito de alta prioridad
Estas son las brechas más importantes respecto del alcance completo del encargo
(sección 2). Se documentan aquí en vez de darlas por hechas:

1. **Solicitudes de compra con aprobación propia** antes de convertirse en orden de
   compra (hoy la conversión existe a nivel de datos; falta el flujo de aprobación
   dedicado y su vínculo con las alertas de reposición).
2. **Bandeja de decisiones** (alertas → acción propuesta → aceptar/rechazar/postergar/
   convertir en solicitud, con justificación). Los indicadores que la alimentarían ya
   existen; falta la capa de generación automática de alertas y su UI.
3. **Pronósticos y escenarios de simulación** (`pronosticos`, `escenarios` en el
   modelo): sin cálculo implementado. No se debe mostrar una precisión que no existe —
   por eso no hay ningún endpoint que "invente" un pronóstico todavía.
4. **Script de reconciliación de saldos** contra el historial de movimientos (ver
   `docs/modelo-datos.md` §5).
5. **Manejo de períodos cerrados** y de registros con fecha efectiva atrasada más allá
   de la separación de campos ya existente en el modelo.
6. **Multimoneda real**: el modelo guarda `moneda`/`tipo_cambio` en capas de costo, pero
   no hay conversión ni consolidación multimoneda en los indicadores.

## Fase 4 — Endurecimiento operativo (pendiente)
- Almacenamiento de evidencias en un backend de archivos real (hoy `adjuntos` solo
  guarda una URL).
- Observabilidad (métricas, trazas, alertas de infraestructura).
- Backups automatizados y prueba periódica de restauración (`docs/operacion.md` describe
  el procedimiento manual mínimo; falta automatizarlo).
- Endurecimiento de la carga de archivos (escaneo antivirus, límite de filas por carga,
  cuotas por usuario).
- Panel de administración de roles/permisos en la UI.

## Fase 5 — Analítica avanzada y asistente de IA (pendiente, fuera de alcance de esta
iteración)
Bandeja de decisiones completa, pronósticos con evaluación contra una regla simple,
simulación de escenarios (aumento de demanda, atraso de proveedor, redistribución entre
bodegas), y el asistente de lenguaje natural descrito en la sección 13 del encargo, con
acceso acotado a los mismos indicadores/documentos ya trazables — nunca con acceso
irrestricto a la base ni ejecución de operaciones sin las aprobaciones del sistema.

## Supuestos explícitos tomados (parámetros, no reglas fijas)

| Supuesto | Dónde se configuró | Cómo cambiarlo |
|---|---|---|
| Stock negativo no permitido por defecto | `registrarMovimiento({ permitirNegativo: false })` como default | Parámetro por operación; no hay toggle global todavía — se deja intencionalmente restrictivo |
| Solicitudes de salida y órdenes de compra se crean ya "aprobadas" en esta demo | `solicitudes.routes.ts`, `compras.routes.ts` | Cambiar el estado inicial a `BORRADOR`/`PENDIENTE_APROBACION` y agregar el endpoint de aprobación correspondiente (el estado ya existe en el enum) |
| Conteo ciego oculta `cantidadEsperada` mientras el conteo está `EN_PROCESO` | `ajustes.routes.ts` | Configurable por conteo vía el campo `conteoCiego` |
| Ajuste requiere motivo; evidencia solo si el motivo la exige | `motivos.requiereEvidencia` | Editable por mantenedor de motivos |
| Método de valorización por defecto: promedio ponderado | `Producto.metodoValorizacion` | Editable por producto; **no** hay migración guiada para cambiar el método con inventario existente (queda pendiente, sección 10 del encargo lo exige explícitamente como control) |

No se activó ninguna regla sensible por defecto sin control (stock negativo, aprobación
automática de ajustes, ejecución automática de recomendaciones), conforme exige la
sección 17 del encargo.
