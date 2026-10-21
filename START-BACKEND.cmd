@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backend-control.ps1" -Action start
if errorlevel 1 pause
