@echo off
chcp 65001 >nul
setlocal
set "AQUI=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%AQUI%iniciar.ps1"
echo.
pause
