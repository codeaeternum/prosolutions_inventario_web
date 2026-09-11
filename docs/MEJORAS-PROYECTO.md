# Mejoras posibles en el proyecto — ProSolutions Inventario

Documento de referencia con mejoras priorizadas por impacto y esfuerzo. No todo es obligatorio; elegir según tiempo y necesidades.

---

## 1. UX y consistencia

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **Página 404 (not-found)** | Añadir `app/not-found.tsx` con mensaje amigable y enlace al inicio. Ahora las rutas inexistentes muestran la de Next.js por defecto. | Bajo |
| **Error global (error.tsx)** | Añadir `app/error.tsx` (y opcional `app/global-error.tsx`) para capturar errores de render y mostrar un mensaje + “Reintentar” en lugar del fallback de Next. | Bajo |
| **Loading por ruta** | Añadir `loading.tsx` en rutas pesadas (admin, catálogo, reservas) para mostrar skeleton o spinner mientras carga, en lugar de pantalla en blanco. | Medio |
| **Estados vacíos unificados** | Algunas listas ya tienen “No hay X”; revisar que todas (usuarios, marcas, modelos, categorías, reportes) tengan mensaje y opcional CTA (ej. “Crear el primero”). | Bajo |
| **Confirmaciones destructivas** | Sustituir `confirm()` por un modal (AlertDialog) en acciones como eliminar producto, vaciar carrito, cancelar reserva, para mejor UX en móvil. | Medio |

---

## 2. Seguridad y robustez

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **Validación de entrada en APIs** | Usar **Zod** (ya en el proyecto) en rutas POST/PUT para validar body y query (productos, reservas, usuarios, settings). Evita datos malformados y da errores 400 claros. | Medio |
| **Rate limiting** | Limitar peticiones por IP en login, registro y APIs sensibles (ej. `@upstash/ratelimit` o middleware simple en memoria) para mitigar fuerza bruta y abuso. | Medio |
| **Health check enriquecido** | En `GET /api/health`: comprobar conexión a BD (y opcionalmente que existan tablas clave) y devolver `{ status, db, timestamp }`. Útil para monitoreo y despliegue. | Bajo |
| **CSP (Content-Security-Policy)** | Añadir cabecera CSP en `next.config.ts` (report-only al principio) para reducir riesgo de XSS e inyección. Ajustar según scripts/estilos que uses. | Medio |

---

## 3. Rendimiento

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **Imágenes con prioridad** | En listados (catálogo, productos) usar `priority` en las primeras imágenes y `loading="lazy"` en el resto. Next/Image ya optimiza; revisar que no falte `sizes` en grids. | Bajo |
| **Paginación en listados grandes** | Donde se carguen muchos ítems (productos, movimientos, reservas), asegurar paginación en API y en UI (ya hay en algunos; revisar que sea consistente). | Bajo–medio |
| **Evitar re-fetch innecesarios** | En páginas que usan `useEffect` + `fetch`, valorar React Query o SWR para cache, dedup y revalidación, sobre todo en admin. | Medio |

---

## 4. PWA y móvil

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **Aviso de actualización PWA** | Si el service worker detecta nueva versión, mostrar un pequeño banner “Nueva versión disponible – Recargar”. | Medio |
| **Meta y Open Graph** | En `layout.tsx` o por página: `openGraph`, `twitter:card`, `description` y si aplica `apple-mobile-web-app-capable`. Mejora al compartir enlaces y al “Añadir a pantalla de inicio”. | Bajo |
| **Safe area en móvil** | Revisar que botones fijos (nav inferior, banners) usen `env(safe-area-inset-bottom)` donde haga falta para no quedar bajo el notch o la barra de gestos. | Bajo |

---

## 5. Operaciones y despliegue

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **README del proyecto** | Sustituir el README por defecto por uno breve: qué es el proyecto, requisitos (Node, PostgreSQL), `.env` necesario, `npm run dev` / `docker compose up`, enlaces a `docs/` (PORTAINER-STACK, PWA-DUENO, AUDIT). | Bajo |
| **Health en Docker** | El healthcheck ya usa `/api/health`. Opcional: que el endpoint devuelva 503 si la BD no responde, para que el orquestador reintente o marque el contenedor como unhealthy. | Bajo |
| **Logs estructurados** | Sustituir progresivamente `console.log/error` por un logger (p. ej. pino) con nivel y formato JSON en producción, para integrar con agregadores de logs. | Medio |
| **Backup de BD** | Documentar (o scriptear) backup periódico de PostgreSQL (pg_dump) si los datos son críticos; no implementado en el repo. | Bajo (doc) / Medio (script) |

