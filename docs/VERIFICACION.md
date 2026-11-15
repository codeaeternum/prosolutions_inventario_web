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
| **prosolutions-db** | Up (healthy), sin puerto al host — solo red interna `prosolutions-network` (app/bot lo alcanzan como `db:5432`; PortBindings vacío en prod) |
| **.env** | Existe; variables: NEXTAUTH_SECRET, NEXTAUTH_URL, TELEGRAM_BOT_TOKEN, VAPID_*, etc. |
| **Puertos en uso** | 3000, 3001, 3005, 3010, 3011, 5432, 5433, 6380, 8000, 8010, 8081, 9443, 9888, … (ver docs/MINISFORUM-N5-ESTADO.md) |
| **Otros stacks** | AeternaSuite (3010, 3011, 5433, 6380), Portainer, cloudflared, Immich, Uptime Kuma, etc. |

Estado detallado del host y todos los contenedores: **docs/MINISFORUM-N5-ESTADO.md**.

---

## Resumen (última verificación)

| Comando | Resultado |
|---------|-----------|
| `npm run build` | OK — Next.js 16.4.5, Prisma generate, compilación y generación de rutas correctas. |
| `npx tsc --noEmit` | OK — Sin errores de TypeScript (incluye tests). |
| `npm test` | OK — tests unitarios (Vitest) pasando. |
| `docker compose -f docker-compose.yml config` | OK — Compose válido. |
| `docker compose -f docker-compose.portainer.yml config` | OK — Compose Portainer válido. |
| `npm run lint` | Ejecuta ESLint directo sobre `src` y `scripts` con `--max-warnings 0` (Next 16 ya no tiene `next lint`). |
| `npm run lint:eslint` | ESLint sobre `src` y `scripts` sin límite de warnings (reporte completo). |
| `npm run typecheck` | `tsc --noEmit`. |

## Correcciones aplicadas durante la verificación

1. **Tests (TypeScript):**
   - `src/__tests__/lib/auth.config.test.ts`: sustituido `NextURL` por `URL` (compatible con Next 16).
   - `src/lib/get-paginated-items.ts`: añadidos `total?` y `page?` al tipo del primer argumento para que los tests que pasan objetos con paginación tipen correctamente.

2. **Errores críticos (ESLint):**
   - `src/app/catalogo/page.tsx`: los `useState` de los diálogos (selectedProduct, detailsProduct, reservationOpen, detailsOpen, quantity) se movieron al inicio del componente, antes de cualquier `return`, para cumplir las reglas de los hooks.
   - `src/app/error.tsx`: el enlace "Ir al inicio" pasó de `<a href="/">` a `<Link href="/">` (next/link).

## Comandos recomendados antes de desplegar

```bash
npm run typecheck
npm test
npm run build
docker compose -f docker-compose.yml config
# La migración en producción la ejecuta el servicio/imagen "migrate"
# (docker compose --profile migrate run --rm migrate), nunca db push ni el arranque de la app.
```

---

## Pruebas E2E

Suite de regresión con Playwright (`e2e/`, config en `playwright.config.ts`). Corre contra un servidor YA levantado — nunca arranca `next dev` sola (puede no haber BD local).

### Comandos

```bash
# Suite pública contra producción (segura: solo lectura — GET, render,
# validación client-side y localStorage; ningún POST que persista datos).
E2E_BASE_URL=https://reficio.app npm run test:e2e

# Contra un dev server local ya levantado en :3000
npm run test:e2e

# Que Playwright arroque el dev server por ti (opt-in)
E2E_START_DEV=1 npm run test:e2e

# UI interactiva de Playwright
npm run test:e2e:ui
```

### Variables de entorno

| Variable | Efecto |
|----------|--------|
| `E2E_BASE_URL` | URL base (default `http://localhost:3000`). Usa `https://reficio.app` para la suite pública contra producción. |
| `E2E_START_DEV=1` | Arranca `npm run dev` como webServer (reusa uno ya levantado). |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Habilita los specs con sesión (`admin-smoke`, bloque "requiere sesión" de `tenant-isolation`). La cuenta debe ser rol **ADMIN** aprobado en la BD del ambiente. Sin ellas esos specs se auto-skipean. |
| `E2E_ALLOW_WRITES=1` | Desbloquea specs que ESCRIBEN en el servidor (ventas, reservas). **Solo con ambiente desechable — nunca contra reficio.app.** |

### Cobertura

| Archivo | Qué cubre | ¿Sesión? |
|---------|-----------|----------|
| `public-pages.spec.ts` | Smoke de `/`, `/login`, `/catalogo`, `/seguimiento` (folio inexistente → error amable), `/registro`, `/mercado`, `/recuperar`, `/verificar` y `/verificar/<qr basura>`: HTTP 200, landmarks reales, sin `pageerror` ni artefactos (`[object Object]`, `undefined`, `NaN`). | No |
| `auth-flow.spec.ts` | Login inválido → error inline sin redirect; `/admin*` sin sesión → `/login`; rutas legacy (`/carrito`, `/mis-reservas`, `/perfil`) → `/?redirect=bot`; `/recuperar` con respuesta uniforme anti-enumeración. | No |
| `cart-flow.spec.ts` | Carrito anónimo: `cart:public` en localStorage hidrata el badge del header; "Agregar" sin sesión → `/login?callbackUrl=/catalogo`; `/carrito` anónimo rebota a `/?redirect=bot`. | No |
| `tenant-isolation.spec.ts` | Fugas cross-tenant vía localStorage (caché legacy de notificaciones, `cart:{businessId}`, preferencia `reficio-branch`). | No / gated |
| `admin-smoke.spec.ts` | Login admin → dashboard + sidebar, POS (`/admin/ventas`), `/admin/reportes`, `/carrito` con sesión (quitar item, sync localStorage). | Sí — `E2E_ADMIN_*` |

### Proyectos y seguridad

- **chromium** (Desktop Chrome): toda la suite. **mobile-chrome** (Pixel 7): solo los specs públicos — responsive smoke barato.
- Contra **producción** solo es segura la suite pública + los specs con sesión de solo-lectura. Cualquier spec futuro que persista datos debe vivir en el describe `escritura — ambiente desechable` de `admin-smoke.spec.ts`, gated por `E2E_ALLOW_WRITES=1`.

Verificado: `E2E_BASE_URL=https://reficio.app npx playwright test` → **46 passed, 11 skipped** (los de sesión, sin credenciales).
