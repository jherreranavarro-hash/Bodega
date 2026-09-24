#!/usr/bin/env bash
# Instala dependencias, compila el frontend y levanta Gobierno M365 en http://127.0.0.1:4100
set -euo pipefail
cd "$(dirname "$0")"
[ -f backend/.env ] || cp backend/.env.example backend/.env
(cd backend && npm install --no-audit --no-fund)
(cd frontend && npm install --no-audit --no-fund && npm run build)
cd backend && exec npx tsx src/server.ts
