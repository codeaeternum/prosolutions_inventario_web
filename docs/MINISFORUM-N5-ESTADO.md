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
| **Tailscale** | IP `100.106.83.19` (usuario `dgali`) |
| **Ethernet (LAN)** | 192.168.1.195 |
| **Ruta proyecto (workspace)** | `D:\Proyectos_Sincronizados\prosolutions_inventario_web` |
| **Ruta usada por deploy.ps1 -Remote** | `D:\Projectos\prosolutions_inventario_web` |

---

## Contenedores y puertos en el host (verificado)

| Contenedor | Estado | Puertos publicados | Imagen |
|------------|--------|--------------------|--------|
| **prosolutions-app** | Up (healthy) | 3005→3000 | prosolutions-app:latest |
| **prosolutions-bot** | Up | — | prosolutions-bot:latest |
| **prosolutions-db** | Up (healthy) | 5432→5432 | postgres:16-alpine |
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
| **3005** | Web + API (Next.js) | `prosolutions-app` | Mapeo `3005:3000`. Cloudflare Tunnel apunta aquí. |
| **5432** | PostgreSQL 16 | `prosolutions-db` | Base de datos de ProSolutions. |

**Importante:** Si despliegas **otra aplicación** en el mismo N5 (ej. AeternaSuite), usa puertos distintos para evitar conflictos, por ejemplo:
- Otra web: **3010**, **3011**, etc.
- Otro Postgres: **5433**, **5434**, etc.
- Redis u otro: **6380**, etc.

---

## Cloudflare Tunnel

| Dominio público | Origen (URL interna en Cloudflare) |
|-----------------|-------------------------------------|
| **https://prosolutions.ascnex.com** | `http://host.docker.internal:3005` |

- Si **cloudflared** corre **dentro de Docker** en el N5, `host.docker.internal:3005` es correcto.
- Si **cloudflared** corre **en el host** (Windows), en la config del tunnel usa `http://127.0.0.1:3005` o `http://localhost:3005`.

---

## Stack en Portainer

- **Nombre del stack:** `prosolutions` (o el que hayas puesto).
- **Compose en Portainer:** Usar `docker-compose.portainer.yml` (sin `build`; imágenes `prosolutions-app:latest`, `prosolutions-bot:latest`).
- **Imágenes:** Se construyen en el N5 con `docker compose -f docker-compose.yml build` y luego se despliega el stack con el compose de Portainer, o se hace build+up con el compose completo desde SSH.

---

## Variables de entorno (ProSolutions)

Definidas en Portainer (stack) o en `.env` si usas `docker compose` por CLI:

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `NEXTAUTH_SECRET` | Sí | Clave para JWT/sesiones. Mismo valor que `AUTH_SECRET`. |
| `NEXTAUTH_URL` | Sí | URL pública, ej. `https://prosolutions.ascnex.com` |
| `TELEGRAM_BOT_TOKEN` | Sí (si usas bot) | Token del bot de Telegram |
| `DATABASE_URL` | No (en compose) | Ya viene en el YAML para `app` y `bot` (postgresql://prosolutions:...@db:5432/prosolutions_db) |
| `POSTGRES_*` | No (en compose) | User/password/DB definidos en el servicio `db` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | No | Web push (opcional) |
| `CRON_SECRET` | No | Protección del endpoint de reservas expiradas |
| `OLLAMA_HOST` | No | Solo bot; ej. `http://host.docker.internal:11434` |

---

## Despliegue (todo desde el N5 Pro)

- **En el N5:** En la carpeta del proyecto ejecutar `.\deploy.ps1` o `.\deploy-n5.ps1`. Hace build y up en esta máquina; no hace falta Portainer ni pasos manuales. Requiere `.env` en la misma carpeta.
- **Desde otro PC (opcional):** `.\deploy.ps1 -Remote` hace push a GitHub y deploy vía SSH al N5. O desde Mac/Linux: `./deploy-n5.sh`.

### Migración de crédito en BD ya existente (N5)

Si la base de datos ya tenía tablas y `npx prisma migrate deploy` falla con **P3005** (schema not empty), aplica la migración del módulo de crédito a mano y márcala como aplicada:

**En el N5 (PowerShell), desde la carpeta del proyecto** (con `DATABASE_URL` en `.env` apuntando al Postgres del N5, ej. `postgresql://user:pass@localhost:5432/prosolutions_db`):

```powershell
.\scripts\migrate-credit-on-existing-db.ps1
```

El script: (1) ejecuta el SQL de la migración con `prisma db execute`, (2) marca la migración como aplicada con `prisma migrate resolve`. Luego verifica con `npx prisma migrate status`.

---

## Resumen para otra app en el mismo N5

Al desplegar **otra** aplicación (p. ej. AeternaSuite) en este mismo Minisforum:

1. **No uses** en el nuevo compose: puerto **3005** (web) ni **5432** (Postgres) en el host, salvo que compartas o cambies la configuración a propósito.
2. **Sugerencia de puertos libres:** Web 3010, API 3011, Postgres 5433, Redis 6380 (documentar en un `PUERTOS.md` del otro proyecto).
3. **CORS:** Si la nueva app tiene front y API en dominios distintos (Cloudflare), configurar CORS en la API con el origen del front.
4. Usa el **Contexto adicional** del [prompt de despliegue](PROMPT-DESPLIEGUE-PORTAINER.md) indicando: *"En el mismo host ya corre ProSolutions en 3005 (web) y 5432 (Postgres)."*

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

# Puertos en escucha
netstat -an | findstr "LISTENING" | findstr "3005 5432"

# .env (solo nombres de variables)
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=') { $matches[1] } }
```
