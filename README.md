# Pro-Solutions Inventario

Sistema de inventario, reservas y ventas para refacciones de celulares. Incluye web (Next.js), API REST, bot de Telegram y PWA para el dueño.

## Requisitos

- **Node.js** 20+
- **PostgreSQL** 16 (o compatible)
- **npm** o pnpm

## Configuración rápida

1. Clonar el repositorio e instalar dependencias:

```bash
npm install
```

2. Crear `.env` en la raíz con al menos:

```env
DATABASE_URL="postgresql://usuario:contraseña@localhost:5432/nombre_bd"
NEXTAUTH_SECRET="una-clave-secreta-larga-y-aleatoria"
NEXTAUTH_URL="http://localhost:3000"
```

Para el bot de Telegram (opcional):

```env
TELEGRAM_BOT_TOKEN="token_de_BotFather"
```

3. Crear la base de datos y aplicar las migraciones:

```bash
npm run db:deploy
npm run db:seed   # opcional: datos de ejemplo
```

(No uses `db:push`: deja la base sin historial de migraciones y `migrate deploy` fallará después con P3005.)

4. Arrancar en desarrollo:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Next.js en desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Servidor de producción (tras `build`) |
| `npm run db:deploy` | Aplica migraciones pendientes (`prisma migrate deploy`) |
| `npm run db:migrate` | `prisma migrate dev` (crear/aplicar migraciones en desarrollo) |
| `npm run db:status` | Estado de migraciones aplicadas/pendientes |
| `npm run db:seed` | Carga datos iniciales (opcional) |
| `npm run db:studio` | Abre Prisma Studio |
| `npm run bot:dev` | Bot de Telegram en desarrollo |
| `npm run bot:start` | Bot de Telegram (producción) |
| `npm run pwa:icons` | Genera iconos PWA desde `public/logo.jpg` |
| `npm run test` | Tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint sobre `src` y `scripts` (falla con warnings) |

## Despliegue con Docker

Build y ejecución local:

```bash
docker compose build
docker compose up -d
```

La app queda en el puerto **3005** (mapeado desde el 3000 del contenedor). El despliegue ordenado es: build → `db` → `migrate` (`prisma migrate deploy`) → `app`/`bot` → health. Detalles y paso de migración manual en **PORTAINER-STACK.md**.

## Documentación

- **[PORTAINER-STACK.md](PORTAINER-STACK.md)** — Despliegue en Portainer (N5, Cloudflare, migraciones, etc.)
- **[docs/PWA-DUENO.md](docs/PWA-DUENO.md)** — PWA para el dueño: instalar en el móvil y escanear QR
- **[docs/APP-IOS-DUENO.md](docs/APP-IOS-DUENO.md)** — Opciones de app iOS
- **[docs/MEJORAS-PROYECTO.md](docs/MEJORAS-PROYECTO.md)** — Mejoras posibles del proyecto
- **AUDIT-MODULOS.md** y **docs/auditoria-2026-09-11/** — Auditorías de seguridad, módulos y operación
- **src/bot/BOT-FUNCIONAMIENTO.md** — Cómo funciona el bot de Telegram

## Estructura breve

- `src/app` — Next.js App Router (páginas y APIs)
- `src/components` — Componentes reutilizables y UI
- `src/lib` — Auth, Prisma, utilidades
- `src/bot` — Bot de Telegram (Telegraf)
- `prisma` — Esquema y seed de la BD

## Licencia

Uso interno / privado según corresponda.
