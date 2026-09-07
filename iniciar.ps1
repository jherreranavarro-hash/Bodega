#requires -version 5.1
<#
  Levanta todo el sistema (PostgreSQL + backend + frontend) con un solo paso.
  Pensado para ejecutarse via iniciar.bat (doble clic) en Windows.
#>

$ErrorActionPreference = "Stop"
$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Raiz

function Log($msg) { Write-Host "==> $msg" }
function Falla($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Actualizar-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ---------------------------------------------------------------------------
# 1) Node.js: lo instala con winget si no está.
# ---------------------------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Log "Node.js no encontrado. Intentando instalar con winget..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Actualizar-Path
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Falla "No se pudo instalar Node.js automáticamente. Instálalo manualmente (version 20 o superior) desde https://nodejs.org y vuelve a ejecutar iniciar.bat"
  }
}
Log "Node.js disponible: $(node --version)"

# ---------------------------------------------------------------------------
# 2) PostgreSQL: lo instala con winget si no está, y arranca el servicio.
# ---------------------------------------------------------------------------
function Buscar-BinarioPg($nombre) {
  $cmd = Get-Command $nombre -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $encontrados = Get-ChildItem "C:\Program Files\PostgreSQL" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\$nombre.exe" } |
    Where-Object { Test-Path $_ }
  return $encontrados | Select-Object -First 1
}

$PsqlPath = Buscar-BinarioPg "psql"
if (-not $PsqlPath) {
  Log "PostgreSQL no encontrado. Intentando instalar con winget..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id PostgreSQL.PostgreSQL --accept-source-agreements --accept-package-agreements
    Actualizar-Path
  }
  $PsqlPath = Buscar-BinarioPg "psql"
  if (-not $PsqlPath) {
    Falla "No se pudo instalar PostgreSQL automáticamente. Instálalo manualmente desde https://www.postgresql.org/download/windows/ y vuelve a ejecutar iniciar.bat"
  }
}
$PgIsReadyPath = Buscar-BinarioPg "pg_isready"

$servicioPg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($servicioPg -and $servicioPg.Status -ne "Running") {
  Log "Iniciando el servicio de PostgreSQL ($($servicioPg.Name))..."
  Start-Service $servicioPg.Name
}

$listo = $false
for ($i = 0; $i -lt 20; $i++) {
  if ($PgIsReadyPath) {
    & $PgIsReadyPath -h localhost -p 5432 *> $null
    if ($LASTEXITCODE -eq 0) { $listo = $true; break }
  } else {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect("localhost", 5432)
      $tcp.Close()
      $listo = $true
      break
    } catch { }
  }
  Start-Sleep -Seconds 1
}
if (-not $listo) {
  Falla "PostgreSQL no respondió en localhost:5432. Revisa que el servicio esté iniciado (services.msc)."
}
Log "PostgreSQL disponible."

# ---------------------------------------------------------------------------
# 3) backend\.env: lo crea desde .env.example si no existe.
# ---------------------------------------------------------------------------
if (-not (Test-Path "backend\.env")) {
  Log "Creando backend\.env desde .env.example (datos de desarrollo, no productivos)..."
  Copy-Item "backend\.env.example" "backend\.env"
}

$envTexto = Get-Content "backend\.env" -Raw
if ($envTexto -notmatch 'DATABASE_URL="postgresql://([^:]+):([^@]+)@[^/]+/([^"?]+)') {
  Falla "No se pudo interpretar DATABASE_URL en backend\.env"
}
$DbUser = $Matches[1]
$DbPass = $Matches[2]
$DbName = $Matches[3]

# ---------------------------------------------------------------------------
# 4) Rol y base de datos: los crea si no existen (mejor esfuerzo). Requiere
#    la contraseña del superusuario 'postgres'; si no se conoce y el rol/base
#    ya existen de una instalación anterior, se puede omitir con Enter.
# ---------------------------------------------------------------------------
$PgSuperPass = $env:BODEGA_PG_SUPER_PASSWORD
if (-not $PgSuperPass) {
  $PgSuperPass = Read-Host "Contraseña del superusuario 'postgres' de PostgreSQL (Enter para omitir si el rol/base ya existen)"
}

