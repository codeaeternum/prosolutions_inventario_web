# Recrear el stack en Portainer (N5 Pro)

**Referencia del host:** Para una foto fiel de puertos, servicios y variables en el Minisforum N5 Pro (y no equivocarse al desplegar otras apps), ver **[docs/MINISFORUM-N5-ESTADO.md](docs/MINISFORUM-N5-ESTADO.md)**.

---

## Despliegue sin pasos manuales

**Deploy canónico — desde el Mac (o cualquier Linux):**

```bash
./deploy-n5.sh
```

Es un wrapper delgado push-driven: verifica calidad en el Mac, sube la rama activa a GitHub y por SSH hace que el N5 ejecute `git fetch` + `git reset --hard origin/<rama>` + `powershell -ExecutionPolicy Bypass -File deploy-n5.ps1`. **Toda la lógica del deploy vive en `deploy-n5.ps1`** (se ejecuta en el N5): **build** de las imágenes (incluida `prosolutions-migrate`) → **tags por SHA** para rollback → **volúmenes external** → **db** → **`prisma migrate deploy`** → **up** de `app`/`bot` con `docker-compose.portainer.yml` y `.env.docker` → **espera a que `/api/health` reporte healthy**. Si la migración falla, el script se detiene y la app nueva no se promueve. No hace falta abrir Portainer.

**Directo en el N5** (mismo resultado, sin push ni SSH):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-n5.ps1
```

> **`deploy.ps1` está DEPRECATED** (comentario grande al inicio del archivo): usa `.env` en vez de `.env.docker` y duplica lógica vieja. No lo uses para deploys nuevos.

**Requisitos en el N5:** el repo en `D:\Projectos\prosolutions_inventario_web` y un `.env.docker` en la misma carpeta — se genera copiando **`.env.docker.example`** y rellenando los valores (la plantilla lista todo lo usado con comentarios). Obligatorias en el compose actual: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `POSTGRES_PASSWORD` y `CRON_SECRET`. Además **`TRUST_PROXY_SECRET` es obligatorio en producción** (ver la sección de variables fijadas más abajo): sin él los headers de IP de proxy no se validan y el rate limit por cliente queda expuesto a forjado desde la LAN.

---

## Despliegue en Minisforum N5 Pro + Cloudflare

Tu aplicación está publicada en Cloudflare como:

| Publicado en Cloudflare | URL interna (origen) |
|-------------------------|----------------------|
| **reficio.app** | `http://app:3000` |

- **El túnel NO usa el puerto publicado del host.** El contenedor `cloudflared_tunnel` está conectado a la red interna de Docker `prosolutions_prosolutions-network` y alcanza la app por el **nombre del servicio** del compose: `http://app:3000` (el nombre de contenedor `prosolutions-app:3000` también resuelve en esa red). La config del tunnel vive en el dashboard de Cloudflare (Zero Trust → Networks → Tunnels), no en este repo.
- Esto es obligatorio, no opcional: el compose publica el 3005 solo en loopback (`127.0.0.1:3005`) y en la IP LAN del taller (`APP_BIND_IP`) — `host.docker.internal:3005` podría no responder según la interfaz por la que entre, y la red interna es el único camino garantizado.
- El puerto **3005** del host existe para acceso directo del taller (LAN) y para pruebas en loopback; Cloudflare no depende de él.
- **Postura LAN/HTTP:** el acceso normal de mostrador es `https://reficio.app`. `http://<ip-lan>:3005` es contingencia/diagnóstico en red de confianza: credenciales y cookies viajan en claro dentro de la LAN, así que se recomienda VLAN/aislamiento si hay equipos ajenos. Además, con `NEXTAUTH_URL=https://reficio.app` NextAuth emite la cookie de login como `__Secure-authjs.session-token` con `Secure`; los navegadores no la aceptan/devuelven por HTTP LAN, así que el login directo LAN no arranca sesión con la configuración normal. Para contingencia real hay que cambiar temporalmente `NEXTAUTH_URL` a `http://<ip-lan>:3005`, recrear `app` y revertir después. El detalle operativo está en `docs/MINISFORUM-N5-ESTADO.md` → “Acceso directo LAN (taller)”.
- Si algún día **cloudflared** corriera directamente en el host (hoy corre en Docker), el origen sería `http://127.0.0.1:3005`.

**Pasos rápidos en Portainer (N5):**

1. **Stacks** → **Add stack** → nombre: `prosolutions`.
2. **Build method:** Repository → URL del repo (o Web editor pegando el `docker-compose.yml`).
3. Añadir variables de entorno (ver tabla más abajo); mínimo: `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://reficio.app`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `CRON_SECRET`.
4. **Deploy**. La app quedará en `http://<ip-del-n5>:3005` y Cloudflare seguirá sirviendo `https://reficio.app`.

