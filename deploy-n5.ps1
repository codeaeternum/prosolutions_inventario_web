# ProSolutions Inventario - Despliegue completo en N5 Pro (Windows + Portainer)
# Ejecutar en el N5 dentro de la carpeta del proyecto: D:\Projectos\prosolutions_inventario_web
# Uso: .\deploy-n5.ps1   o   powershell -ExecutionPolicy Bypass -File .\deploy-n5.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ProSolutions - Build y despliegue N5" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1) Build de imágenes
Write-Host "[1/3] Construyendo imagenes Docker..." -ForegroundColor Yellow
docker compose -f docker-compose.yml build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error en build. Revisa el codigo y vuelve a ejecutar." -ForegroundColor Red
    exit 1
}
Write-Host "Build OK." -ForegroundColor Green
Write-Host ""

# 2) Levantar/actualizar contenedores (sin pasos manuales en Portainer)
Write-Host "[2/3] Levantando contenedores..." -ForegroundColor Yellow
$stackName = "prosolutions"
$composePath = Join-Path $PSScriptRoot "docker-compose.portainer.yml"
if (-not (Test-Path $composePath)) {
    Write-Host "No se encuentra docker-compose.portainer.yml" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $PSScriptRoot ".env"))) {
    Write-Host "Falta .env en la carpeta del proyecto (NEXTAUTH_SECRET, NEXTAUTH_URL, TELEGRAM_BOT_TOKEN)." -ForegroundColor Red
    exit 1
}
docker compose -f docker-compose.portainer.yml -p $stackName --env-file .env up -d --force-recreate
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error al levantar contenedores." -ForegroundColor Red
    exit 1
}
Write-Host "Contenedores levantados." -ForegroundColor Green
Write-Host ""

# 3) Estado
Write-Host "[3/3] Estado de contenedores:" -ForegroundColor Yellow
docker ps -a --filter "name=prosolutions" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""
Write-Host "App: https://prosolutions.ascnex.com (o http://localhost:3005)" -ForegroundColor Green
Write-Host "Listo." -ForegroundColor Green
