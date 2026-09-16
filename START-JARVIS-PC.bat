@echo off
cd /d "%~dp0"
if not exist node_modules\ws\package.json (
  echo Installing PC Agent dependency...
  call npm install
)
node src\pc-agent\index.js
pause
