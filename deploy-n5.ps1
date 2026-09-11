# ProSolutions Inventario - Despliegue completo en N5 Pro (Windows + Portainer)
# Ejecutar en el N5 dentro de la carpeta del proyecto: D:\Projectos\prosolutions_inventario_web
# Uso: .\deploy-n5.ps1   o   powershell -ExecutionPolicy Bypass -File .\deploy-n5.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ProSolutions - Build y despliegue N5" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1) Build de imágenes (incluida la de migraciones, perfil migrate)
Write-Host "[1/4] Construyendo imagenes Docker..." -ForegroundColor Yellow
docker compose -f docker-compose.yml --profile migrate build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error en build. Revisa el codigo y vuelve a ejecutar." -ForegroundColor Red
    exit 1
}
Write-Host "Build OK." -ForegroundColor Green
Write-Host ""

$stackName = "prosolutions"
$composePath = Join-Path $PSScriptRoot "docker-compose.portainer.yml"
if (-not (Test-Path $composePath)) {
    Write-Host "No se encuentra docker-compose.portainer.yml" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $PSScriptRoot ".env"))) {
    Write-Host "Falta .env en la carpeta del proyecto (NEXTAUTH_SECRET, NEXTAUTH_URL, TELEGRAM_BOT_TOKEN, DATABASE_URL, POSTGRES_PASSWORD, CRON_SECRET)." -ForegroundColor Red
    exit 1
}

# 2) DB + migraciones ANTES de promover app/bot
Write-Host "[2/4] Asegurando DB y aplicando migraciones..." -ForegroundColor Yellow
docker compose -f $composePath -p $stackName --env-file .env up -d db
if ($LASTEXITCODE -ne 0) { Write-Host "Error al levantar db." -ForegroundColor Red; exit 1 }
docker compose -f $composePath -p $stackName --env-file .env --profile migrate run --rm migrate
if ($LASTEXITCODE -ne 0) {
    Write-Host "La migracion fallo. No se promueve la app nueva; revisa el error arriba." -ForegroundColor Red
    exit 1
}
Write-Host "Migraciones aplicadas." -ForegroundColor Green
Write-Host ""

# 3) Levantar/actualizar app y bot (sin pasos manuales en Portainer)
Write-Host "[3/4] Levantando contenedores..." -ForegroundColor Yellow
docker compose -f $composePath -p $stackName --env-file .env up -d --force-recreate app bot
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error al levantar contenedores." -ForegroundColor Red
    exit 1
}

# 4) Esperar readiness real de la app (health devuelve 503 hasta que el esquema esta listo)
Write-Host "Esperando a que prosolutions-app reporte healthy..." -ForegroundColor Yellow
$deadline = (Get-Date).AddSeconds(150)
$health = ""
do {
    Start-Sleep -Seconds 5
    $health = docker inspect prosolutions-app --format "{{.State.Health.Status}}" 2>$null
    if ($health -eq "healthy") { break }
} while ((Get-Date) -lt $deadline)
if ($health -ne "healthy") {
    Write-Host "prosolutions-app no llego a healthy (estado: $health)." -ForegroundColor Red
    docker logs prosolutions-app --tail 30
    exit 1
}
Write-Host "Contenedores levantados y saludables." -ForegroundColor Green
Write-Host ""

# Estado final
Write-Host "[4/4] Estado de contenedores:" -ForegroundColor Yellow
docker ps -a --filter "name=prosolutions" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""
Write-Host "App: https://prosolutions.ascnex.com (o http://localhost:3005)" -ForegroundColor Green
Write-Host "Listo." -ForegroundColor Green
