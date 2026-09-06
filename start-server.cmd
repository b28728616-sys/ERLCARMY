@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or is not available on PATH.
  pause
  exit /b 1
)
if not exist node_modules\express (
  call npm install
  if errorlevel 1 pause & exit /b 1
)
start "ERLCARMY Website" http://localhost:3000
node server.js
pause
