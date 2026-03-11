# Verificación del proyecto

Comandos ejecutados para verificar el estado del repo y del entorno (N5 Pro). Actualizar tras cambios relevantes.

## Entorno (N5 Pro) — verificado

| Comando / dato | Resultado |
|----------------|-----------|
| **Host** | GALINDOASC — Windows 11 Pro, Minisforum N5 PRO, ~30 GB RAM |
| **Docker** | 29.2.0 / Compose v5.0.2 |
| **Tailscale** | 100.106.83.19 |
| **prosolutions-app** | Up, health **healthy** (wget + start_period en uso), 3005→3000 |
| **prosolutions-bot** | Up |
| **prosolutions-db** | Up (healthy), 5432→5432 |
| **.env** | Existe; variables: NEXTAUTH_SECRET, NEXTAUTH_URL, TELEGRAM_BOT_TOKEN, VAPID_*, etc. |
| **Puertos en uso** | 3000, 3001, 3005, 3010, 3011, 5432, 5433, 6380, 8000, 8010, 8081, 9443, 9888, … (ver docs/MINISFORUM-N5-ESTADO.md) |
| **Otros stacks** | AeternaSuite (3010, 3011, 5433, 6380), Portainer, cloudflared, Immich, Uptime Kuma, etc. |

Estado detallado del host y todos los contenedores: **docs/MINISFORUM-N5-ESTADO.md**.

---

## Resumen (última verificación)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | OK — Next.js 16.1.6, Prisma generate, compilación y generación de rutas correctas. |
| `npx tsc --noEmit` | OK — Sin errores de TypeScript (incluye tests). |
| `npm test` | OK — 21 tests (Vitest) pasando. |
| `docker compose -f docker-compose.yml config` | OK — Compose válido. |
| `docker compose -f docker-compose.portainer.yml config` | OK — Compose Portainer válido. |
| `npm run lint` | En algunos entornos (p. ej. Windows) puede fallar con "Invalid project directory .../lint". Alternativa: `npm run lint:eslint`. |
| `npm run lint:eslint` | Ejecuta ESLint sobre `src`. Puede reportar warnings/errors de estilo y hooks; los críticos (hooks condicionales, uso de `<Link>`) están corregidos. |

## Correcciones aplicadas durante la verificación

1. **Tests (TypeScript):**
   - `src/__tests__/lib/auth.config.test.ts`: sustituido `NextURL` por `URL` (compatible con Next 16).
   - `src/lib/get-paginated-items.ts`: añadidos `total?` y `page?` al tipo del primer argumento para que los tests que pasan objetos con paginación tipen correctamente.

2. **Errores críticos (ESLint):**
   - `src/app/catalogo/page.tsx`: los `useState` de los diálogos (selectedProduct, detailsProduct, reservationOpen, detailsOpen, quantity) se movieron al inicio del componente, antes de cualquier `return`, para cumplir las reglas de los hooks.
   - `src/app/error.tsx`: el enlace "Ir al inicio" pasó de `<a href="/">` a `<Link href="/">` (next/link).

## Comandos recomendados antes de desplegar

```bash
npm run build
npm test
docker compose -f docker-compose.yml config
# Opcional: npm run lint:eslint
```
