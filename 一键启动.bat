@echo off
title 知衡 FinScope 一键启动
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   知衡 FinScope 一键启动
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 goto NO_NODE
node scripts/start.mjs %*
set CODE=%errorlevel%
if "%CODE%"=="0" goto END
if "%CODE%"=="130" goto END
goto FAILED

:NO_NODE
echo [错误] 未检测到 Node.js，请先安装 Node.js 20 或更高版本：
echo        https://nodejs.org/
goto FAILED

:FAILED
echo.
echo 启动失败（退出码 %CODE%）。请把上面的报错截图，或执行以下命令排查：
echo   node -v
echo   npm -v
echo   node scripts/start.mjs --check
echo.
pause
exit /b 1

:END
endlocal
