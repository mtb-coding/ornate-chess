@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.13 or newer, then run start.bat again.
  pause
  exit /b 1
)

if not exist "server\node_modules\" (
  echo Installing the account server libraries...
  pushd server
  call npm install
  if errorlevel 1 (
    popd
    echo The server libraries could not be installed.
    pause
    exit /b 1
  )
  popd
)

call :listening 8488
if errorlevel 1 (
  echo Starting the account server at http://127.0.0.1:8488/
  start "Ornate Chess API" /D "%ROOT%" cmd /k node server\index.mjs
) else (
  echo The account server is already running.
)

call :worker
if errorlevel 1 (
  echo Starting the review and backup worker.
  start "Ornate Chess worker" /D "%ROOT%" cmd /k node server\worker.mjs
) else (
  echo The review worker is already running.
)

call :listening 8002
if errorlevel 1 (
  echo Starting the pages at http://localhost:8002/
  start "Ornate Chess pages" /D "%ROOT%" powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\serve.ps1"
) else (
  echo The pages are already running.
  start "" "http://localhost:8002/"
)

exit /b 0

:listening
netstat -ano | findstr ":%~1 " | findstr "LISTENING" >nul
if errorlevel 1 exit /b 1
exit /b 0

:worker
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*worker.mjs*' }) { exit 0 } else { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0
