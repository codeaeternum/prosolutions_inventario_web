# Rotación de secretos — ProSolutions

Runbook para rotar los secretos del stack en producción (N5). Cada sección
cubre: dónde vive el secreto, qué rompe rotarlo, el procedimiento paso a paso
y cómo verificar. Regla general:

- Los valores viven en `.env.docker` (deploys CLI con `deploy-n5.ps1`) y/o en
  las *Environment variables* del stack de Portainer — **hay que actualizar
  ambos si el deploy alterna entre los dos caminos**, o la siguiente
  promoción revive el secreto viejo.
- Después de editar variables, el contenedor se recrea: `docker compose
  --env-file .env.docker up -d` (compose v2 recrea solo los servicios cuya
  configuración cambió) o *Update the stack* en Portainer.
- Generación de valores nuevos: `openssl rand -hex 32` (hex) u
  `openssl rand -base64 32`. Nunca reutilizar valores entre secretos ni entre
  ambientes (piloto/producción).

| Secreto | Rotar invalida… | ¿Requiere ventana de mantenimiento? |
|---|---|---|
| `POSTGRES_PASSWORD` | nada si se coordina (ALTER USER + env a la vez) | sí, breve (segundos de reconexión) |
| `NEXTAUTH_SECRET` | **todas las sesiones de todos los usuarios** | no, pero avisar: todos re-ingresan |
| `TELEGRAM_BOT_TOKEN` | el bot hasta que se actualice (minutos) | sí, breve |
| `CRON_SECRET` | solo los llamadores externos de `/api/cron/*` | no |
| `DEVICE_SECRET_KEY` | **los PIN/patrones de equipos ya cifrados** — ver la trampa | planear con cuidado |

---

## POSTGRES_PASSWORD

La contraseña vive en dos lugares que deben cambiar a la vez: el usuario
`prosolutions` dentro de PostgreSQL y la `DATABASE_URL` que consumen
app/bot/migrate (además del propio `POSTGRES_PASSWORD` del servicio `db`).

**Trampa de la imagen postgres:** `POSTGRES_PASSWORD` solo se aplica la
primera vez que se inicializa el volumen de datos. Cambiar la variable y
recrear el contenedor **no cambia la contraseña real** — hay que alterar el
usuario dentro de la base.

Procedimiento:

```bash
# 1) Generar y guardar la nueva contraseña (en tu gestor, no en el chat).
NEW_PASS=$(openssl rand -hex 24)

# 2) Alterar el usuario DENTRO de la base viva (con la contraseña actual):
docker exec -i prosolutions-db psql -U prosolutions -d prosolutions_db \
  -c "ALTER USER prosolutions WITH PASSWORD '<nueva>';"

# 3) Actualizar .env.docker (y el stack de Portainer) A LA VEZ:
#    POSTGRES_PASSWORD=<nueva>
#    DATABASE_URL=postgresql://prosolutions:<nueva>@db:5432/prosolutions_db?schema=public

# 4) Recrear el stack: app/bot/db arrancan ya con la credencial nueva.
docker compose --env-file .env.docker up -d
```

Verificación: `docker exec prosolutions-db pg_isready` y un login de humo en
la app. Si algo falla, la contraseña vieja ya no existe dentro de la base —
el rollback es repetir el ALTER USER con el valor anterior.

## NEXTAUTH_SECRET

Firma/cifra las cookies JWT de sesión (el compose lo copia también a
`AUTH_SECRET`; el cambio rápido de usuario de `/api/auth/switch` lo usa para
mintear). Rotarlo **invalida todas las sesiones activas de la plataforma**:
cada usuario vuelve a ingresar con su contraseña en su siguiente request. No
hay pérdida de datos, pero conviene avisar al staff.

**⚠ Trampa con DEVICE_SECRET_KEY — leer antes de rotar:** si
`DEVICE_SECRET_KEY` **nunca se fijó**, los PIN/patrones de desbloqueo de los
equipos se cifraron derivando la clave de `NEXTAUTH_SECRET` (ver la sección
de `DEVICE_SECRET_KEY` abajo). Rotar `NEXTAUTH_SECRET` a secas **rompe el
descifrado de todos los PIN almacenados**. El camino seguro es fijar primero
`DEVICE_SECRET_KEY` con el procedimiento de abajo y solo después rotar el
secreto de sesión.

Procedimiento:

```bash
# 0) Confirmar que DEVICE_SECRET_KEY ya está fijada (o aplicar primero la
#    sección siguiente).
# 1) NEXTAUTH_SECRET=<nueva> en .env.docker y en el stack de Portainer.
# 2) docker compose --env-file .env.docker up -d  (solo se recrea app)
```

Verificación: login con una cuenta real; las cookies viejas mueren solas
(sesión null → redirect a /login, no error de datos).

## TELEGRAM_BOT_TOKEN

Lo consumen el servicio `bot` (polling) y la app (deep-links de verificación
`t.me/<bot>?start=verify_*`, notificaciones). Se revoca/regenera con
@BotFather en Telegram (`/revoke` → seleccionar el bot → nuevo token). El
token viejo **muere en el momento de revocarlo**: el bot deja de responder
hasta que el stack recibe el nuevo.