---

## 6. Calidad de código y tests

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **Tests E2E** | Añadir Playwright (o Cypress) para flujos clave: login, listar productos, crear reserva, admin verificar QR. Ejecutables en CI o antes de desplegar. | Alto |
| **Tests de API** | Ampliar tests (Vitest) a rutas críticas: auth, reservas, inventario, reportes; mockeando Prisma o usando BD de test. | Medio |
| **npm audit** | Ejecutar `npm audit` y aplicar `npm audit fix` (o resolver a mano) las vulnerabilidades que marque; documentado como pendiente en AUDIT.md. | Bajo |
| **Tipado estricto** | Revisar `strict` en `tsconfig.json` y eliminar `as any` o aserciones innecesarias donde queden (p. ej. en el bot). | Bajo |

---

## 7. Funcionalidad

| Mejora | Descripción | Esfuerzo |
|--------|-------------|----------|
| **Búsqueda y filtros** | En listados admin (productos, reservas, movimientos), unificar criterios de búsqueda y filtros (por estado, fecha, etc.) donde aún sea manual o incompleto. | Medio |
| **Exportar datos** | Ya existe export Excel en productos; valorar export (Excel o CSV) para reservas y reportes, para el dueño. | Bajo–medio |
| **Notificaciones push web** | Ya tienes VAPID; completar suscripción y envío desde el backend para avisar al dueño (ej. “Nueva reserva”) en el navegador/PWA sin depender solo de Telegram. | Medio |
| **Recordatorio de sesión** | Opcional: avisar antes de que expire la sesión (NextAuth) y ofrecer “Prolongar” para no cortar al usuario a mitad de una operación. | Bajo |

---

## 8. Resumen por prioridad

- **Rápido y útil**: not-found, error.tsx, README, health con DB, meta/OG, safe area.
- **Seguridad y calidad**: validación Zod en APIs, rate limiting, npm audit, CSP (report-only).
- **UX**: loading.tsx, confirmaciones con AlertDialog, estados vacíos.
- **Más adelante**: E2E, logger estructurado, aviso actualización PWA, export reservas/reportes.

---

## 9. Hecho en este repo

| Mejora | Estado |
|--------|--------|
| Página 404 (not-found) | ✅ `app/not-found.tsx` |
| Error global (error.tsx) | ✅ `app/error.tsx` |
| README útil | ✅ README.md con requisitos, .env, scripts, docs |
| Health con comprobación de BD | ✅ `GET /api/health` devuelve 200 + `db: "connected"` o 503 + `db: "disconnected"` |
| Loading por ruta | ✅ `app/loading.tsx`, `admin/loading.tsx`, `catalogo/loading.tsx`, `mis-reservas/loading.tsx`, `carrito/loading.tsx` + `LoadingSpinner` |
| Meta y Open Graph | ✅ `metadataBase`, `openGraph`, `twitter`, `robots` en `layout.tsx` |
| Validación Zod en APIs | ✅ `POST /api/reservations`, `POST /api/auth/register`, `POST /api/products`, `POST /api/brands`, `POST /api/categories`, `POST /api/models` |
| Confirmación con AlertDialog | ✅ Eliminar: producto (`admin/productos/[id]`), marca (`admin/marcas`), categoría (`admin/categorias`), modelo (`admin/modelos`), movimiento (`admin/movimientos`) — modal en lugar de `confirm()` |
| Rate limiting (login/registro) | ✅ Límite en memoria: login 10 intentos / 15 min por IP, registro 5 / 15 min. `lib/rate-limit.ts`; aplicado en `api/auth/[...nextauth]` (POST) y `api/auth/register` |
| CSP (report-only) | ✅ Cabecera `Content-Security-Policy-Report-Only` en `next.config.ts` (script, style, font, img, connect, frame-ancestors, base-uri, form-action). Revisar reportes y pasar a enforce cuando no haya violaciones. |
| Safe area en móvil | ✅ Clase `safe-area-bottom` en `globals.css`; aplicada a `MobileNav` y `PwaInstallBanner` para respetar notch/barra de gestos en iOS. |
| Aviso de actualización PWA | ✅ `PwaUpdateBanner`: al recibir `controllerchange` del service worker muestra banner superior “Nueva versión disponible” + botón Recargar. Comprueba actualizaciones al recuperar foco. |
| npm audit | ✅ Next.js actualizado a 16.1.6 (parches de seguridad). Resumen de vulnerabilidades restantes y recomendaciones en `docs/NPM-AUDIT.md`. |
