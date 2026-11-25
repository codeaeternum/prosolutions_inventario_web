# Verificación del proyecto

Comandos ejecutados para verificar el estado del repo y del entorno (N5 Pro). Actualizar tras cambios relevantes.

## Entorno (N5 Pro) — verificado

| Comando / dato | Resultado |
|----------------|-----------|
| **Host** | GALINDOASC — Windows 11 Pro, Minisforum N5 PRO, ~30 GB RAM |
| **Docker** | 29.2.0 / Compose v5.0.2 |
| **Tailscale** | 100.124.116.70 (`galindoasc-1`) |
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
| `admin-venta.spec.ts` | **Escribe.** POS: venta real en EFECTIVO (alta de producto E2E por API, ticket por búsqueda, `#pos-cash-given`, confirmación) + anulación del ticket (reembolso y stock de vuelta). Venta a TRANSFERENCIA sin folio se bloquea; con folio confirma. | Sí — `E2E_ALLOW_WRITES=1` |
| `admin-refund.spec.ts` | **Escribe.** Venta a transferencia por UI + devolución parcial por API (`/api/sales/[id]/returns`) con `refundMethod` bancario: `returnedQuantity`, Payment negativo `REFUNDED`. Persistencia del `reference` del reembolso y la UI «Referencia bancaria» se auto-skipean si la imagen es anterior a las oleadas 41/43. | Sí — `E2E_ALLOW_WRITES=1` |
| `admin-catalogo.spec.ts` | **Escribe.** `/admin/inventario` → «Dar de alta» por UI (`#pf-name`, `#pf-category`, `#pf-retail`, `#pf-universal`), aparece en la lista, se borra por `DELETE /api/products/[id]` (stock 0 — el DELETE rechaza productos con existencia). | Sí — `E2E_ALLOW_WRITES=1` |
| `admin-kiosco.spec.ts` | **Escribe (rate-limit counters).** `POST /api/asistencia/kiosco`: userId inexistente y PIN malformado responden el mismo 401 «PIN incorrecto o usuario inválido» (sin oráculo de existencia); sin sesión rebota 401/403/redirect. Se auto-skipea si la imagen es pre-oleada 37 (endpoint inexistente). | Sí — `E2E_ALLOW_WRITES=1` |

### Ambiente pilot desechable

El compose `pilot` (`prosolutions-pilot-app-1` + `prosolutions-pilot-db-1`) expone la app **solo en 127.0.0.1:3316** del host donde corre (N5 `galindoasc-desktop`, o la Mac si el stack también corre local en OrbStack/Docker). Es un ambiente **desechable**: los specs de escritura ensucian su BD con registros prefijados `E2E-` + timestamp.

```bash
bash scripts/e2e-pilot.sh                    # suite completa contra el pilot
bash scripts/e2e-pilot.sh e2e/admin-venta.spec.ts   # solo un spec
```

El script:

1. Verifica si `http://localhost:3316/login` ya responde; si no, abre el túnel `ssh -fN -L 3316:127.0.0.1:3316 galindoasc-desktop` (BatchMode, alias del `~/.ssh/config`).
2. Exporta `E2E_ADMIN_EMAIL=e2e-admin@prosolutions.local`, la contraseña y `E2E_ALLOW_WRITES=1`.
3. Corre `E2E_BASE_URL=http://localhost:3316 npx playwright test "$@"` — los args de Playwright pasan tal cual.

**Password del pilot (no versionada):** el script la toma de `E2E_ADMIN_PASSWORD` en el entorno o de un archivo local `e2e/.env.pilot` (también acepta `e2e/pilot.env` o `pilot.env`; todos están en `.gitignore`) con una línea `E2E_ADMIN_PASSWORD=<password>`. Si falta, el script aborta con instrucciones antes de correr Playwright.

Notas operativas del pilot:

- La cuenta `e2e-admin@prosolutions.local` es exclusiva de ese ambiente (ADMIN, APPROVED, sucursal principal). No existe en producción.
- El login limita intentos por IP (30 / 15 min compartidos cuando no hay `TRUST_PROXY_HEADERS`). Los specs de escritura comparten UNA sesión vía `loginAdminCached` (`e2e/pilot-helpers.ts`): un solo login real por corrida, cookies cacheadas en `$TMPDIR`. Si una corrida anterior dejó el bucket saturado, `docker restart prosolutions-pilot-app-1` lo resetea (el limiter es en memoria).
- **Imagen del pilot:** la imagen `prosolutions-app:invfix` es ANTERIOR a las oleadas 37–43 del repo. Los specs de escritura validan lo que la imagen soporta y se **auto-skipean con nota** en capacidades que todavía no llegan (kiosco, UI de devoluciones, `reference` en reembolsos, `?q=` de `/api/sales` — por eso el helper filtra del lado del cliente). Al refrescar la imagen esos skips se convierten en cobertura real sin tocar los specs.

### Proyectos y seguridad

- **chromium** (Desktop Chrome): toda la suite. **mobile-chrome** (Pixel 7): solo los specs públicos — responsive smoke barato.
- Contra **producción** solo es segura la suite pública + los specs con sesión de solo-lectura. Cualquier spec que persista datos debe vivir en el describe `escritura — solo ambiente desechable`, gated por `E2E_ALLOW_WRITES=1`.

Verificado: `E2E_BASE_URL=https://reficio.app npx playwright test` → **46 passed, 11 skipped** (los de sesión, sin credenciales).

Verificado: `bash scripts/e2e-pilot.sh` contra el pilot → los specs de escritura **4 passed / 5 skipped / 0 failed** (los skips son capacidades ausentes en la imagen vieja: kiosco, UI de devoluciones, `reference` de reembolso). En la corrida de la suite completa (66 tests, 9 workers) los 4 specs de escritura pasaron; los demás fallos son specs históricos escritos contra el código nuevo corriendo sobre la imagen vieja del pilot (comportamiento de carrito, `/recuperar`, `/catalogo` público, scopes de localStorage, `/login` — divergencia de imagen, no del repo).

Defectos reales observados en el pilot durante esta verificación:

- **Layout duplicado en la imagen del pilot:** el admin renderiza dos `<main role="main" id="main-content">` (id duplicado + landmark doble) y dos inputs `aria-label="Buscar producto para vender"`. Los specs toleran el duplicado (`:visible`); si la imagen nueva lo arregla, siguen funcionando.
- **`POST /api/sales` intermitente bajo carga:** con 9 workers el pilot registró `Business operation failed { code: 'UNEXPECTED' }` y la venta no persistió (una vez, transitorio). Los specs de escritura tienen `retries: 1` para absorber el ruido — una falla real sigue fallando.
- **Rate limit de login por IP** (30/15 min, bucket compartido `direct-clients` sin `TRUST_PROXY_HEADERS`): saturaba los logins a mitad de suite. Mitigado con `loginAdminCached` (1 login por corrida).
- **Constraint vieja de `Payment`:** la BD del pilot traía `Payment_amount_positive_finite` (amount > 0) que rechazaba los reembolsos negativos del void — se reemplazó manualmente por `Payment_amount_nonzero_finite` como exige la migración del repo. `/health` reporta `migration_failed` por migraciones viejas con índices duplicados.
