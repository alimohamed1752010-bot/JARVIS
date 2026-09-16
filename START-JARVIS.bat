@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo       JARVIS Unified PC + Discord
echo ========================================
echo.
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
echo Starting JARVIS...
call npm start
pause
