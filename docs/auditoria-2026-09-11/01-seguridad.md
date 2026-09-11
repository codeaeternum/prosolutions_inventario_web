# Auditoría de seguridad — ProSolutions Inventario

Fecha: 2026-09-11. Revisión de `/Users/galindoasc/Proyectos_Sincronizados/prosolutions_inventario_web`. No se modificó código de aplicación, base real, configuración del servicio ni Telegram. Las pruebas propias de handlers usan adaptadores falsos sin conexión externa; las reproducciones HTTP y navegador del agente principal usan PostgreSQL y usuarios sintéticos en `/tmp/prosolutions-audit-20260911/work`. Se incorporó después inspección SSH autorizada de configuración real y un GET anónimo de sólo lectura; se distinguen debajo de las pruebas sintéticas.

## Dictamen

No recomiendo publicar una copia idéntica del stack actual en Internet. Existen escritura anónima del catálogo, exposición anónima de costos y comprobantes, sesiones que conservan privilegios revocados, una ruta de autoaprobación en Telegram y un limitador de login evadible. La corrección debe preceder al cambio de DNS. Esto no demuestra que alguien haya explotado producción: no se inspeccionaron logs ni se inició sesión en cuentas productivas.

Prioridades: P0 = bloquear antes de abrir nube; P1 = primera entrega de endurecimiento y consistencia; P2 = mejora posterior. Severidad y prioridad se distinguen: una condición de despliegue de gravedad crítica no significa que el entorno real esté explotado.

## Evidencia

