@echo off
setlocal
set "AQUI=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%AQUI%detener.ps1"
echo.
pause
