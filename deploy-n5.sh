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
git checkout ${CURRENT_BRANCH}
git pull --ff-only origin ${CURRENT_BRANCH}

Write-Host '>>> Construyendo imágenes (incluida la de migraciones)...'
docker compose -f docker-compose.yml --profile migrate build
if (\$LASTEXITCODE -ne 0) { exit 1 }

Write-Host '>>> Asegurando DB y aplicando migraciones ANTES de promover la app...'
docker compose -f docker-compose.yml up -d db
if (\$LASTEXITCODE -ne 0) { exit 1 }
docker compose -f docker-compose.yml --profile migrate run --rm migrate
if (\$LASTEXITCODE -ne 0) { Write-Host 'Migracion fallo; app no promovida.'; exit 1 }

Write-Host '>>> Promoviendo app y bot...'
docker compose -f docker-compose.yml up -d --force-recreate app bot
if (\$LASTEXITCODE -ne 0) { exit 1 }

Write-Host '>>> Esperando readiness (health 503 hasta esquema listo)...'
Start-Sleep -Seconds 15
docker inspect prosolutions-app --format '{{.State.Health.Status}}'

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