- Pruebas propias: [harness conservado](evidencias/security-probes.cjs) y [resultados](evidencias/security-probes-results.json), **9 de 9 comprobaciones reproducidas en memoria**. Autenticación y Prisma simulados; no son un recorrido E2E de Telegram.
- HTTP sintético principal: [anónimo](evidencias/http-anonymous.json), [autenticado](evidencias/http-authenticated.json) y [archivos con fuente completa](evidencias/full-source-http.json). La prueba del marcador XSS está descrita en las [observaciones de navegador](evidencias/browser-observations.json).
- Revisión local de dependencias instaladas: `/tmp/prosolutions-audit-20260911/work/node_modules/next-pwa/{index,cache}.js`, `@auth/core/lib/utils/web.js`, componentes del router de Next. No se basa en recordar el comportamiento de versiones anteriores.
- Las rutas temporales describen el entorno original de ejecución, no archivos necesarios para leer la entrega. Las copias enlazadas están conservadas en `evidencias/`; para repetir los harness en otra máquina, ajustar las rutas como indica [Evidencia y límites](05-evidencia-y-limites.md).
- Variables locales inspeccionadas sin revelar valores: `NEXTAUTH_SECRET`, `AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, `DATABASE_URL` presentes. Después se [verificó runtime real](evidencias/desktop-runtime-config-check.json): los secretos de sesión son iguales entre sí, no coinciden con el fallback y tienen al menos 32 caracteres; CRON_SECRET está configurado. La contraseña DB sí coincide con el default Compose. Longitud y ausencia de fallback no prueban entropía suficiente. Ningún valor secreto se publicó.
- Mac no contiene metadata Git; Windows sí tiene commit y cambios locales, pero no se auditó la historia completa de secretos. `.gitignore:34` declara `.env*`, lo que no demuestra que nunca se hayan publicado secretos o archivos.

## Hallazgos

### SEC-01 — Endpoint de mantenimiento modifica catálogo sin autenticación

**Alta; P0; reproducido por HTTP con cambio real en fixture.**

Ubicación: `src/app/api/fix-catalog/route.ts:104-145`; lectura masiva `:52-100`. No importa ni ejecuta `requireAdmin`. `src/lib/auth.config.ts:68-125` tampoco bloquea APIs anónimas y el matcher no sustituye autorización del handler.

Precondición: conectividad HTTP al servicio. Una petición POST sin cookie aplica renombrados y cambios de categorías a todos los productos afectados, incluidos inactivos. El agente principal obtuvo 200, `updated:1`, y cambió un producto sintético. La operación no exige cuerpo, lo que también permite disparos accidentales desde herramientas externas. GET enumera cambios potenciales y conteo de productos activos e inactivos. Los errores devuelven `e.message` sin filtrar.

Remedio: retirar la ruta productiva y mover migración a un comando versionado con respaldo, dry-run y transacción; si debe existir como operación, exigir administrador activo, CSRF/origen, confirmación operativa e historial. No basta ocultar el enlace de UI.

Aceptación: visitante, cliente y empleado reciben 401/403 en GET/POST; ninguna fila cambia. Solo tarea de migración explícita y auditada aplica los cambios. Fixture demuestra rollback si falla una fila.

### SEC-02 — Costos internos, mayoreo y actividad expuestos en catálogo anónimo

**Alta; P0; listado reproducido HTTP sintético y confirmado con GET de sólo lectura al servicio real; detalle/búsqueda confirmados estáticamente.**

Ubicación: `src/app/api/products/route.ts:26-109`, especialmente consulta `:91-108`; `src/app/api/products/[id]/route.ts:11-59`; `src/app/api/search/pos/route.ts:5-60,71-93`. Listado y detalle usan `include` sin `select` de campos públicos y devuelven el objeto entero. Detalle ni siquiera exige `isActive:true`. El filtro `publicOnly` de búsqueda es una bandera del cliente y solo restringe stock.

Precondición: poder alcanzar el servicio HTTP. La prueba sintética anónima devolvió `costPrice`, `wholesalePrice`, stock exacto, mínimo de stock y conteo de reservas. Después, GET `/api/products?limit=1` del servicio real respondió 200 y total 98, incluyendo claves `costPrice`, `wholesalePrice` y `_count`; se conservaron sólo claves/conteos, sin filas ni importes de negocio. Esto confirma ausencia de filtrado en el listado real, **no exposición desde Internet probada**. Los campos permiten inferir márgenes y actividad cuando tienen datos. El endpoint de reservas también incluye todos los escalares del producto para el dueño (`reservations/route.ts:47-58` y `reservations/[id]/route.ts:20-31`). [Comprobación real](evidencias/desktop-runtime-config-check.json).

Remedio: DTO público con `select` explícito; separar catálogo de consulta POS y catálogo de administración. Resolver precio y disponibilidad autorizados en servidor según rol/tipo actual, nunca por bandera `publicOnly`. Restringir inactivos en detalle y creación de reservas. Acordar si stock exacto y precio mayoreo son públicos; el costo de compra debe quedar interno.

Aceptación: matrices anónimo/pendiente/cliente/técnico/tienda/empleado/admin para listado, detalle, búsqueda y reservas; snapshots de claves autorizadas y no solo valores ocultos en pantalla.

### SEC-03 — Rechazar, degradar o borrar cuentas no revoca sesiones

**Alta; P0; reproducido HTTP y en memoria.**

Ubicación: `src/lib/auth.config.ts:137-162`, `src/lib/api-auth.ts:30-65`, `src/app/api/users/[id]/route.ts:34-49,68-70`. Los claims `role/status/customerType` solo se copian cuando hay `user` en el callback de login; las consultas siguientes reutilizan el JWT hasta 30 días. Helpers revisan esos claims sin leer el usuario actual ni su estado. `requireAdmin` acepta incluso un claim `status:REJECTED`; los guards del bot revisan solo rol en `src/bot/lib/notify.ts:7-11`.

Precondición: sesión previamente válida, incluso una cookie robada. El agente principal inició sesión con admin sintético, lo cambió a `CUSTOMER/REJECTED` en BD y la misma cookie siguió obteniendo `/api/users` con 200. La eliminación puede dejar lectura/autorización viable aunque escrituras con FK fallen. Cambiar precio por tipo de cliente tampoco surte efecto hasta renovar claims. Las cuentas pendientes recién aprobadas pueden permanecer pendientes en navegador.

Remedio: resolución de identidad vigente en cada operación sensible, estado `APPROVED`, `sessionVersion` o `revokedAt`, y sesiones revocables. Compartir guardas entre web y bot. Duración menor para administradores, renovación controlada, cierre de todas las sesiones y auditoría de cambios de privilegios. Bloquear borrado del último admin y preferir desactivar usuarios con historia financiera.

Aceptación: degradación/rechazo/borrado y cambio de tipo invalidan acceso inmediatamente con cookie anterior. Contraseña cambiada revoca sesiones; SSE existente deja de entregar datos; bot vuelve a evaluar rol/estado al confirmar una operación.

### SEC-04 — Registro Telegram por texto evita aprobación

**Alta; P0; reproducido ejecutando los handlers reales con mocks.**

Ubicación: `src/bot/commands/products.ts:373-395`; flujo contrastante `src/bot/commands/users.ts:181-231`; enrutamiento de números `src/bot/commands/sales.ts:208-212`.

Precondición: usuario nuevo en el wizard, paso de meta mensual. Escribir `5000` como mensaje produce `status:'APPROVED'`; pulsar el botón equivalente produce `PENDING` y notificación para aprobación. El cliente también conserva directamente su tipo elegido `STORE`. El guard inicial de reservar permite APPROVED. La prueba en memoria obtiene exactamente un usuario APPROVED para texto y uno PENDING para botón, con idénticos datos sintéticos; Telegram real **NO EJECUTADO**.

Remedio: un solo servicio de registro invocado por ambas entradas, guardar tipo solicitado por separado y aplicar política uniforme. Revisar cuentas creadas históricamente por la rama textual con logs/fechas, sin presumir abuso. Revalidar aprobación dentro de `processReservation` (actualmente `catalog.ts:305-306` solo verifica existencia) y al finalizar todos los wizards.

Aceptación: texto, botón, mensaje repetido, callback viejo y reintento crean como máximo una cuenta PENDING, notifican una vez y no habilitan reservas hasta aprobación real.

### SEC-05 — Comprobantes de pago almacenados y servidos como archivos públicos

**Alta; P0; acceso anónimo y cache pública de un año reproducidos por HTTP.**

Ubicación: `src/bot/commands/products.ts:224-229` guarda en `public/uploads/payments`; `src/app/uploads/[[...path]]/route.ts:5-38` sirve cualquier archivo bajo uploads sin sesión y con `Cache-Control: public, max-age=31536000, immutable`; exclusión de uploads en `src/middleware.ts:22`. La ruta web para datos de reserva puede estar protegida, pero el objeto comprobante no.

Precondición: conocer o recibir el enlace del comprobante; no se afirma que se pueda enumerar eficientemente. HTTP sin cookie recibió la imagen fixture con 200. Cuando el archivo existía antes de iniciar Next se sirvió como estático con `public,max-age=0`; el agente principal también creó un archivo después del arranque y recibió 200 con `public,max-age=31536000,immutable` desde el catch-all. Ambos son públicos. Los comprobantes pueden contener nombres, bancos, referencias y datos financieros.

Remedio: almacenar pagos fuera de `public` en bucket privado, con metadatos y relación owner/reservation. Endpoint autenticado autorizado o URL firmada breve, `Cache-Control: private,no-store`; imágenes de productos sí pueden ser públicas. Separar permisos de contenedor/bucket y aplicar retención acordada. Invalidar caches antiguos al migrar; simplemente proteger la página no protege archivos ya publicados.

Aceptación: visitante, otro cliente y empleado sin permiso no obtienen contenido con URL conocida; dueño/admin autorizado sí; URL caducada falla. Verificar tanto archivo preexistente como archivo subido después del arranque. La migración no incluye comprobantes en assets estáticos, imagen Docker ni service worker.

### SEC-06 — XSS mediante callbackUrl después del login

**Alta; P0; reproducido en navegador con usuario y marcador sintéticos.**

Ubicación: `src/app/(auth)/login/page.tsx:43,90-100`. `callbackUrl` sale de query y después de `signIn(...redirect:false)` se entrega directamente a `router.push`. La normalización segura de redirects del servidor Auth.js no aplica a este `router.push`. En Next instalado, `app-router-instance.js:207-222,280-283` construye URL y determina origen; navegación externa usa `location.assign` (`app-router.js:202-209`). No hay allowlist de protocolo ni origen en el código de la app.

Precondición: usuario sigue un enlace de login preparado y completa login. Permite salida a sitio externo y ejecución de JavaScript bajo el origen autenticado. El agente principal abrió login con callback `javascript:document.title='AUDIT_CALLBACK_EXECUTED';void(0)`, inició sesión con usuario ficticio y observó el título cambiado, confirmado en árbol de accesibilidad. No se leyeron cookies ni se exfiltraron datos. Una carga abusiva podría leer datos de las APIs con la sesión del usuario o realizar acciones autorizadas por ese usuario, incluso con cookie HttpOnly. La CSP actual es report-only y no impidió la ejecución.

Remedio: aceptar únicamente rutas locales normalizadas con `new URL` y mismo origen `http/https`; rechazar `javascript:`, `data:`, URLs externas y dobles barras, usar fallback por rol; evitar propagar query sin validar. Agregar CSP efectiva como defensa adicional, no como sustituto.

Aceptación: `callbackUrl` externo, `//host`, `javascript:`, variantes con mayúsculas/espacios/codificación y ruta interna válida; solo la última se permite. Repetir el marcador local sin lectura de cookies ni tráfico externo y comprobar que ya no se ejecuta.