---

## Cómo averiguar la info del stack anterior

Si necesitas recuperar la configuración que tenías (nombre del stack, variables de entorno, puertos, etc.) antes de recrearlo:

### Desde Portainer (en el N5)

1. **Ver el compose y las env del stack**
   - **Stacks** → haz clic en el stack (ej. `prosolutions`).
   - **Editor**: verás el YAML del compose que usa ese stack.
   - **Environment variables**: en la misma pantalla o en la configuración del stack suele aparecer la lista de variables que Portainer inyecta (a veces como “Env” en cada servicio).
2. **Copiar antes de borrar**
   - Abre el editor del stack y copia el YAML a un archivo local.
   - Anota o exporta las variables de entorno que veas (nombre y valor) en un `.env` o documento.
3. **Ver qué contenedores tenía**
   - **Containers**: lista de contenedores del stack (ej. `prosolutions-app`, `prosolutions-bot`, `prosolutions-db`).
   - En cada contenedor → **Inspect** / **Logs** para ver env y estado.

### Desde el N5 por SSH (si tienes acceso)

Con `ssh dgali@100.124.116.70` (o el usuario que uses):

```powershell
# Ver contenedores en ejecución y sus env (PowerShell)
docker ps -a
docker inspect prosolutions-app --format '{{range .Config.Env}}{{println .}}{{end}}'
docker inspect prosolutions-bot --format '{{range .Config.Env}}{{println .}}{{end}}'
```

En Windows con Docker, el compose que usó Portainer suele estar en la carpeta del stack; si el stack se creó desde “Repository”, Portainer clona en una ruta interna. Puedes buscar:

```powershell
# Buscar dónde está el repo/clone que usa Portainer (ruta típica en Windows)
Get-ChildItem -Path C:\ProgramData\Portainer -Recurse -Filter "docker-compose.yml" -ErrorAction SilentlyContinue
# O en tu carpeta de proyectos
Get-ChildItem -Path D:\Projectos -Recurse -Filter "docker-compose.yml" -ErrorAction SilentlyContinue
```

Así ves el `docker-compose.yml` que corresponde al stack y si hay un `.env` junto a él.

### Desde este repositorio (origen de verdad)

La definición actual del stack está en el repo:

