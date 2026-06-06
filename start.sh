#!/usr/bin/env bash
# PragmaForge - Arranque del stack completo (Linux / macOS)
# Doble clic (o ./start.sh) levanta todo con Docker y abre el navegador.
set -euo pipefail

# Ubicarse en la raiz del proyecto (donde vive este script)
cd "$(dirname "$0")"

echo "==============================================="
echo "  PragmaForge - Arranque del stack (Docker)"
echo "==============================================="
echo

# Verificar Docker
if ! docker version >/dev/null 2>&1; then
  echo "[ERROR] Docker no esta corriendo o no esta instalado."
  echo "Inicia Docker y volve a ejecutar: ./start.sh"
  exit 1
fi

echo 'Levantando contenedores con "docker compose up -d"...'
echo
docker compose up -d

URL="http://localhost:5173"
echo
echo "Esperando a que el frontend este listo en ${URL} ..."

# Poll hasta ~60s a que el frontend responda
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "${URL}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "${ready}" -eq 1 ] || echo "[AVISO] El frontend tardo mas de lo esperado. Abriendo igual..."

# Abrir el navegador segun la plataforma
echo
echo "Abriendo navegador..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${URL}" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "${URL}" >/dev/null 2>&1 &
else
  echo "Abri manualmente: ${URL}"
fi

echo
echo "==============================================="
echo "  Stack arriba:"
echo "    Frontend: ${URL}"
echo "    Backend:  http://localhost:8000"
echo
echo "  Para detener todo:  docker compose down"
echo "==============================================="
