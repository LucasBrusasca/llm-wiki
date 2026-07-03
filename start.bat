@echo off
setlocal
title Algedi
cd /d "%~dp0"

echo ===============================================
echo   Algedi - Arranque del stack (Docker)
echo ===============================================
echo.

:: Verificar que Docker este disponible
docker version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker no esta corriendo o no esta instalado.
  echo Abri Docker Desktop y volve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo Levantando contenedores con "docker compose up -d"...
echo.
docker compose up -d
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo "docker compose up -d". Revisa los logs con: docker compose logs
  echo.
  pause
  exit /b 1
)

echo.
echo Esperando a que el frontend este listo en http://localhost:5173 ...

:: Poll hasta ~60s: el frontend responde cuando Vite termino de arrancar
set /a TRIES=0
:waitloop
set /a TRIES+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5173 ^| Out-Null); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready
if %TRIES% geq 30 goto timeout
timeout /t 2 /nobreak >nul
goto waitloop

:timeout
echo [AVISO] El frontend tardo mas de lo esperado. Abriendo el navegador igual...

:ready
echo.
echo Frontend listo. Abriendo navegador...
start "" http://localhost:5173

echo.
echo ===============================================
echo   Stack arriba:
echo     Frontend: http://localhost:5173
echo     Backend:  http://localhost:8000
echo.
echo   Para detener todo:  docker compose down
echo ===============================================
echo.
timeout /t 4 /nobreak >nul
endlocal
