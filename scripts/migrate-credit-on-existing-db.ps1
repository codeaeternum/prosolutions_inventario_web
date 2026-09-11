# Aplica la migración del módulo de crédito en una base de datos que ya tiene tablas.
# Uso: desde la raíz del proyecto (PowerShell), con DATABASE_URL en .env:
#   .\scripts\migrate-credit-on-existing-db.ps1
# En N5 Pro: ejecutar en la carpeta del proyecto (ej. D:\Proyectos_Sincronizados\prosolutions_inventario_web).

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$MigrationName = "20250310000000_add_credit_module"
$SqlFile = "prisma\migrations\$MigrationName\migration.sql"

if (-not (Test-Path $SqlFile)) {
    Write-Error "No se encuentra $SqlFile"
    exit 1
}

Write-Host "1/2 Ejecutando SQL de la migración de crédito..."
npx prisma db execute --file $SqlFile

Write-Host "2/2 Marcando migración como aplicada en Prisma..."
npx prisma migrate resolve --applied $MigrationName

Write-Host "Listo. Verifica con: npx prisma migrate status"
