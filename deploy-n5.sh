#!/bin/bash
set -e  # Exit on any error

# ============================================
# PRO-SOLUTIONS INVENTARIO - Deploy to N5 Pro
# MacBook → GitHub → N5 Pro (Windows 11 + Docker)
# ============================================
#
# WRAPPER DELGADO. Toda la lógica de build/migraciones/up/health vive en
# deploy-n5.ps1 (se ejecuta EN el N5). Este script solo:
#   1. Verifica calidad en el Mac (typecheck + lint + tests) — SKIP_VERIFY=1 la omite.
#   2. Sube la rama activa a GitHub (push-driven: el N5 descarga, nunca se
#      copia código por SSH).
#   3. Dispara en el N5: git fetch + git reset --hard origin/<rama> +
#      powershell -ExecutionPolicy Bypass -File deploy-n5.ps1
#
# El comando remoto viaja como -EncodedCommand (UTF-16LE base64): no depende
# del shell por defecto del SSH del N5 — funciona igual si es PowerShell o
# cmd.exe, porque invoca powershell.exe explícitamente y el payload base64 no
# necesita quoting en ninguno de los dos. La versión anterior mandaba el bloque
# PowerShell en crudo y solo funcionaba si el shell por defecto era PowerShell.

# --- CONFIGURACIÓN DEL N5 PRO ---
# Alias configurado en ~/.ssh/config con llave prosolutions_galindoasc_ed25519
SSH_TARGET="${SSH_TARGET:-galindoasc-desktop}"
REMOTE_HOST="100.124.116.70"
REMOTE_PATH='D:\Projectos\prosolutions_inventario_web'

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
if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "HEAD" ]; then
    echo -e "${RED}HEAD detached: no se puede determinar la rama a desplegar.${NC}"
    exit 1
fi
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

echo -e "${GREEN}>>> Actualizando código en el N5 y ejecutando deploy-n5.ps1...${NC}"

# Comando remoto (PowerShell). Delgado a propósito: sincroniza el repo con la
# rama recién pusheada y delega TODO el resto (build, tags por SHA, volúmenes,
# migraciones, up, health-poll, prune) a deploy-n5.ps1 — edita ese archivo para
# cambiar el deploy, no este.
REMOTE_PS=$(cat <<EOF
\$path = '${REMOTE_PATH}'
if (-not (Test-Path -LiteralPath \$path)) {
    Set-Location 'D:\Projectos'
    git clone https://github.com/codeaeternum/prosolutions_inventario_web.git
    if (\$LASTEXITCODE -ne 0) { Write-Host 'git clone fallo'; exit 1 }
    Write-Host 'Repo clonado. Crea .env.docker en el N5 (copia .env.docker.example) y vuelve a desplegar.'
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path \$path '.git'))) {
    Write-Host "\$path existe pero no es un repo git; revisalo a mano (no se borra automáticamente)."
    exit 1
}
Set-Location -LiteralPath \$path
Write-Host '>>> Actualizando desde GitHub (${CURRENT_BRANCH})...'
git fetch origin
if (\$LASTEXITCODE -ne 0) { Write-Host 'git fetch fallo'; exit 1 }
git reset --hard origin/${CURRENT_BRANCH}
if (\$LASTEXITCODE -ne 0) { Write-Host 'git reset fallo'; exit 1 }
if (-not (Test-Path '.env.docker')) { Write-Host 'Falta .env.docker en el N5 (copia .env.docker.example).'; exit 1 }
powershell -ExecutionPolicy Bypass -File .\deploy-n5.ps1
if (\$LASTEXITCODE -ne 0) { Write-Host 'deploy-n5.ps1 fallo'; exit 1 }
EOF
)

# UTF-16LE base64 (lo que espera powershell -EncodedCommand). Node está
# garantizado: el paso 0 corre npm. Una sola línea, sin caracteres especiales
# para cmd.exe ni PowerShell — por eso no hace falta quoting anidado.
ENCODED=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "utf16le").toString("base64"))' "$REMOTE_PS")

ssh -o StrictHostKeyChecking=no "$SSH_TARGET" "powershell -NoProfile -EncodedCommand ${ENCODED}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}>>> ¡Despliegue en N5 Pro completado! 🚀${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}Acceso:${NC}"
echo "  - Web: https://reficio.app"
echo ""
