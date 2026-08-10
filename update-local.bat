@echo off
rem Novora 本地部署一键更新（Windows）：双击运行即可
cd /d "%~dp0"
call npm run update:local
echo.
pause
