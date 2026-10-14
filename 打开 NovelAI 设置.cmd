@echo off
start "" /b node "%~dp0standalone_settings.mjs"
ping 127.0.0.1 -n 2 >nul
start "" "http://127.0.0.1:47831/"