### SEC-07 — Limitador de intentos de login evadible

**Alta; P0; dos mecanismos reproducidos en memoria, uno independiente del proxy.**

Ubicación: `src/app/api/auth/[...nextauth]/route.ts:16-34`; `src/lib/rate-limit.ts:7,15-20,48-55`.

1. El limitador busca `identifier/password/credentials` literalmente en el body crudo. Form encoding permite codificar los nombres de campos: Auth.js usa `URLSearchParams` (`@auth/core/lib/utils/web.js:13-15`) y los reconoce, pero el limitador no. La prueba deja pasar diez peticiones normales, bloquea la once con 429 y vuelve a delegar 200 para claves codificadas, misma IP. El 200 corresponde al handler auth simulado; no demuestra contraseña válida ni login real.
2. La llave de IP toma `x-forwarded-for` del request sin determinar proxy confiable. Cambiar su primer valor cambia el bucket. El despliegue directo que publica 3005 o un proxy que añada en vez de sobrescribir el header deja el bypass disponible.

Además el Map es por proceso, se pierde al reiniciar, no comparte límites entre réplicas y nunca elimina keys vacías. Registro tiene mismo problema de IP; contraseñas web admiten mínimo de seis caracteres y no hay máximo antes de bcrypt. Diferencias de error/tiempo facilitan enumeración, aunque mensajes visibles concretos dependen de Auth.js.

