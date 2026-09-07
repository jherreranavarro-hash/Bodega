@echo off
setlocal
set "AQUI=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%AQUI%iniciar.ps1"
echo.
pause
