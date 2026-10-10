@echo off
chcp 65001 >nul
title Writer Studio - Local Server
cd /d "%~dp0"
set PORT=5173

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found in PATH.
  echo         Install Python 3.8+ from https://www.python.org/downloads/
  echo         and make sure "Add python.exe to PATH" is checked.
  pause
  exit /b 1
)

echo ============================================
echo   Writer Studio - local server
echo   It will print the real URL below.
echo   Close this window to stop.
echo ============================================
echo.
start "" http://127.0.0.1:%PORT%/
python "%~dp0serve.py" %PORT%
echo.
echo Server stopped. Press any key to exit.
pause >nul