Procedimiento: revocar en BotFather → actualizar `TELEGRAM_BOT_TOKEN` en
`.env.docker` y Portainer → `up -d` (se recrean bot y app) → verificar con
`docker logs prosolutions-bot --tail 20` que el polling arrancó sin 401 y con
un `/start` de prueba al bot.

## CRON_SECRET

Candado de `/api/cron/*` y `/api/reservations/check-expiring` (header
`Authorization: Bearer` o `x-cron-secret`, comparación timing-safe). **Nada
dentro del stack lo invoca**: el bot corre las purgas y la expiración de
reservas internamente — los endpoints son el disparo manual/externo
(documentado en PORTAINER-STACK.md con ejemplos de crontab curl).

Rotarlo no afecta operación alguna del stack; solo hay que actualizar el
mismo valor en cualquier scheduler externo que se haya configurado (crontab
del host, Uptime-Kuma con push, scripts manuales). Procedimiento: generar
nuevo → actualizar env → `up -d` (se recrea app) → actualizar los crontab
externos. Verificación manual:

```bash
curl -fsS -m 10 -H "Authorization: Bearer <nueva>" \
  http://127.0.0.1:3005/api/reservations/check-expiring
```

## DEVICE_SECRET_KEY

Cifra en reposo el PIN/patrón/contraseña de desbloqueo que el cliente deja en
recepción del taller (`RepairOrder.deviceAccessValue`, AES-256-GCM, formato
`v1:<iv>:<tag>:<cipher>` en base64).

**Cómo se deriva la clave (verificado en `src/lib/device-secret.ts`):**

```ts
const raw = (process.env.DEVICE_SECRET_KEY || process.env.NEXTAUTH_SECRET || "").trim()
// el material se decodifica (hex/base64 si aplica) y se deriva con sha256
```

Es decir: **si `DEVICE_SECRET_KEY` nunca se fijó, la clave efectiva se deriva
de `NEXTAUTH_SECRET`**. Consecuencias exactas:

1. **Rotar `NEXTAUTH_SECRET` rompe el descifrado de todos los PIN ya
   cifrados.** GCM detecta la clave equivocada al verificar la etiqueta y
   `decryptAccessValue` lanza; la ficha del equipo (`/api/workshop/[id]`)
   atrapa el error y sirve el dato como `null` — el PIN queda ilegible para
   siempre. No hay pérdida de la orden ni de la reparación, solo del código
   de desbloqueo (habría que pedírselo de nuevo al cliente).
2. **No existe re-cifrado lazy.** Los valores se cifran una sola vez al crear
   la orden (`encryptAccessValue` en `lib/domain/workshop.ts`) y jamás se
   reescriben después: ninguna lectura/actualización migra el ciphertext a
   una clave nueva. Los valores heredados en texto plano (sin prefijo `v1:`)
   no se ven afectados — se leen tal cual.
3. Fijar `DEVICE_SECRET_KEY` con un valor DISTINTO por primera vez **también
   es una rotación** para los ciphertexts existentes: la clave efectiva
   cambia aunque `NEXTAUTH_SECRET` se quede igual.

**Procedimiento recomendado (sin pérdida):**

```bash
# 1) Fijar DEVICE_SECRET_KEY al MISMO valor string que tiene hoy
#    NEXTAUTH_SECRET. La derivación sha256 es idéntica, así que todos los
#    PIN existentes siguen descifrando — pero la clave de dispositivos
#    queda "congelada" en este valor, independiente del secreto de sesión.
DEVICE_SECRET_KEY=<valor actual de NEXTAUTH_SECRET>

# 2) Recrear app. A partir de aquí NEXTAUTH_SECRET puede rotarse libremente
#    (sección anterior) sin tocar los PIN del taller.
```

**Si se quiere una DEVICE_SECRET_KEY verdaderamente independiente** (distinta
del secreto de sesión actual), no hay camino sin pérdida implementado: habría
que escribir una migración única que lea cada `deviceAccessValue` con la
clave vieja y lo reescriba con la nueva (hoy ese script **no existe**). La
alternativa es aceptar el impacto: las órdenes cifradas con la clave anterior
leen `null` y el PIN se vuelve a pedir al cliente; las órdenes nuevas ya
cifran con la clave dedicada.

Una vez fijada, rotar `DEVICE_SECRET_KEY` en el futuro tiene el mismo coste
(los ciphertexts viejos quedan ilegibles) — por eso conviene tratarla como un
secreto de larga vida, con custodia en el gestor de contraseñas del negocio.

---

## Anexo: TRUST_PROXY_SECRET

No cifra nada en reposo: es el candado compartido entre la Transform Rule de
Cloudflare (`x-origin-secret`) y el gate de headers de proxy del rate limit.
Rotarlo exige coordinar los dos extremos en la misma ventana (primero la
Transform Rule en el dashboard de Cloudflare, después el env + recreate del
stack — en ese orden hay segundos donde los headers de IP no se honran y el
tráfico web cae al bucket compartido `direct-clients`: el rate limit se
endurece solo, no se cae el servicio). Sin ventana de mantenimiento real;
evitar rotarlo en hora pico del taller.
