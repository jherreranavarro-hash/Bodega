#!/usr/bin/env bash
# Detiene el backend y el frontend iniciados por ./iniciar.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RAIZ"

detener() {
  local nombre="$1" pidfile="$2"
  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile")"
    # Mata el grupo de procesos completo (PID negativo): npm/tsx/vite crean
    # procesos hijos que quedan huérfanos y siguen ocupando el puerto si solo
    # se mata el proceso envoltorio.
    if kill -TERM -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1; then
      sleep 1
      kill -KILL -- "-$pid" >/dev/null 2>&1 || true
      echo "==> $nombre detenido (pid $pid)."
    else
      echo "==> $nombre ya no estaba corriendo."
    fi
    rm -f "$pidfile"
  else
    echo "==> $nombre no tenía un proceso registrado."
  fi
}

detener "Backend" .pids/backend.pid
detener "Frontend" .pids/frontend.pid
