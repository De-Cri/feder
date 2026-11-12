@echo off
rem Feder - double-click to start the guided setup on Windows.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
echo.
pause
