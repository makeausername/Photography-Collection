@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/seed-demo.mjs
echo Preview: http://127.0.0.1:4173/
echo Admin: http://127.0.0.1:4173/admin
node --env-file-if-exists=.env server.mjs
pause
