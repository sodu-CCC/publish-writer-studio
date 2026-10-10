@echo off
chcp 65001 >nul
echo ============================================
echo   设置仓库信息（把文档里的占位符换成你的）
echo   直接回车 = 用默认值 / 跳过
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\set-repo-info.ps1" %*
echo.
pause