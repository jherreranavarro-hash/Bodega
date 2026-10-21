# Instala dependencias, compila el frontend y levanta Gobierno M365 (http://localhost:4100).
# Si la consola no encuentra Node.js, lo busca en las ubicaciones habituales y, con tu permiso,
# descarga una copia portátil oficial en .runtime\ (sin permisos de administrador).
# Compatible con Windows PowerShell 5.1 y PowerShell 7.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # la barra de progreso hace muy lenta la descarga en PowerShell 5.1
Set-Location $PSScriptRoot

$NodeMinimo = 20
$Runtime = Join-Path $PSScriptRoot '.runtime'

function Write-Paso([string]$Texto) { Write-Host "`n==> $Texto" -ForegroundColor Cyan }

function Get-NodeMajor {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
  $v = (& node --version 2>$null | Out-String).Trim()
  if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
  return 0
}

function Test-Node {
  return ((Get-NodeMajor) -ge $NodeMinimo) -and [bool](Get-Command npm.cmd -ErrorAction SilentlyContinue)
}

function Add-NodePath([string]$Dir) {
  if ($Dir -and (Test-Path (Join-Path $Dir 'node.exe'))) { $env:Path = "$Dir;$env:Path" }
}

function Find-Node {
  if (Test-Node) { return $true }
  # La consola pudo abrirse antes de instalar Node.js: se recarga el PATH guardado en Windows
  $env:Path = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [Environment]::GetEnvironmentVariable('Path', 'User'),
    $env:Path
  ) -join ';'
  if (Test-Node) { return $true }
  # Ubicaciones habituales: copia portátil previa, instalador oficial, nvm-windows, Scoop
  $candidatos = @()
  if (Test-Path $Runtime) {
    $candidatos += Get-ChildItem $Runtime -Directory -Filter 'node-v*' | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName }
  }
  $candidatos += @(
    (Join-Path $env:ProgramFiles 'nodejs'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs' }),
    $env:NVM_SYMLINK,
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'scoop\apps\nodejs-lts\current' }),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'scoop\apps\nodejs\current' })
  )
  # Se agregan al revés para que el primero de la lista quede adelante en el PATH
  [array]::Reverse($candidatos)
  foreach ($d in $candidatos) { Add-NodePath $d }
  return (Test-Node)
}

function Install-NodePortable {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  Write-Paso 'Consultando la última versión LTS de Node.js en nodejs.org…'
  $versiones = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
  # Node.js 22 LTS es la versión con la que se prueba la aplicación; si no existiera, la LTS más reciente
  $rel = $versiones | Where-Object { $_.lts -and $_.version -like 'v22.*' -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1
  if (-not $rel) { $rel = $versiones | Where-Object { $_.lts -and $_.files -contains "win-$arch-zip" } | Select-Object -First 1 }
  if (-not $rel) { throw 'No se encontró una versión LTS de Node.js para Windows en nodejs.org.' }
  $nombre = "node-$($rel.version)-win-$arch"
  $base = "https://nodejs.org/dist/$($rel.version)"
  New-Item -ItemType Directory -Force $Runtime | Out-Null
  $zip = Join-Path $Runtime "$nombre.zip"

  Write-Paso "Descargando $nombre.zip (unos 30 MB)…"
  Invoke-WebRequest "$base/$nombre.zip" -OutFile $zip -UseBasicParsing

  # Integridad: la huella SHA-256 debe coincidir con la publicada por Node.js
  $sumas = [string](Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $linea = $sumas -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -like "*  $nombre.zip" } | Select-Object -First 1
  $esperado = if ($linea) { ($linea -split '\s+')[0].ToLower() } else { '' }
  $real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if (-not $esperado -or $real -ne $esperado) {
    Remove-Item $zip -Force
    throw 'La descarga de Node.js no coincide con la huella SHA-256 publicada. Vuelve a intentarlo.'
  }
  Write-Host "Huella SHA-256 verificada ($($real.Substring(0, 16))…)"

  Write-Paso 'Descomprimiendo…'
  if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
    & tar.exe -xf $zip -C $Runtime
    if ($LASTEXITCODE -ne 0) { Expand-Archive $zip -DestinationPath $Runtime -Force }
  } else {
    Expand-Archive $zip -DestinationPath $Runtime -Force
  }
  Remove-Item $zip -Force
  Add-NodePath (Join-Path $Runtime $nombre)
}

