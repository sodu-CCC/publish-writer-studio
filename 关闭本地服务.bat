@echo off
chcp 65001 >nul
title Writer Studio - Stop Servers
echo Looking for servers on ports 5173-5179...
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr /C:":517"') do (
  echo   killing PID %%a
  taskkill /F /PID %%a >nul 2>&1
  if errorlevel 1 (echo   [FAILED] run this script as Administrator) else (echo   [OK] killed)
)
echo.
echo Done. Press any key to exit.
pause >nul
