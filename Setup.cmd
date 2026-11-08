@echo off
rem Cerchio - doppio clic per avviare l'installazione guidata su Windows.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
echo.
pause