function Invoke-Npm([string]$Carpeta, [string]$Descripcion, [string[]]$Argumentos) {
  Write-Paso $Descripcion
  Push-Location $Carpeta
  try {
    & npm.cmd @Argumentos
    if ($LASTEXITCODE -ne 0) { throw "Falló 'npm $($Argumentos -join ' ')' en $Carpeta (código $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

function Get-EnvValue([string]$Clave, [string]$PorDefecto) {
  $m = Select-String -Path 'backend/.env' -Pattern "^\s*$Clave\s*=\s*(\S+)" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value }
  return $PorDefecto
}

function Test-Servidor([int]$Puerto) {
  try {
    Invoke-WebRequest "http://127.0.0.1:$Puerto/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

try {
  if (-not (Test-Path 'backend/.env')) { Copy-Item 'backend/.env.example' 'backend/.env' }
  $puerto = [int](Get-EnvValue 'PORT' '4100')
  $url = Get-EnvValue 'PUBLIC_URL' "http://localhost:$puerto"

  if (Test-Servidor $puerto) {
    Write-Host "Gobierno M365 ya está en ejecución. Abriendo $url" -ForegroundColor Green
    Start-Process $url
    exit 0
  }

  Write-Paso 'Verificando Node.js…'
  if (-not (Find-Node)) {
    $actual = Get-NodeMajor
    if ($actual -gt 0) {
      Write-Host "Se encontró Node.js $actual, pero se necesita la versión $NodeMinimo o superior." -ForegroundColor Yellow
    } else {
      Write-Host 'No se encontró Node.js en este equipo (npm viene incluido con Node.js).' -ForegroundColor Yellow
    }
    Write-Host 'Puedo descargar una copia portátil oficial de Node.js LTS desde nodejs.org en la carpeta'
    Write-Host '.runtime de este proyecto. No requiere permisos de administrador ni modifica el sistema.'
    $r = Read-Host '¿Descargarla ahora? [S/n]'
    if ($r -and $r.Trim() -notmatch '^(s|si|sí|y|yes)$') {
      Write-Host "`nInstala Node.js LTS y vuelve a ejecutar iniciar.bat:" -ForegroundColor Yellow
      Write-Host '  winget install -e --id OpenJS.NodeJS.LTS'
      Write-Host '  o descarga el instalador desde https://nodejs.org/es/download'
      exit 1
    }
    Install-NodePortable
    if (-not (Test-Node)) { throw 'No se pudo preparar Node.js.' }
  }
  Write-Host "Node.js $((& node --version | Out-String).Trim()) · npm $((& npm.cmd --version | Out-String).Trim())"

  Invoke-Npm 'backend' 'Instalando dependencias del backend…' @('install', '--no-audit', '--no-fund')
  Invoke-Npm 'frontend' 'Instalando dependencias del frontend…' @('install', '--no-audit', '--no-fund')
  Invoke-Npm 'frontend' 'Compilando el frontend…' @('run', 'build')

  Write-Paso "Iniciando Gobierno M365 en $url (Ctrl+C para detener)"
  # Abre el navegador en cuanto el servidor responda (máximo 90 s)
  $abrir = "for (`$i = 0; `$i -lt 90; `$i++) { try { Invoke-WebRequest 'http://127.0.0.1:$puerto/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '$url'; break } catch { Start-Sleep -Seconds 1 } }"
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-Command', $abrir)

  Push-Location 'backend'
  try {
    & npx.cmd tsx src/server.ts
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
} catch {
  Write-Host "`n✖ $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