Remedio: limitar siempre POST al callback de credenciales sin heurística del cuerpo; implementar además limitador cerca de authorize por cuenta normalizada e IP autenticada de proxy. Store compartido con TTL y límites globales; registrar eventos sin contraseñas; normalización de correo/teléfono, política de contraseñas y MFA para admins.

Aceptación: límite cuenta/IP para form y JSON, claves escapadas, headers manipulados, múltiples réplicas y reinicios; fallback conservador si rate store falla. No bloquear a todos los clientes bajo un NAT por una sola cuenta.

### SEC-08 — Políticas EMPLOYEE distintas en página y API

**Media-alta; P1; confirmado estático.**

Ubicación: `src/lib/auth.config.ts:97-102` prohíbe páginas `/admin/usuarios`, `/admin/credito`, `/admin/reportes`, mientras `/api/users` usa `requireAdminOrEmployee` (`users/route.ts:9`) y devuelve correo/teléfono/Telegram/rol/límite y saldo (`:32-44`); `/api/reports` también lo permite (`reports/route.ts:15`) e incluye ranking de clientes con email y últimas reservas.

Precondición: cuenta EMPLOYEE. Omitir UI y llamar API permite leer datos restringidos por la política visible. Parte de los datos de cliente puede ser necesaria en POS; no hace falta entregar un directorio financiero completo para buscarlos.

Remedio: matriz explícita de capacidades (vender, consultar cliente limitado, gestionar crédito, ver margen/reportes, configurar) aplicada en servicios y consultas; DTO reducido para selector de clientes; mantener página y API alineados.

Aceptación: para cada capability, probar ruta de pantalla y todos los endpoints; empleado carece de campos de crédito/email masivo si no tiene permiso, aunque añada filtros `role/status/search`.

### SEC-09 — Secretos de ejemplo y publicación de PostgreSQL en compose

**Crítica si PostgreSQL es alcanzable desde una red no confiable con esa credencial; P0; default DB y publicación en interfaces confirmados en producción, acceso desde Internet no verificado.**