if ($PgSuperPass) {
  $env:PGPASSWORD = $PgSuperPass
  try {
    $existeRol = & $PsqlPath -h localhost -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'" 2>$null
    if ($existeRol -ne "1") {
      Log "Creando rol de base de datos '$DbUser'..."
      & $PsqlPath -h localhost -U postgres -c "CREATE ROLE `"$DbUser`" LOGIN PASSWORD '$DbPass';" | Out-Null
    }
    $existeBd = & $PsqlPath -h localhost -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
    if ($existeBd -ne "1") {
      Log "Creando base de datos '$DbName'..."
      & $PsqlPath -h localhost -U postgres -c "CREATE DATABASE `"$DbName`" OWNER `"$DbUser`";" | Out-Null
    }
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  }
} else {
  Log "Omitiendo creación de rol/base (sin contraseña de superusuario). Si ya existen, no hay problema."
}

# ---------------------------------------------------------------------------
# 5) Dependencias, migraciones y datos demo.
# ---------------------------------------------------------------------------
if (-not (Test-Path "backend\node_modules")) {
  Log "Instalando dependencias del backend..."
  Push-Location backend
  npm install
  Pop-Location
}
if (-not (Test-Path "frontend\node_modules")) {
  Log "Instalando dependencias del frontend..."
  Push-Location frontend
  npm install
  Pop-Location
}

Log "Aplicando migraciones..."
Push-Location backend
npx prisma migrate deploy
npx prisma generate
Log "Sembrando datos de demostración (idempotente, seguro repetir)..."
npm run seed
Pop-Location

# ---------------------------------------------------------------------------
# 6) Detiene una instancia previa (si quedó corriendo) y levanta backend y
#    frontend en segundo plano.
# ---------------------------------------------------------------------------
& (Join-Path $Raiz "detener.ps1") -Silencioso

New-Item -ItemType Directory -Force -Path "logs", ".pids" | Out-Null

Log "Iniciando backend (API) en http://localhost:4000 ..."
$backend = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "npm run dev > `"$Raiz\logs\backend.log`" 2>&1" `
  -WorkingDirectory (Join-Path $Raiz "backend") `
  -WindowStyle Hidden -PassThru
$backend.Id | Out-File (Join-Path $Raiz ".pids\backend.pid") -Encoding ascii

Log "Iniciando frontend (UI) en http://localhost:5173 ..."
$frontend = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "npx vite --port 5173 --strictPort > `"$Raiz\logs\frontend.log`" 2>&1" `
  -WorkingDirectory (Join-Path $Raiz "frontend") `
  -WindowStyle Hidden -PassThru
$frontend.Id | Out-File (Join-Path $Raiz ".pids\frontend.pid") -Encoding ascii

# ---------------------------------------------------------------------------
# 7) Espera a que ambos respondan.
# ---------------------------------------------------------------------------
function Responde($url) {
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
    return $true
  } catch {
    if ($_.Exception.Response) { return $true }
    return $false
  }
}

Log "Esperando a que backend y frontend respondan..."
$okBackend = $false
$okFrontend = $false
for ($i = 0; $i -lt 30; $i++) {
  if (-not $okBackend) { $okBackend = Responde "http://localhost:4000/api/auth/login" }
  if (-not $okFrontend) { $okFrontend = Responde "http://localhost:5173/" }
  if ($okBackend -and $okFrontend) { break }
  Start-Sleep -Seconds 1
}

if (-not $okBackend) { Falla "El backend no respondió a tiempo. Revisa logs\backend.log" }
if (-not $okFrontend) { Falla "El frontend no respondió a tiempo. Revisa logs\frontend.log" }

Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "============================================================"
Write-Host " Sistema listo."
Write-Host ""
Write-Host " Se abrió en tu navegador: http://localhost:5173"
Write-Host ""
Write-Host " Usuarios de demostración (cada uno con su propia contraseña, ver README.md):"
Write-Host "   admin@bodegademo.cl          Administrador          ASgSrfXMMQ*3"
Write-Host "   jefe.bodega@bodegademo.cl    Jefe de Bodega          TdsdEQRSbg@3"
Write-Host "   operador@bodegademo.cl       Operador de Bodega      HTB9GHm7PU=6"
Write-Host "   compras@bodegademo.cl        Compras                 WzFucgkvri=7"
Write-Host "   solicitante@bodegademo.cl    Solicitante             sAinLEi6d8+5"
Write-Host "   aprobador@bodegademo.cl      Aprobador               znNvKKFXhF*4"
Write-Host "   auditor@bodegademo.cl        Auditor                 9Dbm4vXQem@3"
Write-Host "   gerencia@bodegademo.cl       Gerencia                MNDm8tzvEr*3"
Write-Host ""
Write-Host " Logs:      logs\backend.log, logs\frontend.log"
Write-Host " Detener:   detener.bat"
Write-Host "============================================================"
