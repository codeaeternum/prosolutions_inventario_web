# ProSolutions - Despliegue completo sin pasos manuales
# Pensado para ejecutar EN EL N5 PRO (donde está Cursor y el proyecto).
# Por defecto: build + up en esta máquina. Sin SSH, sin Portainer manual.
# Opción -Remote: desde otro PC, push a GitHub y deploy vía SSH al N5.

param(
    [switch]$Remote  # Solo si estás en otro PC: push y deploy vía SSH al N5
)

$ErrorActionPreference = "Stop"
$REMOTE_USER = "dgali"
$REMOTE_HOST = "100.106.83.19"
$REMOTE_PATH = "D:\Projectos\prosolutions_inventario_web"

# Por defecto: modo local (estamos en el N5)
if (-not $Remote) {
    Write-Host "[N5] Build y up en esta maquina..." -ForegroundColor Cyan
    if (-not (Test-Path ".env")) { Write-Host "Falta .env en la carpeta del proyecto." -ForegroundColor Red; exit 1 }
    docker compose -f docker-compose.yml build --no-cache
    if ($LASTEXITCODE -ne 0) { exit 1 }
    docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env up -d --force-recreate
    if ($LASTEXITCODE -ne 0) { exit 1 }
    Start-Sleep -Seconds 5
    docker ps -a --filter "name=prosolutions" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    Write-Host "Listo. App: https://prosolutions.ascnex.com" -ForegroundColor Green
    exit 0
}

# --- Modo remoto: push y luego deploy en N5 ---
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ProSolutions - Deploy (push + N5)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1) Subir a GitHub si hay cambios
Write-Host "[1/4] Subiendo a GitHub..." -ForegroundColor Yellow
$hasChanges = $false
if (git status --porcelain) { $hasChanges = $true }
if ($hasChanges) {
    git add -A
    git commit -m "deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null
    git push origin main
    if ($LASTEXITCODE -ne 0) { Write-Host "Error en push." -ForegroundColor Red; exit 1 }
} else {
    Write-Host "Sin cambios para commitear." -ForegroundColor Gray
}

# 2) Conexión al N5
Write-Host "[2/4] Conectando al N5 ($REMOTE_HOST)..." -ForegroundColor Yellow
$testConn = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$REMOTE_USER@$REMOTE_HOST" "echo OK" 2>$null
if ($LASTEXITCODE -ne 0 -or $testConn -ne "OK") {
    Write-Host "No se puede conectar por SSH al N5. Revisa Tailscale y SSH." -ForegroundColor Red
    exit 1
}

# 3) En el N5: (clone si falta) pull, build, up
Write-Host "[3/4] En el N5: pull, build, up..." -ForegroundColor Yellow
$remoteScript = @"
`$path = '$REMOTE_PATH'
`$parent = 'D:\Projectos'
if (-not (Test-Path -LiteralPath `$path)) {
    if (-not (Test-Path -LiteralPath `$parent)) { New-Item -ItemType Directory -Path `$parent -Force | Out-Null }
    Set-Location -LiteralPath `$parent
    git clone https://github.com/codeaeternum/prosolutions_inventario_web.git
    Set-Location -LiteralPath `$path
    Write-Host 'Repo clonado. Crea .env en el N5 en ' `$path ' y vuelve a ejecutar deploy.'
    exit 1
}
Set-Location -LiteralPath `$path
if (-not (Test-Path '.env')) { Write-Host 'Falta .env en el N5 en ' `$path; exit 1 }
git fetch --all
git reset --hard origin/main
git clean -fd
docker compose -f docker-compose.yml build --no-cache
if (`$LASTEXITCODE -ne 0) { exit 1 }
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env up -d --force-recreate
if (`$LASTEXITCODE -ne 0) { exit 1 }
Write-Host 'Contenedores actualizados.'
docker ps -a --filter 'name=prosolutions' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
"@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "powershell -NoProfile -EncodedCommand $encoded"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error durante el deploy en el N5." -ForegroundColor Red
    exit 1
}

Write-Host "[4/4] Listo." -ForegroundColor Green
Write-Host "App: https://prosolutions.ascnex.com" -ForegroundColor Green
