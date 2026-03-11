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

echo "1/2 Ejecutando SQL de la migración de crédito..."
npx prisma db execute --file "$SQL_FILE"

echo "2/2 Marcando migración como aplicada en Prisma..."
npx prisma migrate resolve --applied "$MIGRATION_NAME"

echo "Listo. Verifica con: npx prisma migrate status"
