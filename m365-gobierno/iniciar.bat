@echo off
rem Inicia Gobierno M365 (doble clic). Equivale a: powershell -ExecutionPolicy Bypass -File iniciar.ps1
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1"
if errorlevel 1 pause
