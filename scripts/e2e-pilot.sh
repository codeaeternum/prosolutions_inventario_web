#!/usr/bin/env bash
# Corre la suite E2E contra el ambiente PILOT (desechable, datos de prueba).
#
# El pilot corre en docker como `prosolutions-pilot-app-1` expuesto SOLO en
# 127.0.0.1:3316 del host donde vive:
#   - en el N5 (galindoasc-desktop) hay que abrir un túnel SSH;
#   - si el stack también corre local (OrbStack/Docker en esta Mac), :3316
#     ya responde y el túnel se omite.
#
# Uso:
#   bash scripts/e2e-pilot.sh                 # toda la suite (specs de lectura
#                                             # públicos + los de escritura)
#   bash scripts/e2e-pilot.sh e2e/admin-venta.spec.ts
#
# E2E_ALLOW_WRITES=1 permite los specs que ESCRIBEN en la BD (ventas,
# devoluciones, altas de catálogo). NUNCA apuntar este script a producción:
# los datos marcados "E2E-" se asumen desechables.
#
# La cuenta e2e-admin@prosolutions.local es exclusiva del pilot (ADMIN,
# APPROVED) — su password NO se versiona: se lee de e2e/.env.pilot (o
# pilot.env) o de la variable E2E_ADMIN_PASSWORD ya exportada.
set -euo pipefail

PILOT_PORT=3316
PILOT_URL="http://localhost:${PILOT_PORT}"

# Password del admin del pilot: primero la variable de entorno, luego un
# archivo local NO versionado (KEY=VALUE plano; todos los nombres están en
# .gitignore). Se parsea con grep/sed — nunca `source`, para no ejecutar
# contenido arbitrario del archivo. Se resuelve ANTES de abrir el túnel.
if [ -z "${E2E_ADMIN_PASSWORD:-}" ]; then
  REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  for f in "$REPO_ROOT/e2e/.env.pilot" "$REPO_ROOT/e2e/pilot.env" "$REPO_ROOT/pilot.env"; do
    if [ -f "$f" ]; then
      E2E_ADMIN_PASSWORD=$(grep -E '^[[:space:]]*E2E_ADMIN_PASSWORD[[:space:]]*=' "$f" | head -1 | cut -d= -f2- | sed "s/^[[:space:]\"']*//;s/[[:space:]\"']*$//")
      [ -n "$E2E_ADMIN_PASSWORD" ] && break
    fi
  done
fi
if [ -z "${E2E_ADMIN_PASSWORD:-}" ]; then
  echo "[e2e-pilot] ERROR: falta la password del admin del pilot." >&2
  echo "  Crea e2e/.env.pilot (NO versionado) con una línea:" >&2
  echo "    E2E_ADMIN_PASSWORD=<password>" >&2
  echo "  o expórtala en el entorno antes de correr el script." >&2
  exit 1
fi

# ¿Ya responde el pilot en :3316? (stack local en OrbStack/Docker o un túnel
# abierto a mano). Si no, lo abrimos con ssh -fN (BatchMode, alias del config).
if ! curl -sf -o /dev/null --max-time 4 "${PILOT_URL}/login"; then
  echo "[e2e-pilot] :${PILOT_PORT} no responde — abriendo túnel a galindoasc-desktop…"
  ssh -fN -L "${PILOT_PORT}:127.0.0.1:${PILOT_PORT}" galindoasc-desktop
  for i in $(seq 1 15); do
    curl -sf -o /dev/null --max-time 2 "${PILOT_URL}/login" && break
    sleep 1
  done
fi

if ! curl -sf -o /dev/null --max-time 5 "${PILOT_URL}/login"; then
  echo "[e2e-pilot] ERROR: el pilot no responde en ${PILOT_URL}" >&2
  echo "  Verifica que prosolutions-pilot-app-1 esté arriba (docker ps)." >&2
  exit 1
fi

echo "[e2e-pilot] pilot OK en ${PILOT_URL} — corriendo playwright"

export E2E_BASE_URL="${E2E_BASE_URL:-${PILOT_URL}}"
export E2E_ADMIN_EMAIL="e2e-admin@prosolutions.local"
export E2E_ADMIN_PASSWORD
export E2E_ALLOW_WRITES=1

exec npx playwright test "$@"
