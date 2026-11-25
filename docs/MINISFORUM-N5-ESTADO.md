# Estado actual del Minisforum N5 Pro (referencia)

Documento de referencia para no equivocarse al desplegar esta u otras apps en el mismo host. **Actualiza este archivo** cuando cambies puertos, añadas servicios o dominios. Estado verificado con comandos en el N5.

---

## Host (verificado)

| Dato | Valor |
|------|--------|
| **Nombre de host** | GALINDOASC |
| **Dispositivo** | Minisforum N5 Pro (Micro Computer) |
| **OS** | Microsoft Windows 11 Pro (10.0.26200) |
| **RAM** | ~30 GB |
| **Docker** | 29.2.0 / Docker Compose v5.0.2 |
| **Tailscale** | IP `100.124.116.70` (usuario `dgali`) |
| **Ethernet (LAN)** | 192.168.1.195 |
| **Ruta proyecto (workspace)** | `D:\Proyectos_Sincronizados\prosolutions_inventario_web` |
| **Ruta de deploy (la que sincroniza deploy-n5.sh por SSH)** | `D:\Projectos\prosolutions_inventario_web` |

---

## Contenedores y puertos en el host (verificado)

| Contenedor | Estado | Puertos publicados | Imagen |
|------------|--------|--------------------|--------|
| **prosolutions-app** | Up (healthy) | 3005→3000 | prosolutions-app:latest |
| **prosolutions-bot** | Up | — | prosolutions-bot:latest |
| **prosolutions-db** | Up (healthy) | — (sin publicar; solo `prosolutions-network`, lo alcanzan como `db:5432`) | postgres:16-alpine |
| aeternasuite-web | Up | 3010→3000 | aeternasuite-web:latest |
| aeternasuite-api | Up | 3011→3001 | — |
| aeternasuite-postgres | Up (healthy) | 5433→5432 | postgres:16-alpine |
| aeternasuite-redis | Up (healthy) | 6380→6379 | redis:7-alpine |
| cloudflared_tunnel | Up | — | cloudflare/cloudflared:latest |
| portainer | Up | 8000, 9000, 9443 | portainer/portainer-ce:latest |
| admin_us_account-frontend | Up | 3000→80 | — |
| uptime-kuma | Up (healthy) | 3001→3001 | louislam/uptime-kuma:1 |
| paperless | Up (healthy) | 8010→8000 | paperless-ngx |
| heimdall | Up | 9888→80 | heimdall |
| immich_server | Up (healthy) | 2283→2283 | immich-server |
| keikichi_frontend | Up | 127.0.0.1:3080→80 | — |
| keikichi_backend | Up (unhealthy) | 127.0.0.1:8001→8000 | — |
| telegram-bot-api | Up | 8081→8081 | aiogram/telegram-bot-api |
| alist, komga, etc. | Up | 5244, 25600, … | — |

**Puertos ya ocupados en el host (evitar para nuevas apps):** 3000, 3001, 3005, 3010, 3011, 5432, 5433, 6380, 8000, 8010, 8081, 9443, 9888, 2283, 5244, 25600, etc.

---

## Puertos en uso (ProSolutions Inventario)

| Puerto en el host | Servicio | Contenedor | Notas |
|-------------------|----------|------------|--------|
| **3005** | Web + API (Next.js) | `prosolutions-app` | Publicado solo en `127.0.0.1` y la IP LAN (`APP_BIND_IP`). Cloudflare Tunnel NO usa este puerto: llega por la red interna (`app:3000`). |
| **—** | PostgreSQL 16 | `prosolutions-db` | YA NO publica puerto al host (`ports` vacío / PortBindings {}): solo accesible por app/bot via `prosolutions-network` como `db:5432`. |

**Importante:** Si despliegas **otra aplicación** en el mismo N5 (ej. AeternaSuite), usa puertos distintos para evitar conflictos, por ejemplo:
- Otra web: **3010**, **3011**, etc.
- Otro Postgres: **5433**, **5434**, etc.
- Redis u otro: **6380**, etc.

---

## Cloudflare Tunnel

| Dominio público | Origen (URL interna en Cloudflare) |
|-----------------|-------------------------------------|
| **https://reficio.app** | `http://app:3000` |