| Archivo | Qué contiene |
|---------|----------------|
| `docker-compose.yml` | Servicios `app`, `bot`, `db`, `migrate` (perfil), redes, volúmenes, puerto 3005 (5432 ya no se publica al host). |
| `.env` | Variables que la app espera (`NEXTAUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, VAPID, etc.). No se sube al repo. |

Para “recrear igual” que antes: usa el mismo `docker-compose.yml` del repo y las mismas variables que tenías en Portainer o en tu `.env` local.

---

## 1. Eliminar el stack anterior (opcional)

1. Entra en **Portainer** → **Stacks**.
2. Localiza el stack de ProSolutions (ej. `prosolutions` o el nombre que le hayas puesto).
3. **Remove the stack** (marca la opción de eliminar volúmenes solo si quieres borrar también la base de datos).

---

## 2. Crear un stack nuevo

### Opción A: Desde el repositorio Git (recomendado)

1. **Stacks** → **+ Add stack**.
2. **Name:** `prosolutions` (o el que prefieras).
3. **Build method:** elige **Repository**.
4. **Repository URL:**  
   `https://github.com/codeaeternum/prosolutions_inventario_web`
5. **Repository reference:** `main`.
6. **Compose path:** `docker-compose.yml` (por defecto).
7. En **Environment variables** (o en el editor si tu Portainer lo tiene), añade al menos:
   - `NEXTAUTH_SECRET` — una clave larga y aleatoria.
   - `TELEGRAM_BOT_TOKEN` — token del bot de Telegram.
   - Opcionales: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` si usas notificaciones push.
8. **Deploy the stack**.

### Opción B: Pegar el compose (si las imágenes ya están construidas en el N5)

1. **Stacks** → **+ Add stack**.
2. **Name:** `prosolutions`.
3. **Build method:** **Web editor**.
4. Pega el contenido de **`docker-compose.portainer.yml`** del repo (sin `build`; usa imágenes `prosolutions-app:latest`, `prosolutions-bot:latest`). Antes, en el N5: `docker compose -f docker-compose.yml build`.
5. Añade las mismas variables de entorno que arriba en la sección correspondiente de Portainer.
6. **Deploy the stack**.

---

## 3. Variables de entorno recomendadas

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `NEXTAUTH_SECRET` | Sí | Clave para JWT/sesiones (genera una con `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Sí | URL pública de la app, ej. `https://reficio.app` |
| `TELEGRAM_BOT_TOKEN` | Sí | Token del bot de Telegram |
| `DATABASE_URL` | Sí | `postgresql://prosolutions:<POSTGRES_PASSWORD>@db:5432/prosolutions_db` |
| `POSTGRES_PASSWORD` | Sí | Contraseña del servicio `db`; debe coincidir con la de `DATABASE_URL` |
| `CRON_SECRET` | Sí | Secreto del endpoint de tareas programadas |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No | Clave pública VAPID para web push |
| `VAPID_PRIVATE_KEY` | No | Clave privada VAPID |
| `VAPID_EMAIL` | No | Email para VAPID |

El compose usa `${VAR:?...}`: sin estas variables el despliegue falla al validar, no arranca con defaults inseguros.

### Variables fijadas dentro del compose (no van en el `.env`)

- `TRUST_PROXY_HEADERS: "true"` — la app va siempre tras Cloudflare Tunnel: `cloudflared` sobrescribe `CF-Connecting-IP`/`X-Forwarded-For` con la IP real del visitante y el rate limit los usa para el bucket por cliente. **Si alguna vez se publica el puerto 3005 directo a internet** (sin tunnel), hay que quitarla o ponerla en `false`: un cliente podría forjar los headers y evadir el límite.
- `TRUST_PROXY_SECRET` — **obligatoria en producción** (va en `.env.docker`, no fijada en el compose): candado de los headers de IP. El puerto 3005 también se publica en la LAN del taller, y ahí cualquier equipo puede mandar `CF-Connecting-IP` falso. Con el secreto configurado los headers de IP solo se honran si el request trae `x-origin-secret` con el mismo valor — la Transform Rule de Cloudflare lo inyecta y un peer directo no lo conoce (pasos de alta en `.env.docker.example`). Vacío = feature apagada y rate limit/auditoría expuestos a IP forjada desde la LAN.
- `REPAIR_EVIDENCE_DIR=/app/storage/repair-evidence` — volumen nombrado `repair_evidence` (como `payment_proofs`) para que las evidencias fotográficas sobrevivan a los deploys.

### Tareas programadas (cron externo)

`GET/POST /api/reservations/check-expiring` expira reservas temporales vencidas y avisa al staff. Está protegido por `CRON_SECRET` (header `Authorization: Bearer <CRON_SECRET>` o `x-cron-secret`) pero **nada lo invoca desde el stack**: el bot de Telegram ya corre su propia expiración periódica sobre la misma tabla, así que el endpoint queda como respaldo/manual.

`GET/POST /api/cron/purge-events` aplica la retención de bitácoras: borra `AuditEvent` con más de `AUDIT_RETENTION_DAYS` días (default 90, clamp 30–365) y `PlatformEvent` con más de `PLATFORM_RETENTION_DAYS` días (default 365, clamp 90–730). Mismo guard de `CRON_SECRET`. **El bot ya la corre a diario (04:25)** vía `purgeOldEvents()` — el endpoint queda como disparo manual/externo, igual que `purge-pending-signups`.

Si se quiere un disparo externo (p. ej. cron del host o un scheduler como cron-job.org):

```bash
# En el N5, cada 5 minutos (crontab -e):
*/5 * * * * curl -fsS -m 10 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3005/api/reservations/check-expiring >/dev/null 2>&1

# Retención de bitácoras, diaria a las 04:00:
0 4 * * * curl -fsS -m 30 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3005/api/cron/purge-events >/dev/null 2>&1
```

### Volúmenes (primera vez)

Los **cuatro** volúmenes de datos son **external** con nombre fijo (docker-compose.yml): `prosolutions_postgres_data`, `prosolutions_uploads`, `prosolutions_payment_proofs` y `prosolutions_repair_evidence`. En un host nuevo créalos ANTES del primer `up` — si falta cualquiera, el `up` falla:

```powershell
# docker volume create acepta UN volumen por llamada (idempotente: no-op si ya existe)
docker volume create prosolutions_postgres_data
docker volume create prosolutions_uploads
docker volume create prosolutions_payment_proofs
docker volume create prosolutions_repair_evidence
```

`deploy-n5.ps1` ya los asegura en cada deploy (mismo comando idempotente), así que esto solo hace falta a mano si despliegas sin el script.

---

## 4. Migraciones y después del deploy

- **App:** `http://<ip-n5>:3005` (puerto 3005 → 3000 del contenedor).
- **PostgreSQL:** ya **no** se publica en el host; solo la red interna `prosolutions-network` alcanza `db`.

### Migraciones: orden obligatorio

El esquema se aplica con `prisma migrate deploy` desde la imagen dedicada `prosolutions-migrate:latest` (Dockerfile target `migrate`). **La imagen final de la app no lleva Prisma CLI**: `docker exec prosolutions-app npx prisma …` ya no funciona a propósito. La app tampoco sincroniza el esquema al arrancar: un preflight (`scripts/docker-preflight.mjs`) verifica la conexión, `_prisma_migrations` sin fallos y las tablas/columnas de todas las migraciones; si falta algo, el contenedor falla de forma visible hasta que la migración se ejecute.

```powershell
# En el N5, desde la carpeta del proyecto (con .env.docker):
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d db
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker --profile migrate run --rm migrate
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d --force-recreate app bot
```

`deploy-n5.ps1` ya hace esto en ese orden y aborta si la migración falla (`deploy-n5.sh` lo dispara por SSH; `deploy.ps1` está deprecated).

### Rollback por tag SHA (sin rebuild)

Cada deploy con `deploy-n5.ps1` etiqueta las imágenes recién construidas con el SHA corto del commit — `prosolutions-app:<sha>`, `prosolutions-bot:<sha>`, `prosolutions-migrate:<sha>` — además de `:latest` (deploy-n5.ps1 líneas ~34-43). Esos tags inmutables son los puntos de retorno: volver a una build anterior es **re-tag + up**, sin recompilar nada.

**Procedimiento** (en el N5, PowerShell, carpeta del proyecto):

```powershell
# 1) Elegir el SHA destino entre los tags conservados (misma lista en bot/migrate):
docker image ls prosolutions-app

# 2) Re-etiquetar el SHA elegido como :latest — el compose usa :latest por defecto
#    (${APP_IMAGE:-prosolutions-app:latest}), así que con mover el tag basta:
docker tag prosolutions-app:<sha> prosolutions-app:latest
docker tag prosolutions-bot:<sha> prosolutions-bot:latest

# 3) Recrear app/bot con la imagen re-etiquetada:
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d --force-recreate app bot

# 4) Verificar salud y build efectivo (la consola /platform muestra el SHA horneado):
docker inspect prosolutions-app --format '{{.State.Health.Status}}'
docker logs prosolutions-app --tail 20
```

No hace falta "limpiar" nada después: el próximo deploy normal reconstruye y vuelve a apuntar `:latest` al build nuevo (el rollback queda como un tag `<sha>` más).

**Alternativa sin tocar los tags:** los compose respetan `${APP_IMAGE}`/`${BOT_IMAGE}`/`${MIGRATE_IMAGE}`, así que también vale fijar las vars solo para el comando de recreación — útil en Portainer, donde se añaden a las *Environment variables* del stack y se quitan al terminar:

```powershell
$env:APP_IMAGE = "prosolutions-app:<sha>"; $env:BOT_IMAGE = "prosolutions-bot:<sha>"
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker up -d --force-recreate app bot
Remove-Item Env:APP_IMAGE, Env:BOT_IMAGE   # si no, los siguientes up manuales quedan clavados al SHA
```

**Límite importante — el esquema NO retrocede:** `migrate deploy` solo aplica migraciones pendientes, jamás las deshace. Si entre el SHA destino y el actual hubo migraciones nuevas, la app vieja correrá contra un esquema más nuevo (puede fallar el preflight o romper en runtime): en ese caso el rollback real exige restaurar el backup anterior a esa migración (ver docs/BACKUP.md) y entonces sí correr la imagen `prosolutions-migrate:<sha>` contra la base restaurada.

**Higiene de tags:** se acumula uno por deploy. `docker image ls prosolutions-app` para listar y `docker image rm prosolutions-app:<sha-viejo>` para podar — conserva siempre el tag en producción y el anterior. El `docker image prune -f` que corre al final de cada deploy solo borra imágenes *dangling*, nunca los tags `<sha>`.

### BD vacía vs BD existente

- **BD vacía (instalación nueva):** `migrate deploy` crea todo el esquema desde `prisma/migrations/` empezando por `20250309000000_baseline`. No uses `db push`.
- **BD existente con tablas pero sin `_prisma_migrations`** (creada con `db push` antes de tener historial): `migrate deploy` falla con **P3005**. Primero verifica que el esquema real coincide con lo que crea la baseline (compara con un dump o `prisma migrate diff`), y solo entonces marca como aplicadas las migraciones ya reflejadas:

  ```bash
  npx prisma migrate resolve --applied 20250309000000_baseline
  npx prisma migrate resolve --applied 20250310000000_add_credit_module
  npx prisma migrate deploy
  npx prisma migrate status
  ```

  Hazlo con un backup verificado en la mano. Si el diff muestra diferencias, resuélvelas antes de marcar.
