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
# APPROVED) — su password vive solo aquí, no en docs ni en el repo de specs.
set -euo pipefail

PILOT_PORT=3316
PILOT_URL="http://localhost:${PILOT_PORT}"

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
export E2E_ADMIN_PASSWORD='E2E-Pass-2026!'
export E2E_ALLOW_WRITES=1

exec npx playwright test "$@"
