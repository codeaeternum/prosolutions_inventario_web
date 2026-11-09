#!/bin/bash
set -e  # Exit on any error

# ============================================
# PRO-SOLUTIONS INVENTARIO - Deploy to N5 Pro
# MacBook → GitHub → N5 Pro (Windows 11 + Docker)
# ============================================

# --- CONFIGURACIÓN DEL N5 PRO ---
# Alias configurado en ~/.ssh/config con llave prosolutions_galindoasc_ed25519
SSH_TARGET="${SSH_TARGET:-galindoasc-desktop}"
REMOTE_HOST="100.106.83.19"
# Carpeta en el N5 (usar '/' para SSH aunque sea Windows)
REMOTE_DIR="/d/Projectos/prosolutions_inventario_web"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   REFICIO (PRO-SOLUTIONS INVENTARIO)${NC}"
echo -e "${CYAN}   Deploy: Mac → GitHub → N5 Pro${NC}"
echo -e "${CYAN}========================================${NC}"

# --- PASO 0: Verificación previa (Typecheck + Lint + Tests unitarios) ---
if [ "${SKIP_VERIFY:-0}" != "1" ]; then
    echo -e "${BLUE}>>> [MAC] Verificando calidad antes de desplegar (typecheck, lint, test)...${NC}"
    npm run typecheck
    npm run lint
    npm test -- --run --exclude "src/__tests__/domain/*.integration.test.ts"
fi

# --- PASO 1: Subir a GitHub ---
echo -e "${BLUE}>>> [MAC] Verificando estado de Git y subiendo cambios a GitHub...${NC}"

# Abortar si hay archivos untracked no ignorados: podrían ser archivos nuevos
# que el deploy necesita pero que jamás llegarían al N5 vía git.
UNTRACKED=$(git status --porcelain | grep '^??' || true)
if [ -n "$UNTRACKED" ]; then
    echo -e "${RED}Hay archivos sin trackear (no ignorados); agrégalos a git o a .gitignore antes de desplegar:${NC}"
    echo "$UNTRACKED"
    exit 1
fi

# Evitar commitear archivos no deseados con git add . ciego: solo actualiza archivos ya trackeados
if git diff --quiet && git diff --staged --quiet; then
    echo -e "${YELLOW}No hay cambios pendientes en archivos trackeados${NC}"
else
    git add -u
    git commit -m "deploy: update from Mac $(date '+%Y-%m-%d %H:%M')" || true
fi

# Push de la rama activa
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "${YELLOW}Pushing branch ${CURRENT_BRANCH}...${NC}"
git push origin "HEAD:${CURRENT_BRANCH}"

# --- PASO 2: Deploy en N5 ---
echo -e "${BLUE}>>> [N5 PRO] Conectando vía Tailscale a ${SSH_TARGET} (${REMOTE_HOST})...${NC}"

# Verificar conexión primero
if ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_TARGET" "echo 'Conexión OK'"; then
    echo -e "${RED}Error: No se puede conectar al N5 Pro${NC}"
    echo -e "${YELLOW}Verifica que:${NC}"
    echo "  1. Tailscale está activo en el N5"
    echo "  2. SSH está habilitado en Windows"
    echo "  3. El alias ${SSH_TARGET} (${REMOTE_HOST}) es accesible"
    exit 1
fi

echo -e "${GREEN}>>> Actualizando código y reconstruyendo contenedores...${NC}"

# Comando remoto - PowerShell (Windows SSH en N5 Pro)
ssh -o StrictHostKeyChecking=no "$SSH_TARGET" "
cd D:\\Projectos

if (Test-Path 'prosolutions_inventario_web') {
    if (-not (Test-Path 'prosolutions_inventario_web\\.git')) {
        Write-Host '>>> Carpeta existe pero no es repo git, borrando...'
        Remove-Item -Recurse -Force 'prosolutions_inventario_web'
    }
}

if (-not (Test-Path 'prosolutions_inventario_web')) {
    Write-Host '>>> Clonando repositorio por primera vez...'
    git clone https://github.com/codeaeternum/prosolutions_inventario_web.git
}

cd prosolutions_inventario_web

Write-Host '>>> Actualizando desde GitHub (${CURRENT_BRANCH})...'
git fetch --all
if (\$LASTEXITCODE -ne 0) { Write-Host 'git fetch fallo'; exit 1 }
git checkout ${CURRENT_BRANCH}
if (\$LASTEXITCODE -ne 0) { Write-Host 'git checkout fallo'; exit 1 }
git pull --ff-only origin ${CURRENT_BRANCH}
if (\$LASTEXITCODE -ne 0) { Write-Host 'git pull fallo'; exit 1 }

if (-not (Test-Path '.env.docker')) { Write-Host 'Falta .env.docker en el N5.'; exit 1 }

# SHA del commit desplegado: queda horneado en la imagen (APP_BUILD_SHA) y la
# consola /platform lo muestra — así se ve a simple vista qué build corre.
\$env:GIT_SHA = (git rev-parse --short HEAD)
Write-Host ('>>> Construyendo imagenes (incluida la de migraciones) [build ' + \$env:GIT_SHA + ']...')
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate build
if (\$LASTEXITCODE -ne 0) { exit 1 }

Write-Host '>>> Asegurando DB y aplicando migraciones ANTES de promover la app...'
docker compose -f docker-compose.yml --env-file .env.docker up -d db
if (\$LASTEXITCODE -ne 0) { exit 1 }
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate
if (\$LASTEXITCODE -ne 0) { Write-Host 'Migracion fallo; app no promovida.'; exit 1 }

Write-Host '>>> Promoviendo app y bot...'
docker compose -f docker-compose.yml --env-file .env.docker up -d --force-recreate app bot
if (\$LASTEXITCODE -ne 0) { exit 1 }

Write-Host '>>> Esperando a que prosolutions-app reporte healthy (hasta 150s)...'
\$deadline = (Get-Date).AddSeconds(150)
\$health = ''
do {
    Start-Sleep -Seconds 5
    \$health = docker inspect prosolutions-app --format '{{.State.Health.Status}}' 2>\$null
    if (\$health -eq 'healthy') { break }
} while ((Get-Date) -lt \$deadline)
if (\$health -ne 'healthy') {
    Write-Host ('prosolutions-app no llego a healthy (estado: ' + \$health + ').')
    docker logs prosolutions-app --tail 40
    exit 1
}

\$botStatus = docker inspect prosolutions-bot --format '{{.State.Status}}' 2>\$null
if (\$botStatus -ne 'running') {
    Write-Host ('prosolutions-bot no esta running (estado: ' + \$botStatus + ').')
    docker logs prosolutions-bot --tail 40
    exit 1
}

Write-Host '>>> Estado de contenedores:'
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}>>> ¡Despliegue en N5 Pro completado! 🚀${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}Acceso:${NC}"
echo "  - Web: https://reficio.app"
echo ""
