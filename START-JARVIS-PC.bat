@echo off
title JARVIS PC Agent

cd /d "%~dp0"

set "JARVIS_PC_URL=wss://jarvis-production-564e.up.railway.app/pc"
set "JARVIS_PC_TOKEN=JARVIS-PC-9f82Kx71-Ali-2026-Strong"

echo.
echo ========================================
echo        JARVIS PC AGENT V16.1
echo ========================================
echo.
echo Railway:
echo %JARVIS_PC_URL%
echo.

if not exist node_modules\ws\package.json (
    echo Installing JARVIS dependencies...
    call npm install
    echo.
)

echo Starting JARVIS PC Agent...
echo.

node src\pc-agent\index.js

echo.
echo JARVIS PC Agent stopped.
pause