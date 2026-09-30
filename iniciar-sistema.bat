@echo off
title Sistema Clinica - DEV (nao feche esta janela)
cd /d "%~dp0"
if not exist logs mkdir logs
echo Subindo containers (Postgres, Redis, WPPConnect)...
docker compose up -d
echo.
echo Iniciando API e Web. Aguarde 1-2 minutos e acesse: http://localhost:5173
echo Log completo em logs\dev.log
echo.
powershell -NoProfile -Command "npm run dev 2>&1 | Tee-Object -FilePath logs\dev.log"
echo.
echo O sistema parou. Veja logs\dev.log
pause
