@echo off
setlocal enabledelayedexpansion
title Algedi - Publicar
cd /d "%~dp0"

echo ===============================================
echo   Algedi - Publicar en GitHub
echo ===============================================
echo.

:: ── Git disponible ───────────────────────────────────────────────────────
git --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git no esta instalado o no esta en el PATH.
  echo.
  pause
  exit /b 1
)

:: ── Chequeo de seguridad: ninguna credencial puede salir ─────────────────
:: La copia de respaldo del entorno tiene una clave real. Si por cualquier
:: motivo dejara de estar ignorada, este bat NO empuja.
echo Verificando que no se filtre ninguna credencial...
git check-ignore -q ".env.bak-antes-de-ollama"
if errorlevel 1 (
  if exist ".env.bak-antes-de-ollama" (
    echo.
    echo [ABORTADO] .env.bak-antes-de-ollama NO esta ignorado y contiene una
    echo            clave real. Si se sube, hay que rotarla.
    echo            Revisa el .gitignore antes de volver a intentar.
    echo.
    pause
    exit /b 1
  )
)

:: Ningun .env con valores puede estar en el indice (.env.example si, es plantilla).
for /f "delims=" %%F in ('git ls-files ".env.*" ":(exclude).env.example"') do (
  echo.
  echo [ABORTADO] El archivo %%F esta versionado y puede tener credenciales.
  echo.
  pause
  exit /b 1
)
echo   OK - sin credenciales expuestas.
echo.

:: ── Que falta subir ──────────────────────────────────────────────────────
echo Consultando el remoto...
git fetch origin --quiet
if errorlevel 1 (
  echo [ERROR] No se pudo contactar el remoto. Revisa tu conexion.
  echo.
  pause
  exit /b 1
)
echo.

git rev-list --count origin/main..main > "%TEMP%\algedi_n.txt" 2>nul
set /p PENDIENTES=<"%TEMP%\algedi_n.txt"
del "%TEMP%\algedi_n.txt" >nul 2>&1

if "%PENDIENTES%"=="0" (
  echo Ya esta todo subido. No hay nada pendiente.
  echo.
  timeout /t 4 /nobreak >nul
  exit /b 0
)

echo Commits pendientes de subir:
echo.
git log --oneline origin/main..main
echo.
echo -----------------------------------------------
echo   El repositorio es publico: Pages gratuito lo exige.
echo   El commit "docs:" incluye tus entregables del TP
echo   (PDF, PPTX, notas de diseno). Elegi con cuidado.
echo -----------------------------------------------
echo.
echo   [1] Solo el codigo  (Pages se despliega igual)
echo   [2] Todo, codigo y documentos
echo   [3] Cancelar
echo.
set "OPCION="
set /p OPCION=Opcion [1/2/3]:

if "%OPCION%"=="3" goto cancelado
if "%OPCION%"==""  goto cancelado

if "%OPCION%"=="1" (
  set "COMMIT_CODIGO=861eb62"
  git rev-parse --verify --quiet !COMMIT_CODIGO! >nul
  if errorlevel 1 (
    echo.
    echo [ERROR] No se encontro el commit de codigo !COMMIT_CODIGO!.
    echo         Puede que el historial haya cambiado. Usa la opcion 2
    echo         o revisa "git log" a mano.
    echo.
    pause
    exit /b 1
  )
  echo.
  echo Subiendo solo el commit de codigo...
  git push origin !COMMIT_CODIGO!:main
  goto verificar
)

if "%OPCION%"=="2" (
  echo.
  echo Subiendo todo...
  git push origin main
  goto verificar
)

echo Opcion no valida.
echo.
pause
exit /b 1

:verificar
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo el push. Si pide credenciales, configura tu acceso a
  echo         GitHub y volve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo ===============================================
echo   Subido.
echo.
echo   GitHub Pages se construye solo con cada push
echo   a main. Tarda un par de minutos.
echo.
echo     Demo:    https://lucasbrusasca.github.io/llm-wiki/
echo     Estado:  https://github.com/LucasBrusasca/llm-wiki/actions
echo ===============================================
echo.
echo Abriendo el estado del despliegue...
start "" https://github.com/LucasBrusasca/llm-wiki/actions
echo.
timeout /t 5 /nobreak >nul
endlocal
exit /b 0

:cancelado
echo.
echo Cancelado. No se subio nada.
echo.
timeout /t 3 /nobreak >nul
endlocal
exit /b 0