Ubicación: `docker-compose.yml:23-32,110-115`, `docker-compose.portainer.yml:11-16,61-66`. BD expone `5432:5432` en todas las interfaces y credenciales estáticas conocidas en fuente; sesiones caen en secreto fijo si falta variable. `src/lib/env.ts:30-39` solo valida que exista, por tanto no detecta fallback débil. App expone 3005 directamente.

En el escritorio, la comparación de la contraseña DB real contra el default Compose dio **true**, sin emitir el valor. PostgreSQL publica 5432 en todas las interfaces del host. No se probó alcance desde Internet ni se cambió la configuración productiva. En contraste, AUTH_SECRET/NEXTAUTH_SECRET reales son iguales entre sí, tienen al menos 32 caracteres y no coinciden con el fallback; las sesiones no se deben describir como configuradas con el secreto fijo. [Configuración real sin secretos](evidencias/desktop-runtime-config-check.json).

Remedio P0: rotar la contraseña DB coordinando su actualización en app y bot y verificando reconexión; todavía no realizado. Quitar/restringir puertos externos de DB, red interna/private networking, usuario de app de privilegio mínimo, secretos obligatorios sin defaults, TLS donde BD viaje por red, acceso de administración por túnel/VPN, app detrás de TLS/reverse proxy y firewall cerrado salvo 443/administración restringida. No basta editar la variable Compose: la credencial del rol PostgreSQL y los clientes deben quedar coordinados.

Aceptación: scan desde otra red autorizada detecta solo puertos previstos; app sin secreto válido falla al arrancar; rol app no puede DDL, leer otras bases ni crear roles.

### SEC-10 — Seed y contexto Docker pueden filtrar credenciales/datos

**Alta si se usa seed/default o hay archivos sensibles; P0 de despliegue; confirmado estático, contenidos adicionales hipotéticos.**

Ubicación: `prisma/seed.ts:249-263,427-429` crea admin con contraseña predeterminada si falta `ADMIN_PASSWORD` y luego imprime la contraseña en texto. La `.env` inspeccionada no define `ADMIN_PASSWORD`, aunque no se ejecutó seed ni se comprobaron cuentas reales. `.dockerignore:1-8` excluye `.env` exacta pero no `.env.*`, dumps ni `public/uploads`; `Dockerfile.bot:12` copia todo y no cambia de root. `Dockerfile:39` copia todo `public` a la imagen final.

Remedio: bootstrap separado con secreto aleatorio obligatorio, ninguna impresión, cambio requerido al primer acceso; imágenes nunca deben contener uploads ni respaldos, ni envs. `.dockerignore` restrictivo y build desde checkout limpio/artefacto, bot no-root, dependencias productivas y fijadas, secrets montados/runtime.

Aceptación: inspección automatizada del contexto y capas construidas sin secretos/PII; seed se niega a crear cuenta sin password segura y no la imprime; bootstrap no recrea ni resetea admin existente de forma inesperada.

### SEC-11 — Datos privados persistidos entre usuarios en navegador

**Media; P1; confirmado estático; PWA adicional latente.**

Ubicación: `src/hooks/use-notifications.ts:32-50,75-82`; se guardan hasta 50 payloads bajo key global sin usuario. Payload de nuevo registro incluye email/teléfono (`api/auth/register/route.ts:92-101`). Logout `components/admin/header.tsx:86` no borra datos. Header de empleado muestra el mismo dropdown (`:60`), que carga localStorage antes de comprobar autorización SSE. Quien usa luego el mismo perfil del navegador puede ver las notificaciones anteriores; un 401 nuevo de SSE no borra historial.

La configuración PWA (`next.config.ts:4-9`) no define exclusiones; next-pwa default cachea GET APIs y páginas, 24h (`cache.js:128-167`), y precachea todo `public` (`index.js:141-165`). Prueba propia confirma que `/api/users`, `/api/credit/movements` y `/admin/usuarios` coinciden. **Sin embargo build actual Turbopack no generó worker y `/sw.js` devuelve 404; no se demuestra fuga vía CacheStorage en este build.** Reparar PWA sin corregir sus defaults activaría este riesgo, incluido precache de comprobantes si están presentes durante build.

