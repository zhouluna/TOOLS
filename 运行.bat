@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 需要先安装 Node.js 22 或更高版本：https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo 正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo 安装失败。
    pause
    exit /b 1
  )
)
echo 端点台地址：http://127.0.0.1:4179
call npm run dev
pause
