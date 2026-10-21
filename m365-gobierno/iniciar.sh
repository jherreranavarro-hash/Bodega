#!/usr/bin/env bash
# Instala dependencias, compila el frontend y levanta Gobierno M365 en http://127.0.0.1:4100
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  echo "Se necesita Node.js 20 o superior (incluye npm): https://nodejs.org/es/download" >&2
  exit 1
fi
[ -f backend/.env ] || cp backend/.env.example backend/.env
(cd backend && npm install --no-audit --no-fund)
(cd frontend && npm install --no-audit --no-fund && npm run build)
cd backend && exec npx tsx src/server.ts
