# ProSolutions Inventario - Despliegue completo en N5 Pro (Windows + Portainer)
# Ejecutar en el N5 dentro de la carpeta del proyecto: D:\Projectos\prosolutions_inventario_web
# Uso: .\deploy-n5.ps1   o   powershell -ExecutionPolicy Bypass -File .\deploy-n5.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ProSolutions - Build y despliegue N5" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# El despliegue usa .env.docker (no .env): .env es para desarrollo local con
# DATABASE_URL apuntando a localhost; .env.docker apunta a la red interna (db:5432).
$envFile = Join-Path $PSScriptRoot ".env.docker"
if (-not (Test-Path $envFile)) {
    Write-Host "Falta .env.docker en la carpeta del proyecto." -ForegroundColor Red
    Write-Host "Copia .env.docker.example y define: DATABASE_URL (host db:5432), POSTGRES_PASSWORD, NEXTAUTH_SECRET, NEXTAUTH_URL, TELEGRAM_BOT_TOKEN, CRON_SECRET." -ForegroundColor Yellow
    exit 1
}

# 1) Build de imágenes (incluida la de migraciones, perfil migrate).
# --env-file es obligatorio: el compose valida variables con :? incluso para build.
# GIT_SHA queda horneado en la imagen como APP_BUILD_SHA (visible en la
# consola /platform); sin esta variable la imagen sale con build "unknown".
$env:GIT_SHA = (git rev-parse --short HEAD)
Write-Host "[1/4] Construyendo imagenes Docker (build $($env:GIT_SHA))..." -ForegroundColor Yellow
docker compose -f docker-compose.yml --env-file $envFile --profile migrate build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error en build. Revisa el codigo y vuelve a ejecutar." -ForegroundColor Red
    exit 1
}
Write-Host "Build OK." -ForegroundColor Green

# Tag inmutable por SHA junto a :latest — rollback sin rebuild:
#   APP_IMAGE=prosolutions-app:<sha> BOT_IMAGE=prosolutions-bot:<sha> ^
#   docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d --force-recreate app bot
# (los compose respetan ${APP_IMAGE:-prosolutions-app:latest}; ver
# PORTAINER-STACK.md, seccion "Rollback por tag SHA"). Sin estos tags el
# rollback exigiria reconstruir la version anterior.
foreach ($img in @('prosolutions-app','prosolutions-bot','prosolutions-migrate')) {
    docker tag "${img}:latest" "${img}:$($env:GIT_SHA)"
    if ($LASTEXITCODE -ne 0) { Write-Host "Aviso: no se pudo etiquetar ${img}:$($env:GIT_SHA)" -ForegroundColor Yellow }
}
Write-Host ""

$stackName = "prosolutions"
$composePath = Join-Path $PSScriptRoot "docker-compose.portainer.yml"
if (-not (Test-Path $composePath)) {
    Write-Host "No se encuentra docker-compose.portainer.yml" -ForegroundColor Red
    exit 1
}

# 2) DB + migraciones ANTES de promover app/bot
Write-Host "[2/4] Asegurando DB y aplicando migraciones..." -ForegroundColor Yellow
# Los volumenes son external (docker-compose*.yml): un 'up' en host limpio
# falla si no existen. 'docker volume create' es idempotente (no-op si ya
# estan), asi que se aseguran antes de cada up sin tocar datos existentes.
# Nota: 'docker volume create' acepta UN solo volumen por llamada.
foreach ($vol in @('prosolutions_postgres_data','prosolutions_uploads','prosolutions_payment_proofs','prosolutions_repair_evidence')) {
    docker volume create $vol | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Error al crear volumen $vol." -ForegroundColor Red; exit 1 }
}
docker compose -f $composePath -p $stackName --env-file $envFile up -d db
if ($LASTEXITCODE -ne 0) { Write-Host "Error al levantar db." -ForegroundColor Red; exit 1 }
docker compose -f $composePath -p $stackName --env-file $envFile --profile migrate run --rm migrate
if ($LASTEXITCODE -ne 0) {
    Write-Host "La migracion fallo. No se promueve la app nueva; revisa el error arriba." -ForegroundColor Red
    exit 1
}
Write-Host "Migraciones aplicadas." -ForegroundColor Green
Write-Host ""

# 3) Levantar/actualizar app y bot (sin pasos manuales en Portainer)
Write-Host "[3/4] Levantando contenedores..." -ForegroundColor Yellow
docker compose -f $composePath -p $stackName --env-file $envFile up -d --force-recreate app bot
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

# Limpieza de imagenes dangling (capas del build anterior). Los tags :<sha>
# se conservan a proposito para rollback — se acumulan uno por deploy; para
# podarlos: docker image ls prosolutions-app  y  docker image rm <viejo>
# (guarda siempre el tag en produccion y el anterior). Ver PORTAINER-STACK.md.
docker image prune -f | Out-Null
Write-Host ""

# Estado final
Write-Host "[4/4] Estado de contenedores:" -ForegroundColor Yellow
docker ps -a --filter "name=prosolutions" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""
Write-Host "App: https://reficio.app (o http://localhost:3005)" -ForegroundColor Green
Write-Host "Listo." -ForegroundColor Green
