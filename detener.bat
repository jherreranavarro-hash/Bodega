@echo off
chcp 65001 >nul
setlocal
set "AQUI=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%AQUI%detener.ps1"
echo.
pause
