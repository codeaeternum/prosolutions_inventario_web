#!/bin/bash
set -e  # Exit on any error

# ============================================
# PRO-SOLUTIONS INVENTARIO - Deploy Local
# Desarrollo en MacBook con Docker
# ============================================

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directorio del proyecto
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   PRO-SOLUTIONS INVENTARIO${NC}"
echo -e "${CYAN}   Deploy Local (MacBook)${NC}"
echo -e "${CYAN}========================================${NC}"

# Función para mostrar ayuda
show_help() {
    echo -e "${YELLOW}Uso:${NC} ./deploy-local.sh [comando]"
    echo ""
    echo -e "${BLUE}Comandos disponibles:${NC}"
    echo "  up        - Inicia contenedores y servidor de desarrollo"
    echo "  down      - Detiene todos los contenedores"
    echo "  restart   - Reinicia contenedores"
    echo "  db        - Solo inicia la base de datos"
    echo "  seed      - Ejecuta el seed de la base de datos"
    echo "  reset     - Resetea la base de datos (¡borra todo!)"
    echo "  studio    - Abre Prisma Studio"
    echo "  logs      - Muestra logs de los contenedores"
    echo "  status    - Muestra estado de contenedores"
    echo "  help      - Muestra esta ayuda"
    echo ""
    echo -e "${YELLOW}Ejemplos:${NC}"
    echo "  ./deploy-local.sh up      # Inicia todo"
    echo "  ./deploy-local.sh db      # Solo base de datos"
    echo "  ./deploy-local.sh seed    # Poblar base de datos"
    echo ""
}

# Función para iniciar solo la base de datos
start_db() {
    echo -e "${BLUE}>>> Iniciando base de datos PostgreSQL...${NC}"
    docker compose -f docker-compose.dev.yml up -d
    
    echo -e "${YELLOW}>>> Esperando que PostgreSQL esté listo...${NC}"
    sleep 3
    
    # Verificar conexión
    until docker compose -f docker-compose.dev.yml exec -T db pg_isready -U prosolutions -d prosolutions_db > /dev/null 2>&1; do
        echo -e "${YELLOW}Esperando PostgreSQL...${NC}"
        sleep 2
    done
    
    echo -e "${GREEN}>>> PostgreSQL listo!${NC}"
}

# Función para aplicar migraciones (misma vía que producción: migrate deploy)
sync_schema() {
    echo -e "${BLUE}>>> Aplicando migraciones de Prisma (migrate deploy)...${NC}"
    npx prisma generate
    npx prisma migrate deploy
    echo -e "${GREEN}>>> Migraciones aplicadas!${NC}"
}

# Función para ejecutar seed
run_seed() {
    echo -e "${BLUE}>>> Ejecutando seed de la base de datos...${NC}"
    npm run db:seed
    echo -e "${GREEN}>>> Seed completado!${NC}"
}

# Función para iniciar servidor de desarrollo
start_dev() {
    # Matar procesos anteriores de next dev si existen
    pkill -f "next dev" 2>/dev/null || true
    rm -rf "$PROJECT_DIR/.next/dev/lock" 2>/dev/null || true
    sleep 1
    
    echo -e "${BLUE}>>> Iniciando servidor de desarrollo Next.js...${NC}"
    echo -e "${YELLOW}>>> Acceso: http://localhost:3000${NC}"
    npm run dev
}

# Procesar comandos
case "${1:-up}" in
    up)
        start_db
        sync_schema
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}>>> Base de datos lista!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo -e "${YELLOW}Acceso:${NC}"
        echo "  - Web: http://localhost:3000"
        echo "  - DB:  postgresql://prosolutions:prosolutions123@localhost:5432/prosolutions_db"
        echo ""
        echo -e "${BLUE}>>> Iniciando servidor de desarrollo...${NC}"
        start_dev
        ;;
    
    down)
        echo -e "${BLUE}>>> Deteniendo contenedores...${NC}"
        docker compose -f docker-compose.dev.yml down
        echo -e "${GREEN}>>> Contenedores detenidos!${NC}"
        ;;
    
    restart)
        echo -e "${BLUE}>>> Reiniciando contenedores...${NC}"
        docker compose -f docker-compose.dev.yml restart
        echo -e "${GREEN}>>> Contenedores reiniciados!${NC}"
        ;;
    
    db)
        start_db
        sync_schema
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}>>> Base de datos lista!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo -e "${YELLOW}Conexión:${NC}"
        echo "  postgresql://prosolutions:prosolutions123@localhost:5432/prosolutions_db"
        echo ""
        echo -e "${YELLOW}Para iniciar el servidor:${NC} npm run dev"
        ;;
    
    seed)
        run_seed
        ;;
    
    reset)
        echo -e "${RED}>>> ⚠️  ATENCIÓN: Esto borrará TODOS los datos!${NC}"
        read -p "¿Estás seguro? (escribe 'SI' para confirmar): " confirm
        if [ "$confirm" = "SI" ]; then
            echo -e "${BLUE}>>> Reseteando base de datos...${NC}"
            docker compose -f docker-compose.dev.yml down -v
            start_db
            sync_schema
            run_seed
            echo -e "${GREEN}>>> Base de datos reseteada!${NC}"
        else
            echo -e "${YELLOW}>>> Operación cancelada${NC}"
        fi
        ;;
    
    studio)
        echo -e "${BLUE}>>> Abriendo Prisma Studio...${NC}"
        npx prisma studio
        ;;
    
    logs)
        echo -e "${BLUE}>>> Mostrando logs...${NC}"
        docker compose -f docker-compose.dev.yml logs -f
        ;;
    
    status)
        echo -e "${BLUE}>>> Estado de contenedores:${NC}"
        docker compose -f docker-compose.dev.yml ps
        ;;
    
    help|--help|-h)
        show_help
        ;;
    
    *)
        echo -e "${RED}>>> Comando desconocido: $1${NC}"
        show_help
        exit 1
        ;;
esac
