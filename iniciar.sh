#!/usr/bin/env bash
# Levanta todo el sistema (PostgreSQL + backend + frontend) con un solo comando.
# Uso: ./iniciar.sh
set -euo pipefail
set -m  # cada proceso en segundo plano recibe su propio grupo de procesos,
        # así detener.sh puede matar todo el árbol (npm -> tsx/vite y sus hijos).

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RAIZ"

mkdir -p logs .pids

log() { echo "==> $*"; }

# ---------------------------------------------------------------------------
# 1) PostgreSQL: verifica que esté disponible; intenta iniciarlo si no lo está.
# ---------------------------------------------------------------------------
pg_listo() { pg_isready -h localhost -p 5432 >/dev/null 2>&1; }

if ! pg_listo; then
  log "PostgreSQL no responde en localhost:5432, intentando iniciarlo..."
  if command -v service >/dev/null 2>&1; then
    service postgresql start >/dev/null 2>&1 || true
  fi
  if command -v pg_ctlcluster >/dev/null 2>&1 && ! pg_listo; then
    VERSION="$(pg_lsclusters 2>/dev/null | awk 'NR==2{print $1}')"
    [ -n "${VERSION:-}" ] && pg_ctlcluster "$VERSION" main start >/dev/null 2>&1 || true
  fi
  if command -v brew >/dev/null 2>&1 && ! pg_listo; then
    brew services start postgresql >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 15); do
    pg_listo && break
    sleep 1
  done
fi

if ! pg_listo; then
  echo "ERROR: no se pudo iniciar PostgreSQL automáticamente." >&2
  echo "Instálalo/inícialo manualmente y vuelve a ejecutar ./iniciar.sh" >&2
  exit 1
fi
log "PostgreSQL disponible."

# ---------------------------------------------------------------------------
# 2) backend/.env: lo crea desde .env.example si no existe.
# ---------------------------------------------------------------------------
if [ ! -f backend/.env ]; then
  log "Creando backend/.env desde .env.example (datos de desarrollo, no productivos)..."
  cp backend/.env.example backend/.env
fi

DATABASE_URL="$(grep -E '^DATABASE_URL=' backend/.env | sed -E 's/^DATABASE_URL="?([^"]*)"?$/\1/')"
DB_USER="$(echo "$DATABASE_URL" | sed -E 's#postgresql://([^:]+):.*#\1#')"
DB_PASS="$(echo "$DATABASE_URL" | sed -E 's#postgresql://[^:]+:([^@]+)@.*#\1#')"
DB_NAME="$(echo "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"

# ---------------------------------------------------------------------------
# 3) Rol y base de datos: los crea si no existen (mejor esfuerzo, no falla el
#    script si este entorno ya tiene su propia forma de administrar Postgres).
# ---------------------------------------------------------------------------
PSQL="psql -h localhost -U postgres"
if command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  PSQL="sudo -u postgres psql"
fi

if $PSQL -tc "SELECT 1" >/dev/null 2>&1; then
  $PSQL -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1 \
    || { log "Creando rol de base de datos '$DB_USER'..."; $PSQL -c "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASS';" >/dev/null; }
  $PSQL -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1 \
    || { log "Creando base de datos '$DB_NAME'..."; $PSQL -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";" >/dev/null; }
else
  log "Aviso: no pude conectar como superusuario de Postgres para verificar rol/base."
  log "Si backend/.env apunta a un rol/base que ya existe, esto no es un problema."
fi

# ---------------------------------------------------------------------------
# 4) Dependencias, migraciones y datos demo.
# ---------------------------------------------------------------------------
[ -d backend/node_modules ] || { log "Instalando dependencias del backend..."; (cd backend && npm install); }
[ -d frontend/node_modules ] || { log "Instalando dependencias del frontend..."; (cd frontend && npm install); }

log "Aplicando migraciones..."
(cd backend && npx prisma migrate deploy && npx prisma generate)

log "Sembrando datos de demostración (idempotente, seguro repetir)..."
(cd backend && npm run seed)

# ---------------------------------------------------------------------------
# 5) Backend y frontend en segundo plano.
# ---------------------------------------------------------------------------
detener_si_corre() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 0
  local pid; pid="$(cat "$pidfile")"
  # Señal al grupo de procesos completo (PID negativo), no solo al proceso
  # envoltorio: npm/tsx/vite crean procesos hijos que sobreviven si solo se
  # mata el padre.
  kill -TERM -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
  rm -f "$pidfile"
}
detener_si_corre .pids/backend.pid
detener_si_corre .pids/frontend.pid

log "Iniciando backend (API) en http://localhost:4000 ..."
(cd backend && exec npm run dev) > "$RAIZ/logs/backend.log" 2>&1 < /dev/null &
disown
echo $! > "$RAIZ/.pids/backend.pid"

log "Iniciando frontend (UI) en http://localhost:5173 ..."
(cd frontend && exec npx vite --port 5173 --strictPort) > "$RAIZ/logs/frontend.log" 2>&1 < /dev/null &
disown
echo $! > "$RAIZ/.pids/frontend.pid"

log "Esperando a que ambos respondan..."
backend_listo() { curl -s -o /dev/null http://localhost:4000/api/auth/login -X POST -H 'content-type: application/json' -d '{}' ; }
frontend_listo() { curl -s -o /dev/null http://localhost:5173/; }

ok_backend=0; ok_frontend=0
for _ in $(seq 1 30); do
  backend_listo && ok_backend=1
  frontend_listo && ok_frontend=1
  [ "$ok_backend" = 1 ] && [ "$ok_frontend" = 1 ] && break
  sleep 1
done

if [ "$ok_backend" != 1 ]; then
  echo "ERROR: el backend no respondió a tiempo. Revisa logs/backend.log" >&2
  exit 1
fi
if [ "$ok_frontend" != 1 ]; then
  echo "ERROR: el frontend no respondió a tiempo. Revisa logs/frontend.log" >&2
  exit 1
fi

cat <<EOF

============================================================
 Sistema listo.

 Abre:  http://localhost:5173

 Usuarios de demostración (cada uno con su propia contraseña, ver README.md):
   admin@bodegademo.cl          Administrador          ASgSrfXMMQ*3
   jefe.bodega@bodegademo.cl    Jefe de Bodega          TdsdEQRSbg@3
   operador@bodegademo.cl       Operador de Bodega      HTB9GHm7PU=6
   compras@bodegademo.cl        Compras                 WzFucgkvri=7
   solicitante@bodegademo.cl    Solicitante             sAinLEi6d8+5
   aprobador@bodegademo.cl      Aprobador               znNvKKFXhF*4
   auditor@bodegademo.cl        Auditor                 9Dbm4vXQem@3
   gerencia@bodegademo.cl       Gerencia                MNDm8tzvEr*3

 Logs:      logs/backend.log, logs/frontend.log
 Detener:   ./detener.sh
============================================================
EOF