Remedio: historial servidor autorizado por usuario, o cache local mínima por identidad con borrado de logout y cambio de usuario. PWA solo assets públicos; NetworkOnly para auth/APIs/admin/tickets/archivos privados; no precache uploads. Estado offline explícito para no mostrar stock/saldos obsoletos como actuales.

Aceptación: login admin A, recibir evento sintético, logout, entrar empleado/cliente B, offline y timeout de red: B no ve datos de A. Inspeccionar CacheStorage y bundles de worker, no solo UI.

### SEC-12 — Subidas y parser Excel carecen de límites consistentes

**Media; P1; confirmado estático; caída no provocada.**

Ubicación: imágenes web `src/app/api/upload/product/route.ts:16-46` confían en MIME declarado y extensión; el cuerpo ya se parseó antes del límite 5MB. Excel `src/app/api/products/excel/route.ts:97-110` carga el archivo y workbook completo sin tamaño, tipo, número de filas o límite de trabajo. Bot `src/bot/commands/products.ts:169-208,218-238` descarga a disco sin timeout, status HTTP, tamaño o manejadores de error de request/file stream, y el callback asíncrono está fuera del try/catch exterior.

Precondición: administrador importando/subiendo, o cliente con reserva subiendo comprobante en bot. Un archivo de tercero puede agotar memoria, disco o parser; errores de streams pueden abortar bot. No se afirma ejecución de HTML por imágenes: extensiones limitadas, MIME de respuesta y nosniff reducen esa vía.

Remedio: máximo de request en proxy y handler, validar firma real/redecodificar imagen, dimensiones/píxeles, cuotas y expiración de archivos huérfanos. Imports a worker con límites de filas/memoria/tiempo y preview; errores controlados y escritura temporal + rename atómico en bot. Evaluar reemplazo del parser vulnerable según auditoría de dependencias del agente principal.

Aceptación: archivo de formato falso, corrupto, demasiado grande, bomba de dimensiones/compresión, error de red/disco y reintento: error controlado, bot/app siguen saludables, ningún archivo parcial público ni cambio parcial oculto.

### SEC-13 — Comandos y mensajes Telegram sin aislamiento de chat ni escaping

**Media; P1; confirmado estático; configuración BotFather/grupos no verificada.**

Ubicación: `src/bot/lib/guards.ts:11-18` solo valida remitente; `src/bot/commands/reports.ts:77-108` responde saldos de caja al chat actual. No se encontró guard de `ctx.chat.type === 'private'`. Un administrador ejecutando comandos en grupo puede publicar información sensible a todos, aunque el rol del remitente sea correcto. Las sesiones indexadas únicamente por telegramId tampoco aíslan conversación de grupo y chat privado.

Nombres/comercio introducidos por usuario se insertan sin escapar en HTML/Markdown de notificación (`users.ts:215-231`, `products.ts:395`, `notify.ts:30`). Puede generar enlaces/formatos engañosos o errores de Telegram; no equivale a XSS navegador.

Remedio: exigir chat privado en todas las operaciones administrativas/registro/financieras, y desactivar grupos si no tienen propósito. Escape de texto dinámico, parse mode seguro, límites de longitud, y sesión con usuario+chat+TTL; confirmar privilegio antes de mutar.

Aceptación: mismo usuario admin en grupo recibe respuesta neutra por privado y no revela saldos; nombres con caracteres HTML/Markdown aparecen literalmente; sesiones expiradas/callbacks viejos no completan operaciones.

### SEC-14 — Regla pública '/' anula fallback de pendientes y CSP no se aplica

**Baja-media; P2; lógica reproducida en memoria.**

Ubicación: `src/lib/auth.config.ts:40,48-53,120-123`. `pathname.startsWith('/')` hace verdadero `isPublicPath` para toda ruta absoluta, así que el fallback de cuentas PENDING nunca se activa. Las guardas explícitas de `/admin` y protegidas anteriores sí siguen ejecutándose; no presentar esto como bypass universal de admin. Facilita errores en futuras rutas que confíen en el fallback.

CSP `next.config.ts:41-55` es report-only, permite unsafe-inline/eval y no tiene destino de reportes; aporta poca protección/telemetría frente a una inyección. Sí hay X-Frame-Options, nosniff, referrer policy, permissions policy y HSTS en producción.

