#requires -version 5.1
<#
  Detiene el backend y el frontend iniciados por iniciar.ps1 / iniciar.bat.
#>
param([switch]$Silencioso)

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

function Detener($nombre, $pidfile) {
  $ruta = Join-Path $Raiz $pidfile
  if (-not (Test-Path $ruta)) {
    if (-not $Silencioso) { Write-Host "==> $nombre no tenía un proceso registrado." }
    return
  }
  $procId = (Get-Content $ruta -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
    # taskkill /T mata también los procesos hijos (npm -> node/tsx/vite), que
    # de otro modo quedarían huérfanos ocupando los puertos.
    & taskkill /PID $procId /T /F *> $null
    if (-not $Silencioso) { Write-Host "==> $nombre detenido (PID $procId)." }
  } elseif (-not $Silencioso) {
    Write-Host "==> $nombre ya no estaba corriendo."
  }
  Remove-Item $ruta -ErrorAction SilentlyContinue
}

Detener "Backend" ".pids\backend.pid"
Detener "Frontend" ".pids\frontend.pid"
