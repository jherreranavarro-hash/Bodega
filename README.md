# Bodega Demo — Sistema Integral de Bodega, Inventario y Toma de Decisiones

Sistema modular de administración de bodegas e inventario: mantenedores, centro de
cargas de datos, compras (con solicitud y aprobación propia), recepción (multimoneda),
reservas, preparación, despacho, transferencias, devoluciones, conteos/ajustes,
indicadores, bandeja de decisiones con alertas automáticas, y pronósticos/escenarios de
simulación — con persistencia real en PostgreSQL, control de acceso por rol/empresa/
bodega, períodos contables cerrados, reconciliación de saldos, trazabilidad completa y
pruebas automatizadas.

Este repositorio es una **implementación funcional**, no una maqueta. Lee
`docs/plan-implementacion.md` para ver qué está completo y qué queda pendiente de forma
explícita (el asistente de IA en lenguaje natural de la sección 13 del encargo queda
fuera de alcance). El desarrollo se priorizó según la sección 17 del encargo ("primero
arquitectura y modelo, luego una operación completa de principio a fin"), ampliando
luego módulo por módulo con pruebas reales en cada paso.

## Estructura del repositorio

```
backend/    API REST (Node.js + TypeScript + Express + Prisma + PostgreSQL)
frontend/   Aplicación web (React + TypeScript + Vite), interfaz en español
docs/       Diseño funcional, modelo de datos, módulos, plan de implementación, pruebas
plantillas/ Plantillas y archivos de ejemplo para el centro de cargas de datos
```

## Requisitos

- Node.js 20+
- PostgreSQL 14+ (probado con 16)

## Puesta en marcha automática (recomendado)

Un solo paso deja todo arriba: instala Node.js/PostgreSQL si faltan (usando `winget` en
Windows), crea el rol y la base de datos si no existen, instala dependencias, aplica
migraciones, siembra los datos de demostración, levanta backend y frontend, y abre el
navegador en la aplicación.

**Windows**: haz doble clic en `iniciar.bat` (o ejecútalo desde una consola). La primera
vez te pedirá la contraseña del superusuario `postgres` para poder crear el rol/base de
datos de la aplicación — si PostgreSQL ya estaba instalado y configurado con ese rol y
esa base, puedes dejarlo en blanco (Enter) y continúa igual. Para detener todo:
`detener.bat`.

**macOS / Linux**:

```bash
./iniciar.sh
```

Para detener:

```bash
./detener.sh
```

En ambos casos, al terminar se muestra la URL (`http://localhost:5173`) y las
credenciales de demostración. Es seguro volver a ejecutarlo (todos los pasos son
idempotentes). Los logs quedan en `logs/backend.log` y `logs/frontend.log`.

## Puesta en marcha manual (paso a paso, para entender o personalizar cada parte)

```bash
# 1) Base de datos
createuser bodega --pwprompt   # o ajusta backend/.env a tu propio usuario/clave
createdb bodega -O bodega

# 2) Backend
cd backend
cp .env.example .env   # ajusta DATABASE_URL y JWT_SECRET
npm install
npm run prisma:migrate   # crea el esquema completo
npm run seed              # datos demo: empresa, bodegas, productos, usuarios, plantillas
npm run dev                # API en http://localhost:4000

# 3) Frontend (en otra terminal)
cd frontend
npm install
npm run dev                # UI en http://localhost:5173 (proxy /api -> :4000)
```

### Usuarios de demostración

Todos con contraseña `Demo1234!` (cámbiala antes de cualquier uso real):

| Correo | Rol |
|---|---|
| admin@bodegademo.cl | Administrador |
| jefe.bodega@bodegademo.cl | Jefe de Bodega |
| operador@bodegademo.cl | Operador de Bodega |
| compras@bodegademo.cl | Compras |
| solicitante@bodegademo.cl | Solicitante |
| aprobador@bodegademo.cl | Aprobador |
| auditor@bodegademo.cl | Auditor |
| gerencia@bodegademo.cl | Gerencia |

Estos datos de demostración están claramente separados del esquema productivo: viven
en `prisma/seed.ts` y se identifican con el RUT `RUT-*`/`76.123.456-7` y códigos
`PROD-00x`, `BOD-*`. Nunca se ejecutan automáticamente en un despliegue productivo
(no forman parte de `prisma migrate deploy`).

## Pruebas

```bash
cd backend
npm test         # 57 pruebas de aceptación contra PostgreSQL real (ver docs/pruebas.md)
npm run reconciliar -- 76.123.456-7   # concilia saldos vs. movimientos (RUT de la empresa demo)

cd frontend
npm run smoke    # recorrido end-to-end real en navegador (requiere backend+frontend arriba)
```

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md) — diseño funcional y arquitectura técnica
- [`docs/modelo-datos.md`](docs/modelo-datos.md) — modelo conceptual/lógico/físico, ERD, diccionario de datos
- [`docs/modulos.md`](docs/modulos.md) — alcance de cada módulo: implementado, parcial, pendiente
- [`docs/plan-implementacion.md`](docs/plan-implementacion.md) — fases, prioridades, supuestos, pendientes explícitos
- [`docs/pruebas.md`](docs/pruebas.md) — casos de aceptación y evidencia de ejecución
- [`docs/centro-de-cargas.md`](docs/centro-de-cargas.md) — plantillas, validaciones y flujo de importación
- [`docs/operacion.md`](docs/operacion.md) — guía de operación diaria, inventario físico y recuperación ante fallas