- **Verificado:** el contenedor `cloudflared_tunnel` está conectado a la red interna de Docker `prosolutions_prosolutions-network` y alcanza la app por el **nombre del servicio** del compose: `http://app:3000` (el nombre de contenedor `prosolutions-app:3000` también resuelve en esa red). La config del tunnel se edita en el dashboard de Cloudflare (Zero Trust → Networks → Tunnels), no en el N5.
- Cualquier doc que diga `host.docker.internal:3005` está **mal**: el compose publica el 3005 solo en loopback y en la IP LAN del taller — la red interna es el camino garantizado y el que usa el túnel hoy.
- El 3005 del host (loopback + LAN) existe para acceso directo del taller y pruebas, no para Cloudflare.
- Si algún día **cloudflared** corriera en el host (hoy corre en Docker), el origen sería `http://127.0.0.1:3005`.

---

## Stack en Portainer

- **Nombre del stack:** `prosolutions` (o el que hayas puesto).
- **Compose en Portainer:** Usar `docker-compose.portainer.yml` (sin `build`; imágenes `prosolutions-app:latest`, `prosolutions-bot:latest`).
- **Imágenes:** Se construyen en el N5 con `docker compose -f docker-compose.yml build` y luego se despliega el stack con el compose de Portainer, o se hace build+up con el compose completo desde SSH.

---

## Variables de entorno (ProSolutions)

Se definen en `.env.docker` (deploy por CLI/script) o en las *Environment variables* del stack de Portainer. El compose las valida con `${VAR:?}`: **si falta cualquiera de las obligatorias el despliegue falla al validar, no arranca con defaults**.

Obligatorias (`${...:?}` en docker-compose.yml):

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | `postgresql://prosolutions:<POSTGRES_PASSWORD>@db:5432/prosolutions_db` — apunta a la red interna (`db`), no a localhost |
| `POSTGRES_PASSWORD` | Password del servicio `db`; debe coincidir con la de `DATABASE_URL` |
| `NEXTAUTH_SECRET` | Clave para JWT/sesiones (`openssl rand -base64 32`); el compose la copia también a `AUTH_SECRET` |
| `NEXTAUTH_URL` | URL pública, ej. `https://reficio.app` |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `CRON_SECRET` | Secreto de los endpoints `/api/cron/*` |

Además **`TRUST_PROXY_SECRET` es obligatorio en producción** (aunque el compose la admite vacía mientras termina la oleada): candado de los headers de IP de proxy — sin él, cualquier equipo de la LAN puede forjar `CF-Connecting-IP` y esquivar el rate limit por cliente. Pasos de alta en `.env.docker.example`.

Opcionales relevantes: `APP_BIND_IP` (default `192.168.1.195`), `DEVICE_SECRET_KEY`, `RESEND_API_KEY`/`RESEND_FROM`, `ALLOWED_ORIGINS`, retenciones `*_RETENTION_DAYS`, `PG_POOL_MAX`. La lista completa y comentada está en `.env.docker.example` (raíz del repo) — copiarla a `.env.docker` y rellenar.

---

## Despliegue

**Canónico:** `./deploy-n5.sh` desde el Mac (push + dispara `deploy-n5.ps1` en el N5 por SSH) o `powershell -ExecutionPolicy Bypass -File .\deploy-n5.ps1` directo en el N5. **`deploy.ps1` está DEPRECATED** — no usarlo. Toda la lógica vive en `deploy-n5.ps1`; el procedimiento completo y el rollback por tag SHA están en **PORTAINER-STACK.md**.

### Instalación desde cero en un host nuevo (runbook)

`docker compose up -d` a secas **NO es un deploy válido**: sin los volúmenes external creados falla el up, sin migraciones la app no arranca (el preflight la tira) y sin orden la app puede promoverse contra un esquema viejo. El orden real es:

