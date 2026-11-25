#!/usr/bin/env bash
# Aplica la migración del módulo de crédito en una base de datos que ya tiene tablas.
# Uso: desde la raíz del proyecto, con DATABASE_URL en .env o en el entorno:
#   ./scripts/migrate-credit-on-existing-db.sh
# En N5 Pro (o servidor): ejecutar desde el directorio del proyecto después de desplegar.

set -e
cd "$(dirname "$0")/.."
MIGRATION_NAME="20250310000000_add_credit_module"
SQL_FILE="prisma/migrations/${MIGRATION_NAME}/migration.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "Error: No se encuentra $SQL_FILE"
  exit 1
fi

# --- Guard: alcanzabilidad de la BD ANTES de invocar prisma -----------------
# El compose de producción NO publica 5432 al host (prosolutions-db solo vive
# en la red interna y DATABASE_URL apunta a `db:5432`). prisma CLI corriendo
# en el host nunca la alcanza y moría con un timeout opaco. Se resuelve la
# URL como prisma lo haría (entorno, luego .env / .env.docker) y se prueba
# TCP; si no responde se explica el flujo correcto: correr DENTRO de la red
# docker con la imagen "migrate" (tiene prisma CLI).
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
  for f in .env .env.docker; do
    if [ -f "$f" ]; then
      v=$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$f" | head -1 | cut -d= -f2- | sed "s/^[[:space:]\"']*//;s/[[:space:]\"']*$//")
      if [ -n "$v" ]; then DB_URL="$v"; break; fi
    fi
  done
fi
if [ -n "$DB_URL" ]; then
  DB_HOST=$(printf '%s' "$DB_URL" | sed -n 's|^[^@]*@\([^/:?#]*\).*|\1|p')
  DB_PORT=$(printf '%s' "$DB_URL" | sed -n 's|^[^@]*@[^/:?#]*:\([0-9][0-9]*\)/.*|\1|p')
  DB_PORT="${DB_PORT:-5432}"
  if [ -n "$DB_HOST" ]; then
    reachable=0
    if command -v timeout >/dev/null 2>&1; then
      timeout 4 bash -c "exec 3<>/dev/tcp/${DB_HOST}/${DB_PORT}" 2>/dev/null && reachable=1
    elif command -v nc >/dev/null 2>&1; then
      nc -z -w 4 "$DB_HOST" "$DB_PORT" >/dev/null 2>&1 && reachable=1
    else
      bash -c "exec 3<>/dev/tcp/${DB_HOST}/${DB_PORT}" 2>/dev/null && reachable=1
    fi
    if [ "$reachable" -ne 1 ]; then
      echo "ERROR: no hay conexión TCP a la base de datos en ${DB_HOST}:${DB_PORT}." >&2
      echo "La BD del stack NO publica puerto al host: prisma desde esta máquina no la alcanza." >&2
      echo "Corre la migración DENTRO de la red docker con la imagen migrate:" >&2
      echo "  docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma db execute --file prisma/migrations/${MIGRATION_NAME}/migration.sql" >&2
      echo "  docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma migrate resolve --applied ${MIGRATION_NAME}" >&2
      echo "(ver docs/MINISFORUM-N5-ESTADO.md, sección 'Migraciones en BD ya existente')" >&2
      exit 1
    fi
    echo "BD alcanzable en ${DB_HOST}:${DB_PORT}."
  fi
fi

echo "1/2 Ejecutando SQL de la migración de crédito..."
npx prisma db execute --file "$SQL_FILE"

echo "2/2 Marcando migración como aplicada en Prisma..."
npx prisma migrate resolve --applied "$MIGRATION_NAME"

echo "Listo. Verifica con: npx prisma migrate status"
