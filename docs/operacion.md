# Operación diaria, inventario físico y recuperación ante fallas

## Configuración por empresa

Editables vía el mantenedor de `parametros` (tabla `parametros`, clave/valor por
empresa) o directamente en el modelo `Empresa` (moneda, zona horaria). En este
entregable no hay una pantalla de administración de parámetros — se gestionan por
API/seed; queda como pendiente de UI (ver `plan-implementacion.md`).

Parámetros sensibles que el sistema **nunca** activa por defecto:
- Permitir stock negativo (`registrarMovimiento({ permitirNegativo: false })` — hay que
  pasarlo explícitamente en cada llamada, no hay interruptor global).
- Aprobación automática de ajustes o cargas de datos.

## Orden de poblamiento inicial recomendado

1. Empresa → sucursales → bodegas → ubicaciones (mantenedores o seed).
2. Catálogos: unidades de medida, categorías, marcas.
3. Productos y sus conversiones de unidad.
4. Proveedores (y `productos_proveedores` si se requiere costo de referencia/plazo).
5. Lotes/series (se crean automáticamente al recibir o al cargar inventario inicial que
   los referencia; no requieren alta manual previa).
6. Carga de inventario inicial (Centro de Cargas, entidad `INVENTARIO_INICIAL`) — queda
   registrada como una operación `APERTURA_INICIAL` trazable, nunca como edición directa
   de `saldos_inventario`.
7. Documentos abiertos (órdenes de compra pendientes, solicitudes de salida en curso):
   cargarlos **después** de la apertura, y no volver a sumar en la apertura cantidades
   que esos documentos vayan a generar al recibirse/despacharse — evita duplicar
   compromisos. Esta reconciliación hoy es responsabilidad de quien prepara el archivo
   de apertura; un asistente guiado de conciliación queda pendiente.

## Inventario físico (conteo)

1. Planificar el conteo (`POST /api/conteos`): congela `cantidad_esperada` desde el
   saldo vigente en ese momento, por línea producto+ubicación.
2. Si es conteo ciego (`conteoCiego=true`, valor por defecto), la API oculta
   `cantidad_esperada` mientras el conteo está `EN_PROCESO`.
3. Registrar la cantidad contada por línea (`POST /api/conteos/detalle/:id/registrar`).
4. Generar el ajuste desde las diferencias (`POST /api/ajustes/desde-conteo`): exige un
   motivo, y evidencia si el motivo la requiere. Si no hay diferencias, el conteo pasa
   directo a `APROBADO` sin generar ajuste.
5. Aprobar el ajuste (`POST /api/ajustes/:id/aprobar`) — con un usuario **distinto** de
   quien lo solicitó. Solo en este paso se genera el movimiento de inventario.

El sistema no bloquea automáticamente los movimientos de la bodega mientras dura un
conteo (queda como control operativo/pendiente de automatizar); se recomienda
restringir operativamente los movimientos de las ubicaciones en conteo mientras se
implementa ese control.

## Respaldo y restauración (procedimiento mínimo para este entregable)

Dado que la fuente de verdad es PostgreSQL:

```bash
# Respaldo
pg_dump -Fc -d bodega -U bodega -f bodega_$(date +%Y%m%d_%H%M).dump

# Restauración (a una base nueva, para no pisar la existente por error)
createdb bodega_restaurada -O bodega
pg_restore -d bodega_restaurada -U bodega bodega_$(date +%Y%m%d_%H%M).dump
```

Prueba de restauración realizada en este entorno de desarrollo: se ejecutó
`npx prisma migrate reset --force` (que recrea el esquema desde las migraciones y
vuelve a poblar los datos de demostración vía `npm run seed`) como verificación de que
el esquema es reproducible de punta a punta desde cero. Un ensayo periódico de
`pg_dump`/`pg_restore` contra un entorno productivo real, con verificación de integridad
post-restauración, **queda pendiente de automatizar** (fase 4 del plan de
implementación) — no se afirma tener un procedimiento productivo probado, solo el de
desarrollo descrito arriba.

## Qué hacer ante un incidente de datos

- **Saldo sospechoso de estar mal**: nunca editarlo a mano. Reconstruir sumando
  `movimientos_inventario` para esa combinación producto/ubicación/lote/serie/estado
  (ver `docs/modelo-datos.md` §5) y comparar contra `saldos_inventario`; si difieren, es
  un bug del motor de inventario y debe corregirse ahí, no parchando el dato.
- **Carga de datos a medio ejecutar tras una caída del servidor**: la ejecución ocurre
  dentro de una transacción de Prisma (`$transaction`); si el proceso muere a mitad de
  camino, PostgreSQL revierte la transacción completa y la carga queda en estado
  `EJECUTANDO`. Hay que revisar manualmente ese caso y, si corresponde, volver a
  aprobarla/ejecutarla (la reclamación atómica por estado evita procesarla dos veces si
  en realidad sí terminó). Una recuperación automática de cargas colgadas en
  `EJECUTANDO` queda pendiente.