```powershell
# 0) Clonar el repo y crear .env.docker (copia .env.docker.example y rellena
#    TODAS las obligatorias de la tabla de arriba + TRUST_PROXY_SECRET).

# 1) Los CUATRO volúmenes external son obligatorios — sin cualquiera de ellos
#    el up falla. 'docker volume create' es idempotente y acepta UN volumen
#    por llamada:
docker volume create prosolutions_postgres_data
docker volume create prosolutions_uploads
docker volume create prosolutions_payment_proofs
docker volume create prosolutions_repair_evidence

# 2) Build de las imágenes (incluida la de migraciones, perfil migrate):
$env:GIT_SHA = (git rev-parse --short HEAD)
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate build

# 3) DB primero y esperarla healthy — el servicio migrate la exige
#    (depends_on: service_healthy):
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d db
docker inspect prosolutions-db --format '{{.State.Health.Status}}'   # debe decir healthy

# 4) Migraciones ANTES de promover la app — en BD vacía crean todo el esquema:
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker --profile migrate run --rm migrate

# 5) Recién ahora, app y bot:
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d --force-recreate app bot

# 6) Verificar salud real (la app responde 503 hasta que el esquema está listo):
docker inspect prosolutions-app --format '{{.State.Health.Status}}'  # healthy (hasta ~150 s)
```

`deploy-n5.ps1` ejecuta exactamente esta secuencia y aborta si el paso de migraciones falla — usarlo en vez de repetirla a mano.

### Acceso directo LAN (taller)

La app se publica en `127.0.0.1:3005` y `${APP_BIND_IP}:3005` (default `192.168.1.195`). Cloudflare llega por la red interna de Docker (`app:3000`, ver la sección del túnel) y no depende de ese puerto.

### Migraciones en BD ya existente (N5)

El historial arranca con `20250309000000_baseline`, que crea el esquema inicial completo. Si la BD ya tenía tablas (creadas con `db push` antes de existir migraciones), `migrate deploy` falla con **P3005** (schema not empty). Con backup verificado en la mano:

1. Compara el esquema real con lo que crea la baseline (`pg_dump --schema-only` o `npx prisma migrate diff`).
2. Si coincide, marca como aplicadas las migraciones ya reflejadas y despliega el resto:

```powershell
# En el N5 (PowerShell), desde la carpeta del proyecto.
# OJO: prosolutions-db YA NO publica 5432 al host — `npx prisma` desde
# Windows no alcanza localhost:5432. Corre los comandos DENTRO de la red
# docker con la imagen migrate (tiene prisma CLI y DATABASE_URL apuntando a db):
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma migrate resolve --applied 20250309000000_baseline
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma migrate resolve --applied 20250310000000_add_credit_module
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate
docker compose -f docker-compose.yml --env-file .env.docker --profile migrate run --rm migrate npx prisma migrate status
```

`.\scripts\migrate-credit-on-existing-db.ps1` sigue disponible para el caso particular de que solo falte el módulo de crédito: (1) ejecuta su SQL con `prisma db execute`, (2) marca la migración como aplicada con `prisma migrate resolve`.

---

## Resumen para otra app en el mismo N5

Al desplegar **otra** aplicación (p. ej. AeternaSuite) en este mismo Minisforum:

1. **No uses** en el nuevo compose el puerto **3005** (web de ProSolutions) en el host, salvo que compartas o cambies la configuración a propósito. (El Postgres de ProSolutions ya no publica puerto al host: 5432 quedó libre para el host, pero verifícalo con `netstat`/`docker ps` antes de reutilizarlo.)
2. **Sugerencia de puertos libres:** Web 3010, API 3011, Postgres 5433, Redis 6380 (documentar en un `PUERTOS.md` del otro proyecto).
3. **CORS:** Si la nueva app tiene front y API en dominios distintos (Cloudflare), configurar CORS en la API con el origen del front.
4. Usa el **Contexto adicional** del [prompt de despliegue](PROMPT-DESPLIEGUE-PORTAINER.md) indicando: *"En el mismo host ya corre ProSolutions en 3005 (web); su Postgres no expone puerto al host."*

---

## Comandos para reverificar el entorno

Ejecutar en el N5 (PowerShell) desde la carpeta del proyecto o desde cualquier ruta:

```powershell
# Sistema
systeminfo

# Docker
docker --version
docker compose version
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

# ProSolutions
docker inspect prosolutions-app --format "{{.State.Health.Status}}"
docker logs prosolutions-app --tail 20
docker exec prosolutions-app wget -q --spider http://localhost:3000/api/health; echo "Exit: $LASTEXITCODE"

# Puertos en escucha (el Postgres de ProSolutions ya no publica al host:
# solo el 3005 de la web debe aparecer LISTENING)
netstat -an | findstr "LISTENING" | findstr "3005"

# .env (solo nombres de variables)
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=') { $matches[1] } }
```
