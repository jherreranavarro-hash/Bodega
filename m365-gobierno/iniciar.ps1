# Instala dependencias, compila el frontend y levanta Gobierno M365 en http://127.0.0.1:4100
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
Push-Location backend; npm install --no-audit --no-fund; Pop-Location
Push-Location frontend; npm install --no-audit --no-fund; npm run build; Pop-Location
Push-Location backend; npx tsx src/server.ts; Pop-Location
