@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process npm.cmd -ArgumentList 'start -- --minimized' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
