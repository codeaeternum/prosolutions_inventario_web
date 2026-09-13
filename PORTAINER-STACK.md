# Recrear el stack en Portainer (N5 Pro)

**Referencia del host:** Para una foto fiel de puertos, servicios y variables en el Minisforum N5 Pro (y no equivocarse al desplegar otras apps), ver **[docs/MINISFORUM-N5-ESTADO.md](docs/MINISFORUM-N5-ESTADO.md)**.

---

## Despliegue sin pasos manuales (todo desde el N5 Pro)

**Se hace todo desde el N5 Pro** (Cursor y el proyecto están en el N5). En la carpeta del proyecto:

```powershell
.\deploy.ps1
```

o bien `.\deploy-n5.ps1`. Eso hace en esta máquina: **build** de las imágenes (incluida `prosolutions-migrate`) → **db** → **`prisma migrate deploy`** → **up** de `app`/`bot` con `docker-compose.portainer.yml` y tu `.env` → **espera a que `/api/health` reporte healthy**. Si la migración falla, el script se detiene y la app nueva no se promueve. No hace falta abrir Portainer ni SSH.

**Requisitos en el N5:** Tener el repo (clonado o esta carpeta) y un `.env` en la misma carpeta con `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `POSTGRES_PASSWORD` y `CRON_SECRET` (todas obligatorias en el compose actual).

*(Si algún día trabajas desde otro PC y quieres desplegar en el N5 por SSH: `.\deploy.ps1 -Remote`.)*

---

## Despliegue en Minisforum N5 Pro + Cloudflare

Tu aplicación está publicada en Cloudflare como:

| Publicado en Cloudflare | URL interna (origen) |
|-------------------------|----------------------|
| **reficio.app** | `http://host.docker.internal:3005` |

- El stack expone la app en el puerto **3005** del host (`3005:3000` en el compose).
- Si el agente de Cloudflare Tunnel (**cloudflared**) corre **dentro de Docker**, `http://host.docker.internal:3005` es correcto: así el contenedor del tunnel alcanza el puerto 3005 del host donde escucha la app.
- Si **cloudflared** corre **directamente en el N5** (no en Docker), en la config del tunnel usa `http://127.0.0.1:3005` o `http://localhost:3005` en lugar de `host.docker.internal`.

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

Con `ssh dgali@100.106.83.19` (o el usuario que uses):

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

### Volúmenes (primera vez)

`postgres_data` y `uploads` son volúmenes **external** con nombre fijo (`prosolutions_postgres_data`, `prosolutions_uploads`). En un host nuevo créalos antes del primer `up`:

```bash
docker volume create prosolutions_postgres_data
docker volume create prosolutions_uploads
```

---

## 4. Migraciones y después del deploy

- **App:** `http://<ip-n5>:3005` (puerto 3005 → 3000 del contenedor).
- **PostgreSQL:** ya **no** se publica en el host; solo la red interna `prosolutions-network` alcanza `db`.

### Migraciones: orden obligatorio

El esquema se aplica con `prisma migrate deploy` desde la imagen dedicada `prosolutions-migrate:latest` (Dockerfile target `migrate`). **La imagen final de la app no lleva Prisma CLI**: `docker exec prosolutions-app npx prisma …` ya no funciona a propósito. La app tampoco sincroniza el esquema al arrancar: un preflight (`scripts/docker-preflight.mjs`) verifica la conexión, `_prisma_migrations` sin fallos y las tablas/columnas de todas las migraciones; si falta algo, el contenedor falla de forma visible hasta que la migración se ejecute.

```powershell
# En el N5, desde la carpeta del proyecto (con .env):
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env up -d db
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env --profile migrate run --rm migrate
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env up -d --force-recreate app bot
```

Los scripts `deploy.ps1` / `deploy-n5.ps1` / `deploy-n5.sh` ya hacen esto en ese orden y abortan si la migración falla.

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
