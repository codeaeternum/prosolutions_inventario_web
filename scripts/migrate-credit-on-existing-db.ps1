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

# --- Guard: alcanzabilidad de la BD ANTES de invocar prisma -----------------
# El compose de produccion NO publica 5432 al host (prosolutions-db solo vive
# en la red interna `prosolutions-network` y DATABASE_URL apunta a `db:5432`).
# prisma CLI corriendo en Windows nunca la alcanza y moria con un timeout
# opaco. Se resuelve la URL como prisma lo haria (entorno, luego .env /
# .env.docker) y se prueba TCP; si no responde se explica el flujo correcto:
# correr DENTRO de la red docker con la imagen "migrate" (tiene prisma CLI).
$DbUrl = $env:DATABASE_URL
if (-not $DbUrl) {
    foreach ($f in @(".env", ".env.docker")) {
        $envPath = Join-Path $ProjectRoot $f
        if (Test-Path $envPath) {
            $hit = Get-Content $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
            if ($hit) { $DbUrl = ($hit -split '=', 2)[1].Trim().Trim('"').Trim("'"); break }
        }
    }
}
if ($DbUrl -and $DbUrl -match '@([^/:?#]+)(?::(\d+))?[/]') {
    $DbHost = $Matches[1]
    $DbPort = 5432
    if ($Matches[2]) { $DbPort = [int]$Matches[2] }
    $reachable = $false
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($DbHost, $DbPort, $null, $null)
        $reachable = ($async.AsyncWaitHandle.WaitOne(4000)) -and $client.Connected
        $client.Close()
    } catch { $reachable = $false }
    if (-not $reachable) {
        Write-Host "ERROR: no hay conexion TCP a la base de datos en ${DbHost}:${DbPort}." -ForegroundColor Red
        Write-Host "La BD del stack NO publica puerto al host: prisma desde esta maquina no la alcanza." -ForegroundColor Yellow
        Write-Host "Corre la migracion DENTRO de la red docker con la imagen migrate:" -ForegroundColor Yellow
        Write-Host "  docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma db execute --file prisma/migrations/$MigrationName/migration.sql" -ForegroundColor Cyan
        Write-Host "  docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma migrate resolve --applied $MigrationName" -ForegroundColor Cyan
        Write-Host "(ver docs\MINISFORUM-N5-ESTADO.md, seccion 'Migraciones en BD ya existente')" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "BD alcanzable en ${DbHost}:${DbPort}."
}

Write-Host "1/2 Ejecutando SQL de la migración de crédito..."
npx prisma db execute --file $SqlFile

Write-Host "2/2 Marcando migración como aplicada en Prisma..."
npx prisma migrate resolve --applied $MigrationName

Write-Host "Listo. Verifica con: npx prisma migrate status"