Remedio: comparar rutas exactas y prefijos con separador, negar por defecto para API privada, y tests por rol/estado. CSP efectiva gradual con nonces/hash según render, report endpoint y política reducida; mantener soporte de QR/cámara explícito.

Aceptación: ruta nueva protegida falla con pendiente y anónimo salvo allowlist explícita; reportes CSP llegan al destino y policy enforce bloquea un script fixture no autorizado.

## Controles que sí existen

- Reservas GET por id validan owner/admin (`reservations/[id]/route.ts:52-54`), crédito del cliente usa su propio id; no se encontró un IDOR directo en esos caminos.
- Mutaciones de categorías, modelos, marcas, usuarios, settings, productos, Excel y varias operaciones de reservas usan helpers de rol. La excepción de mantenimiento importa y debe eliminarse.
- Cron de expiración falla cerrado si falta secret y valida Bearer/header; no se invocó contra producción.
- Contraseñas se hashean con bcrypt coste 12 y nunca se devuelven en GET usuarios. Existe aprobación de registro web y separación de requestedCustomerType.
- SQL raw revisado emplea templates parametrizados; el Prisma.raw de búsqueda solo incorpora fragmentos estáticos elegidos por booleano. No se identificó SQL injection en esas consultas.
- Upload web usa nombre aleatorio, extensiones de imagen permitidas y rechazo de '..' en catch-all. No se encontró traversal utilizable desde la URL con el mecanismo revisado.
- Etiquetas imprimibles escapan nombre/barcode antes de document.write; no reportar ese uso como XSS sin más.
- Web Docker sí corre como usuario no-root. `.gitignore` incluye `.env*`; el historial de secretos no se auditó y no se puede afirmar ausencia de secretos publicados. Estos controles no compensan los fallos anteriores.

## Plan de seguridad propuesto

### Fase 0 — antes de migrar, 1-3 días de trabajo

Cerrar mantenimiento HTTP, DTO público, almacenamiento privado de comprobantes, callback seguro, revocación vigente, unificar registro Telegram y rate-limit. Hacer snapshot/restauración de fixture y suite de aceptación. Retirar credenciales default y exposición DB del manifiesto de nube. No habilitar PWA cache con configuración actual.

### Fase 1 — 3-7 días adicionales, integrada con integridad de negocio

Política de capacidades, usuarios activos/desactivados, MFA admin, sesiones y eventos de seguridad, guardas compartidas web/bot, scripts bootstrap seguros. Saneamiento de uploads/imports, retención de comprobantes, payloads mínimos y limpieza navegador. Coordinar con el agente funcional la transaccionalidad e idempotencia de ventas, devoluciones, reservas y crédito: son controles de integridad esenciales, no solamente bugs contables.

### Fase 2 — operación sostenida

Logs estructurados sin datos/secretos innecesarios, monitoreo de autorización/errores/429, notificaciones de logins nuevos y privilegios, restore drills, rotación y expiración de secretos, inventario/SBOM y actualizaciones con gate de CI, CSP aplicada, ejercicio de incidente y bitácora no editable de acciones financieras. Acceso de soporte temporal con permisos explícitos, no credenciales admin compartidas.

Estimaciones son orientativas para desarrollo y QA, no compromiso de plazo; dependen del modelo de roles, volumen, archivos existentes y disponibilidad de quien valida operación. Auditoría histórica, pentest externo, revisión legal, prueba con usuarios reales, seguridad de la máquina de escritorio y BotFather quedan **NO EJECUTADOS**.

## Decisiones de negocio que conviene confirmar

1. ¿Qué debe poder ver/hacer exactamente un empleado? Especialmente costos, crédito, reportes, cierre de caja y devoluciones.
2. ¿Catálogo, stock exacto y mayoreo deben ser públicos o requieren cliente aprobado?
3. ¿El único objetivo de aprobación es precio especial o también prevenir reservas anónimas/abuso?
4. ¿Cuánto tiempo se conservan comprobantes, movimientos y datos personales? ¿Cuántas personas usan el mismo navegador/caja?
5. ¿Bot debe funcionar solo por mensaje privado? ¿Quién administra BotFather y rotación del token?
6. ¿Hay cuentas admin compartidas, MFA, email verificable y medio de recuperación?
