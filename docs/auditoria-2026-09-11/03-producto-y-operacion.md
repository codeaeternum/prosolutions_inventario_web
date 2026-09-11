# Auditoría de producto, interfaz y operaciones — ProSolutions

Fecha de lectura: 2026-09-11. Fuente: `/Users/galindoasc/Proyectos_Sincronizados/prosolutions_inventario_web`. Este anexo contiene la revisión estática de producto y operación. Las pruebas de ejecución, la inspección posterior del escritorio y la recuperación de datos se documentan en [evidencia y límites](05-evidencia-y-limites.md) y [escritorio](06-escritorio-y-datos-reales.md). No se ejecutaron flujos Telegram ni pruebas de cámara física. Las referencias son rutas relativas a esta raíz y líneas de los archivos observados.

## Conclusión

El producto ya tiene catálogo, inventario por compatibilidad, POS, reservas web/bot, crédito, caja, tickets, etiquetas QR y PWA. La prioridad debe ser cerrar flujos incompletos y definir una sola operación transaccional por venta/reserva antes de ampliar módulos. Migrar el Compose sin cambios sí elimina la dependencia eléctrica del escritorio, pero conserva riesgos de integridad, despliegue y recuperación. Falta demostrar restauración de BD + archivos y funcionamiento productivo PWA.

Las ramas web cliente y experiencia de inicio no reflejan una decisión de producto única: inicio orientado exclusivamente a Telegram frente a navegación global que todavía ofrece catálogo, carrito y reservas. El usuario confirmó durante esta auditoría que la tienda es de un amigo reparador y el público sí debe consultar precios/disponibilidad/fotos y reservar o pagar pantallas; por ello conviene mantener y arreglar un catálogo web simple, con Telegram como canal complementario. Hay 2–3 usuarios simultáneos como máximo, poco uso/prueba, deseo de quitar repetición/exceso y tolerancia a caída breve, pero no a perder datos.

**Recomendación ajustada a ese contexto:** conservar inventario/catálogo, reserva, venta/caja/ticket y una administración corta. Fusionar entradas duplicadas, relegar crédito/metas/IA/push a módulos opcionales solo si realmente se usan; evitar Redis, réplicas, microservicios o multiubicación por anticipado. Una instancia sencilla con app y worker único, PostgreSQL privado, backups externos y restauración ensayada es un buen punto de partida económico. La elección/precios del proveedor los define el informe principal. Los módulos futuros de este documento son un backlog para priorizar, no una recomendación de implementarlos todos.

## Hallazgos funcionales

### U01 — P1 — Cliente no puede adjuntar el comprobante requerido

- Evidencia: `src/app/carrito/page.tsx:235-240` utiliza `ImageUpload` sin cambiar `uploadToServer`; `src/components/image-upload.tsx:23` lo predetermina a true y `:50-53` llama a `/api/upload/product`; `src/app/api/upload/product/route.ts:13-14` exige administrador. El checkout rechaza depósito sin imagen en `carrito/page.tsx:48-50`.
- Impacto: cliente aprobado elige depósito, selecciona comprobante y recibe rechazo; no puede finalizar ese flujo.
- Corrección: endpoint de comprobantes autenticado para el propietario, con almacenamiento privado y autorización al leer; mantener separado el endpoint de imagen pública de producto. Incorporar validación binaria, límites, errores y estado de carga. No resolver relajando los permisos del endpoint de productos.
- Aceptación: cliente aprobado sube comprobante; otro cliente no puede leerlo; admin autorizado puede verificar; rechazo de formato/tamaño tiene mensaje y permite reintentar.

### U02 — P1 — Catálogo cliente muestra únicamente 20 productos

- Evidencia: `src/app/catalogo/page.tsx:165-180` llama a productos sin page/limit y descarta total/totalPages; `src/app/api/products/route.ts:34-35,91-109` limita por defecto a 20. `catalogo/page.tsx:634` presenta `products.length` como cantidad de productos; no tiene paginador.
- Impacto: el comprador no descubre el resto de inventario al explorar, y un filtro con más de 20 resultados sigue incompleto. Agente principal confirmó en navegador con BD sintética de 25 activos: la UI muestra 20 y no ofrece paginación.
- Corrección: paginación o carga incremental con total real, filtros persistidos en URL y retorno de detalle que conserve posición.
- Aceptación: con 25 productos accesibles se pueden explorar los 25 y el total se muestra como 25.

### U03 — P1 — Mis reservas pierde estados y omite historial fuera de la primera página

- Evidencia: `src/app/mis-reservas/page.tsx:109-112` consulta sin paginación; API `src/app/api/reservations/route.ts:26-27,71-88` entrega 20. La clasificación de `mis-reservas/page.tsx:170-175` excluye `PENDING_PAYMENT` tanto de activas como de anteriores, aunque `src/bot/commands/catalog.ts:328` crea ese estado.
- Impacto: reservas por transferencia hechas en bot pueden desaparecer de la web. Una reserva activa antigua queda oculta si hay suficientes registros recientes.
- Corrección: modelo único de estados exhaustivo compartido con bot, pestañas consultadas al servidor por estado y paginación de activas/historial por separado.
- Aceptación: todos los valores de ReservationStatus tienen ubicación/etiqueta; una activa con más de 20 reservas posteriores sigue visible; contador se basa en total real.

### U04 — P1 — Carrito y POS confirman líneas individualmente; fallos dejan operaciones parciales

- Evidencia cliente: `src/app/carrito/page.tsx:62-81` crea una reserva por artículo. Al fallar una, llega al catch `:86-89` sin eliminar las anteriores del carrito. `clearCart()` solo ocurre tras completar todo (`:83`).
- Evidencia POS: `src/app/admin/ventas/page.tsx:208-231` crea un movimiento por artículo; crédito se registra aparte (`:235-247`), y aunque falle deuda sigue éxito y vaciado (`:254-263`). El payload `:214-220` no transmite el método seleccionado ni el cliente. Solo la venta de una línea abre ticket (`:265-267`).
- Impacto: un corte de conexión puede dejar parte de stock vendido/reservado y provocar doble operación al reintentar. Falta una venta con folio único y ticket completo. La interfaz puede anunciar éxito aun con deuda no creada.
- Corrección: endpoint de checkout por lote que reciba líneas, cliente, método e identificador idempotente y confirme una transacción; devolver folio y estado único consultable. Reconciliar resultado desconocido antes de reintentar. El agente de negocio amplía la integridad financiera y concurrencia.
- Aceptación: segunda línea inválida no altera ninguna; dos reintentos producen el mismo folio; desconexión tras commit recupera resultado; ticket suma todas las líneas y pagos.

### U05 — P1 — Escanear puede seleccionar otro SKU por coincidencia parcial

- Evidencia: `src/app/admin/ventas/page.tsx:102-105` toma `data.products[0]`. `src/app/api/search/pos/route.ts:38` hace contains por barcode y ordena por stock descendente (`:60`), además permite coincidencia textual y búsqueda aproximada.
- Escenario: código escaneado 123 coincide con 123 y 1234; si 1234 tiene más stock se agrega primero. No exige coincidencia exacta ni confirmación de ambigüedad.
- Corrección: endpoint de escaneo que resuelva igualdad exacta de código/ID; búsqueda aproximada solo para texto y selección humana.
- Aceptación: códigos con prefijos comunes agregan siempre el SKU exacto; ninguno/múltiples no agregan automáticamente.

### U06 — P2 — Precios y stock del carrito quedan congelados y se comparten entre cuentas del navegador

- Evidencia: `src/components/cart-context.tsx:32,49` usa clave global `cart`. Al reañadir SKU (`:57-60`) actualiza solo quantity y conserva precio/maxStock anteriores. No observa sesión, expiración, logout ni cambios de almacenamiento. `src/app/perfil/perfil-client.tsx:70-72` solo llama signOut. El total mostrado se calcula del snapshot local (`cart-context.tsx:87-88`).
- Impacto: al cambiar usuario NORMAL/STORE o precios del catálogo, el resumen/deposito estimado queda desactualizado; un usuario ve carrito anterior de otro. La API puede recalcular otros importes y decepcionar expectativas.
- Corrección: borrador por cuenta y validación de esquema; cotización del servidor antes de confirmar con cambios explícitos de precio/stock, expiración y limpieza al cerrar sesión.
- Aceptación: cambiar tipo de cliente/precio/stock genera resumen vigente; sesión distinta no hereda carrito sin acción explícita.

### U07 — P2 — Filtros de catálogo se remontan en cada tecla; solicitudes pueden resolver fuera de orden

- Evidencia: componente `FilterContent` se declara dentro de `CatalogoPage` en `src/app/catalogo/page.tsx:201` y se monta como `<FilterContent />` en `:582,625`. Actualiza state padre en `:211`. Los efectos `:149-158,171-189` no usan AbortController ni guard de generación. Igual patrón de búsqueda en `src/components/search-bar.tsx:42-60`.
- Impacto: por identidad nueva del componente, el campo del panel de filtros pierde foco/reinicia subtree tras actualizar; una respuesta lenta antigua puede sobrescribir filtro nuevo. Agente principal confirmó en navegador real que escribir “Pantalla” en el filtro de sidebar remonta el input y deja document.activeElement en BODY.
- Corrección: sacar componente al nivel módulo; estado/control por props; cancelar consultas anteriores y asociar resultados con parámetros vigentes.
- Aceptación: escribir una frase completa en filtro sin refoco y cambios rápidos de marca mantienen solo el último resultado.

### U08 — P2 — Buscar desde una página avanzada puede producir falso inventario vacío

- Evidencia: `src/app/admin/productos/page.tsx:70-78` usa page de URL pero search/filter de useState vacíos; `:90-93` combina el nuevo filtro con page anterior; `:114-120` no reinicia página al filtrar. El paginador se renderiza solo si hay productos (`:573-594`). Los links sí escriben search/lowStock en URL (`:580-583`), pero el componente no los recupera al montar.
- Impacto: desde página 5, filtrar por un producto único pide página 5 del resultado y muestra “Agregar primer producto” sin retorno por paginación. Recargar/enlazar pierde filtro.
- Corrección: URL como fuente única del estado, page=1 al modificar criterio y paginador/limpiar filtros disponible incluso con resultado vacío.
- Aceptación: búsqueda única desde última página encuentra registro; recargar conserva filtros.

### U09 — P2 — Etiquetas seleccionadas en otras páginas se omiten al imprimir

- Evidencia: `src/app/admin/etiquetas/page.tsx:36,63` mantiene selección global de IDs, pero sustituye products por página. `:132-134` busca ID solo en products actual y omite el resto; `:233` hace lo mismo para previsualización. `:253` sigue anunciando número completo de seleccionados.
- Impacto: imprimir “10” puede imprimir solo los de última página; perder etiquetas genera trabajo manual/confusión de inventario.
- Corrección: colección de productos seleccionados independiente o fetch por IDs antes de impresión; informar “seleccionar página” o permitir “todos los resultados” explícito; añadir número de copias por SKU y formatos reales de impresora como mejora posterior.
- Aceptación: 2 selecciones de página1 y 3 de página2 generan exactamente 5 etiquetas.

### U10 — P2 — El escáner deja abierto un stream de cámara ajeno al que cierra

- Evidencia: `src/components/barcode-scanner.tsx:27` obtiene getUserMedia y descarta el MediaStream. Luego Html5Qrcode abre captura (`:44-59`). Stop/unmount (`:75-91`) solo detiene scannerRef.
- Impacto: cámara/indicador y consumo de batería pueden seguir activos al cerrar; potencial conflicto al reabrir en iPhone. No comprobado en dispositivo físico.
- Corrección: delegar permiso/captura al scanner o detener inmediatamente todos los tracks de la captura preliminar; cleanup robusto para abortar inicio y unmount, guard frente a callbacks repetidos.
- Aceptación: cerrar durante permiso/inicio/captura detiene tracks; abrir/cerrar diez veces no deja cámara activa ni duplica callback.

### U11 — P2 — Doble envío de caja y conteo sesgado

- Evidencia: `src/app/admin/caja/page.tsx:71-135` no tiene guard/estado pendiente; botones `:162,234,258` no se deshabilitan. `:56` precarga efectivo contado con esperado y `:247` revela total antes de contar.
- Impacto: doble toque o red lenta repite registros; cerrar sin contar parece correcto porque el formulario ya tiene el valor esperado. Integridad backend a consolidar con agente negocio.
- Corrección: submitting por acción más idempotencia servidor; captura de efectivo físico requerida, inicialmente vacía; conteo ciego por denominaciones si dueño lo necesita y autorización de diferencia.
- Aceptación: doble toque crea un movimiento; efectivo vacío no cierra; diferencia queda registrada con responsable.

### U12 — P2 — Plazos de reserva de interfaz no coinciden necesariamente con configuración

- Evidencia: `src/app/carrito/page.tsx:29-33` carga solo depositPercentage; textos `:201` y `:209` fijan “30 min” y “24h”. Settings tiene tempReservationMinutes, pendingVerificationHours y depositReservationHours (`prisma/schema.prisma:298-305`).
- Impacto: cambiar política en administración no cambia promesa al cliente; plazo para verificar comprobante y recoger se confunden.
- Corrección: cotización incluye reglas efectivas y momentos separados: subir/verificar comprobante y recoger; usar fechas reales servidor en confirmación.

### U13 — P2 — Fallos de carga se confunden con listas vacías

- Evidencia: catálogo `src/app/catalogo/page.tsx:171-183` no comprueba res.ok, fallback [] o solo console; modelos `src/app/admin/modelos/page.tsx:48-57,113` asigna response object sin validar y luego reduce. Caja `:52-58` interpreta error HTTP sin active como caja cerrada. Mis reservas toast de error seguido de lista vacía (`mis-reservas/page.tsx:109-121`).
- Impacto: 403/500 puede aparentar inventario inexistente o caja cerrada; en modelos un body `{error}` provoca fallo render. No hay reintento consistente ni indicador de datos antiguos.
- Corrección: cliente HTTP común, res.ok y DTO validado; estados loading/error/empty/stale separados; reintento y conservar última lectura identificada.

### U14 — P2 — Menú empleado promete rutas a las que no tiene acceso

- Evidencia: `src/components/admin/sidebar.tsx:39-45,83-88` mantiene Reservas para EMPLOYEE y barra global también `src/components/mobile-nav.tsx:29`. `src/app/admin/reservas/page.tsx:22` permite solo ADMIN.
- Impacto: operador selecciona opción visible y vuelve al inicio en vez de realizar operación. Esto podría reflejar política administrativa intencional, pero navegación debe reflejarla.
- Corrección: matriz explícita de capacidades por rol y uso común en UI/rutas/APIs; decidir quién entrega/verifica reservas.

## Accesibilidad y móvil

### U15 — P2 — Controles esenciales no operables por teclado y menú lateral sin gestión de foco

- Evidencia: filtros de marca/modelo/categoría (`catalogo/page.tsx:222-267`) usan Badge; `src/components/ui/badge.tsx:33-35` renderiza div sin tabIndex/role/teclado. Selectores tipo reserva son div onClick (`carrito/page.tsx:195-215`). Subida usa div clicable y input hidden (`image-upload.tsx:143-161`). Drawer (`admin/sidebar.tsx:104-177`) queda montado fuera de pantalla sin inert/hidden, no es Dialog ni gestiona Escape, trap/retorno de foco. Botones de abrir/cerrar menú (`:94-101,129-135`) carecen nombre accesible.
- Impacto: teclado/VoiceOver no pueden elegir filtros o archivo; focus puede entrar en menú invisible y perderse tras abrir/cerrar.
- Corrección: botones/radiogroup semánticos, label asociado al file input, Sheet/Dialog accesible, nombres en botones de iconos, aria-expanded/current y foco visible. Reusar componentes Radix ya presentes.
- Aceptación: recorrido completo catálogo→reserva y admin→venta solo con teclado; VoiceOver iPhone anuncia propósito/estado; ningún foco oculto.

### U16 — P2 — Doble navegación inferior y espacio insuficiente en tablet

- Evidencia: layout raíz siempre agrega MobileNav (`src/app/layout.tsx:98`), visible <768 y z50 (`mobile-nav.tsx:36`). Admin también agrega bottom bar visible <1024 con z90 (`admin/sidebar.tsx:180`). Padding global está solo hasta 767 (`src/app/globals.css:100-103`); admin/layout `:22` no agrega reserva inferior general. Algunas páginas como ventas sí tienen pb20, pero reportes no.
- Impacto: <768 quedan dos navs semánticas superpuestas; entre 768 y 1023 la barra admin puede tapar última parte de páginas sin padding individual. Banner instalación z50 (`pwa-install-banner.tsx:40`) compite con navegación global; en admin queda debajo de su barra.
- Corrección: un shell por rol/ruta y una sola barra; breakpoint/padding común hasta lg, contabilizar safe area; banners dentro del layout sin tapar acciones.
- Aceptación: anchos 390, 768, 820 y 1024: una navegación visible, final de contenido y botones alcanzables, sin overlap.

### U17 — P3 — Texto corrupto y nombres de controles incompletos

- Evidencia: `carrito/page.tsx:84,88,102-107,254-264` contiene caracteres “?” en palabras (vac?o, cat?logo, dep?sito); no es inferencia de fuente. Varios iconos de catálogo `:505-548` no tienen aria-label; SearchBar input `:77-83` usa solo placeholder y botones quitar no nombrados.
- Corrección: normalizar UTF-8, revisión de copy y términos “depósito/anticipo”; labels y aria-labels útiles; bajar densidad texto 10px en flujos operativos donde dificulta lectura.

## Operaciones, nube y recuperación

### O01 — P1 — Arranque muta esquema y oculta fallos de sincronización

- Evidencia: `Dockerfile:49-53` genera entrypoint con `npx prisma db push 2>/dev/null || true` antes de node; `docker-compose.yml:85` ejecuta db push en servicio denominado migrate. La única carpeta SQL es `prisma/migrations/20250310000000_add_credit_module/migration.sql`, cuyo primer paso ALTER User presupone tablas previas.
- Impacto: una imagen nueva puede alterar esquema al reiniciar; error de credenciales/migración queda oculto y la app arranca parcialmente. La historia de migraciones no recrea una BD vacía completa; hay procedimiento manual de baseline crédito. Cambiar a `migrate deploy` sin preparar baseline no basta.
- Corrección: inventariar esquema real, baseline reproducible, migraciones revisadas, job único previo al deploy con fallo visible; cuenta app sin DDL. Backup/restore comprobado antes de primera migración formal. Cambios compatibles para poder volver a imagen anterior.
- Aceptación: BD vacía se crea desde migraciones; copia de BD existente llega al mismo esquema; fallo detiene deploy sin promover versión; health no confunde SELECT1 con esquema válido.

### O02 — P1 — No hay respaldo/restauración documentado y ejecutable de los dos datos persistentes

- Evidencia: Compose conserva PostgreSQL y uploads en volúmenes; búsqueda en scripts/deploy/docs no encuentra pg_dump, pg_restore ni flujo de backup verificable. Esto indica ausencia en árbol fuente, no demuestra que no exista respaldo externo en el N5.
- Impacto: nube sin backup sigue expuesta a borrado, volumen roto, importación equivocada o cambio defectuoso; un backup solo BD no recupera imágenes por URL.
- Corrección: inventario exacto de BD + uploads + secretos referenciados; backups cifrados fuera del servidor, retención, alertas de antigüedad y simulacro. Los objetivos de recuperación y retención vigentes son los del [plan de nube](04-plan-y-nube.md), ajustados al contexto posterior de conservar datos y tolerar interrupciones; no se consideran demostrados hasta ensayar restauración y medir retraso de archivo.
- Aceptación: restaurar a entorno nuevo aislado, cotejar conteos/totales, hashes de archivos y navegar operación sintética; registrar tiempo real y fecha del último éxito.

### O03 — P1 — Compose/Portainer apuntan a nombres de volumen diferentes

- Evidencia: `docker-compose.yml` declara `postgres_data` sin external; `docker-compose.portainer.yml` declara `prosolutions_postgres_data` external. `deploy.ps1:21` y `deploy-n5.ps1:34` usan proyecto `-p prosolutions`, mientras shell `deploy-n5.sh:83-90` usa Compose por defecto. Uploads usa nombre dependiente del proyecto.
- Impacto: ejecutar otro procedimiento puede levantar otra BD vacía o volumen de imágenes distinto; no implica borrado del original, pero puede aparentar pérdida y fomentar una restauración equivocada. Nube requiere copiar datos del volumen realmente montado, no adivinar nombre.
- Corrección: nombres explícitos/declaración external coherente, inventario y etiquetas de volumen, single runbook por entorno; prohibir procedimientos ambiguos de reset producción.
- Aceptación: inspect de contenedor prueba montajes; reiniciar/recrear mismo proyecto conserva conteos/archivos.

### O04 — P1 — Stack expone PostgreSQL y arranca con credenciales predeterminadas

- Evidencia: `docker-compose.yml` y `.portainer.yml` publican 5432 en todas las interfaces, incorporan password de BD y fallback de secreto de sesión en YAML; `src/lib/env.ts:30-39` solo comprueba presencia. `PROYECTO.md` documenta cuentas de demostración.
- Impacto: migrar literal a VPS expuesto amplía acceso a credenciales predeterminadas y puerto BD. Exploit/estado real corresponden al agente seguridad; esto es configuración insegura observada, no acceso externo probado.
- Corrección: secretos obligatorios sin default, rotación de credenciales reales, DB privada sin publish, TLS público vía proxy, firewall; cuenta administrativa inicial por invitación/mecanismo de un solo uso. No reproducir valores de secretos en el informe final.

### O05 — P2 — Despliegues no tienen promoción de salud ni rollback verificable

- Evidencia: `deploy-n5.sh:83-90` detiene todo antes del build, duerme 10s y sincroniza esquema después. `deploy.ps1:19-25,73-78` build no-cache, force-recreate y listado de containers bastan para declarar listo. Imágenes `prosolutions-app:latest`/`bot:latest`; no pipeline CI en árbol fuente ni release tag/digest.
- Impacto: downtime evitable, código parcialmente aplicado, imposibilidad práctica de saber qué versión corría, falso éxito si está restarting/unhealthy. Los scripts remotos además hacen git reset hard/clean y host-key checking desactivado (`deploy-n5.sh:48,60,79-80`); no ejecutarlos como rutina de auditoría.
- Corrección: CI produce imágenes con commit/digest, test/build/audit previo, migración preflight, levantar/cambiar versión y esperar readiness + smoke, rollback explícito; mantener versión anterior y logs de release. Una instancia sigue teniendo breve ventana de reinicio: declararla honestamente.

### O06 — P2 — Salud de web y bot insuficiente para recuperar servicio

- Evidencia: `src/app/api/health/route.ts:13` solo SELECT1. Bot no tiene healthcheck en Compose. restart unless-stopped actúa al terminar proceso, no repara automáticamente un proceso que sigue vivo y está unhealthy. Cron vive en `src/bot/index.ts:91-115`; sesiones se guardan en objetos `:49-58`.
- Impacto: web healthy aun con tablas ausentes/cron detenido; bot vivo con fallo de polling o DB no observado; reinicio pierde carrito/registro guiado en bot. Pérdida eléctrica no es único riesgo de disponibilidad.
- Corrección: liveness/readiness separados y con timeout; métricas último polling/job, monitor externo HTTP + bot sintético autorizado, notificación de fallo; sesiones persistentes/expirables si necesitan continuidad. Worker cron dedicado con lock durable, idempotencia y reintento; no duplicar bot al cortar a nube.

### O07 — P2 — Aplicación requiere disco persistente y conexiones largas; no es despliegue estático/serverless directo

- Evidencia: producto se escribe en `public/uploads/products` con fs (`src/app/api/upload/product/route.ts:39-48`); app/bot comparten volumen. Telegram usa long polling y cron dentro de proceso, SSE mantiene `connections` Map local (`src/app/api/notifications/stream/route.ts:5,25-41,48-85`).
- Impacto: disco efímero pierde imágenes; múltiples réplicas no comparten uploads ni bus SSE; dos pollers del mismo bot entran en conflicto; cron duplicado puede ejecutar dos veces. No añadir réplicas solo por configurar proveedor.
- Corrección: primera migración conservadora con app + bot único + Postgres y volúmenes, o separar app/worker/Postgres gestionado/object storage. Para crecer, notificaciones/outbox persistidas + bus, documentos privados e imágenes públicas separados. Validar proveedor para procesos siempre activos y SSE.

### O08 — P2 — Empaquetado Docker y consumo sin controles operativos

- Evidencia: `.dockerignore` excluye `.env` exacto, no `.env.*`; `Dockerfile.bot:11` hace COPY . . y ejecuta root (sin USER), incluye dependencias de desarrollo y npm install global no fijado (`:8`). Compose no define límites de memoria/CPU ni rotación de logging.
- Impacto: un futuro .env.local/.env.production puede entrar a imagen/build; imágenes bot más pesadas y variable tooling; crecimiento de logs/recursos puede agotar disco/RAM del VPS. No se afirma que variantes de env estén presentes.
- Corrección: allowlist/exclusiones de contexto, multistage bot con usuario sin privilegios y dependencias mínimas, versiones/digests definidos, logs con límite, cuotas monitoreadas, pruebas del contenedor real y dimensionamiento medido.

### O09 — P2 — Push no está implementado como capacidad integral

- Evidencia: existe tabla `PushSubscription` (`prisma/schema.prisma:314-321`) y env VAPID (`src/lib/env.ts:15-16`), pero no se encuentra uso de pushManager, subscription endpoint, registro de subscription, web-push ni listener push/notificationclick en src/public. La capacidad real es SSE del panel abierto. `next.config.ts:4-10` configura next-pwa sin worker personalizado.
- Impacto: configurar VAPID no habilita notificación cuando PWA está cerrada. No prometer capacidad completa por instalar icono.
- Corrección: decidir si Telegram es canal suficiente; si push importa, consentimiento y alta/baja por dispositivo, worker, envío/outbox, endpoints privados, limpiar suscripción expirada, pruebas iPhone físico en segundo plano.

### O10 — P2 — Notificaciones son locales y pueden dejar de reconectar tras un corte

- Evidencia: `src/hooks/use-notifications.ts:32,38-50` persiste en clave local única para todos los usuarios. Cada evento recibe UUID local (`:133-150`); no hay lista persistida servidor ni cursor/replay. Tras máximo 5 fallos deja de reconectar (`:88,96-100,163-179`), sin evento online/focus para recuperación automática; resetAndReconnect existe pero dropdown no lo usa. `markAsRead` reduce contador aunque ya estuviera leído (`:195-205`).
- Impacto: eventos durante cierre de panel/corte se pierden, historial no sincroniza dispositivos y queda en dispositivo compartido; click repetido baja contador sin correspondencia. Tras apagón prolongado, panel puede permanecer desconectado hasta recargar.
- Corrección: notificación durable por destinatario, id servidor, seen/read persistido, reanudación por cursor, reconnect online/focus y botón recuperar; limpieza/aislamiento por cuenta; contador derivado de registros.

### O11 — P2 — La PWA no tiene un comportamiento offline definido

- Evidencia: next-pwa registrado con skipWaiting (`next.config.ts:4-10`), banner recarga (`src/components/pwa-update-banner.tsx:18-26,51`); no se encuentra navigator.onLine ni listener offline/online ni flujo de operaciones pendientes. POS cart es solo useState (`ventas/page.tsx:73`), recarga pierde borrador.
- Impacto: servir cache puede dar sensación de disponibilidad con backend inaccesible; al recargar versión nueva se pierde venta sin confirmar. En nube mejora servidor pero el local puede seguir sin internet/energía.
- Corrección: mostrar estado de conexión, bloquear confirmaciones sin respuesta autoritativa, conservar borradores con aviso de no confirmado; cache explícita de recursos públicos, excluir auth/documentos privados y validar limpieza al logout. Si negocio necesita ventas offline, diseñar cola durable/reconciliación de stock/crédito después de integridad online; no activarla solo con service worker.
- Validación pendiente: inspeccionar worker generado de build producción; no afirmo una fuga por cache sin verificar su política.

### O12 — P2 — Pruebas cubren utilidades, no operación ni recuperación

- Evidencia: tres archivos en `src/__tests__/lib`: auth.config, utils y get-paginated-items, con 21 casos estáticos; `vitest.config.ts:6-9` solo entorno node. No hay tests API/BD, checkout, importación, bot, cliente, concurrencia, iPhone ni restore en el árbol. `package.json:10` usa `next lint`; docs ya reconoce fallo en `docs/VERIFICACION.md`.
- Impacto: tests verdes pueden coexistir con flujos bloqueados, fugas de autorización o pérdidas transaccionales.
- Corrección: matriz de pruebas priorizada abajo y CI obligatoria apropiada; corregir script lint real y tratar errores como bloqueo de promoción. Los resultados actuales de ejecución deben tomarse del agente principal, no de documentos antiguos.

### O13 — P3 — Documentación de operación incoherente y sin evidencia vigente

- Evidencia: README `:73,77` apunta a docs/PORTAINER-STACK.md, pero el archivo está en raíz; README `:81` menciona AUDIT.md ausente. Documentos VERIFICACION/MINISFORUM describen entorno “verificado” sin evidencia actual de esta auditoría. PWA-DUENO afirma equivalencia completa navegador/PWA y recomienda permisos más estables al instalar, sin pruebas adjuntas.
- Corrección: README mínimo vigente; runbooks separados local/staging/prod con fecha y versión; inventario real de volúmenes, DNS, secretos por nombre, restore, corte y vuelta atrás; evidencia NOT_RUN donde no se probó. Archivar planes históricos para no confundirse con capacidades ya disponibles.

## Funciones nuevas priorizadas por operación real

Las siguientes son propuestas, no bugs ni compromisos de alcance. Confirmar flujo de tienda antes de desarrollar.

1. **P1: venta/pedido con folio y líneas, pagos y devoluciones vinculadas.** Suma todas las líneas y canal web/POS/bot; ticket único, anticipo y saldo, anulación autorizada/reversa sin borrar historia, aplicación de devolución parcial y saldo de crédito. Base para resolver U04 y evitar contabilidad paralela.
2. **P1: garantía y devoluciones de refacciones.** Motivo (defectuosa, incompatible, dañada), prueba/foto, fecha/lote de compra, estado de evaluación, cambio/devolución/nota de crédito, condiciones por calidad. Stock devuelto a cuarentena y solo volver a vendible tras validación. Es esencial distinguir retorno financiero de pieza utilizable.
3. **P1: compras/proveedores y recepción.** Orden de compra, costo real por lote, recepción parcial, faltantes, vencimientos proveedor, moneda/tipo de cambio fijado por documento, gastos de importación; comparación esperado vs recibido, foto factura y autorización de diferencia. No hay Supplier/Purchase en schema observado.
4. **P1/P2: inventario físico y ubicación.** Ubicación estante/cajón, conteo ciego, conteos cíclicos por rotación/valor, variación y aprobador; mínimos + máximo/sugerencia de compra y stock disponible/reservado/defectuoso diferenciados.
5. **P2: compatibilidad y variantes explícitas.** Calidad (original/OEM/compatible), tecnología (OLED/LCD), color, con/sin marco, códigos equivalentes/revisión, notas técnicas. Producto ya admite muchos modelos pero variantes hoy dependen de nombre libre; evitar que “Samsung A...” parecidos generen devoluciones. Fotos de conectores y filtros por atributo.
6. **P2: condiciones comerciales por cliente.** Lista de precios por técnico/tienda, precio por escalón, descuento autorizado con margen mínimo, plazo de crédito/vencimiento, antigüedad cartera, recordatorio acordado y estado de cuenta compartible privado. El esquema actual tiene límite/saldo, pero no vencimiento en CreditMovement.
7. **P2: tablero accionable para dueño.** Ventas netas, margen con costo histórico, caja esperada vs contada por turno/método, productos agotados y venta perdida, compras sugeridas, cartera vencida, errores/reservas por resolver. Separar ventas, cobros y reservas para no sumar magnitudes distintas.
8. **P2: autoservicio cliente coherente con canal elegido.** Estado de cuenta/historial completo, repetir pedido, favoritos, solicitar producto agotado, compartir cotización y advertencia de cambio de precio. Si se mantiene web, agregar contacto/horarios/ubicación y recuperación de cuenta; si se adopta bot exclusivo, limpiar navegación y rutas legadas.
9. **P2: auditoría durable de acciones.** Actor, acción, antes/después, motivo, canal, fecha y correlación del pedido, exportación restringida y retención; roles por capacidad, revisión de devoluciones/ajustes/crédito. Ya existen movimientos e historial de precio, pero no sustituyen registro transversal.
10. **P3: automatizaciones y análisis posteriores.** ABC/rotación, sugerencias de reorden según lead time, avisos de compatibilidad, lector/impresora y formatos por sucursal; multiubicación solo si operación lo justifica. Integración fiscal/contable y cobro online requieren contexto y proveedor; no asumir que hoy se factura/cobra electrónicamente.

## Plan técnico propuesto y criterios de salida

### Fase 0 — contexto, inventario y recuperación antes del corte (1–2 días estimados)

- Confirmar qué canal cliente se usa, cuántos SKU/clientes/ventas, quién opera POS/bot y presupuesto mensual.
- Obtener inventario de producción autorizado: versión real, conteos agregados, tamaños BD/uploads, nombre de volúmenes, DNS/TTL, cron/backup existente; no copiar secretos a documentos.
- Crear backup cifrado fuera del host y restaurar copia aislada. Definir RPO/RTO real y ventana de cambio.
- Salida: restauración demostrada, fuente real identificada y lista de capacidades vigentes vs legado.

### Fase 1 — integridad y acceso antes de ampliar exposición (aprox. 1–2 semanas, depende agente negocio)

- Secretos obligatorios/rotación, DB privada, controles auth/PII del reporte de seguridad.
- Transacción checkout única e idempotencia en reservas/POS/crédito/caja; estado unificado; no cantidades/precios autoritativos de frontend.
- Endpoint privado comprobante, catálogo y reservas paginadas, scan exacto.
- Baseline/migraciones que funcionen en vacío/copia existente; revisión de importación y devolución.
- Salida: integración BD real sintética con rollback/concurrencia y permisos; venta/reserva completa y ticket consistentes; ningún fallo P1 abierto que corrompa datos.

### Fase 2 — nube con operación recuperable (2–4 días tras fase 1)

- Desplegar entorno privado con dominio temporal y secretos separados; imagen versionada; DB privada; backups offsite y uploads persistentes/object storage según opción económica del agente principal.
- App y único worker bot/cron; monitores externos; reglas de disco/logs; documentación de release/restore.
- Ensayo migración: dump, archivos, restore, cotejo, auth, catálogo, transacción sintética, tickets, cámara iPhone físico y notificaciones.
- Corte: modo mantenimiento/pausa escrituras, detener polling bot origen, backup final, restauración/delta, switch DNS/tunnel, iniciar único bot destino, smoke, observación. Mantener origen congelado para contingencia y evitar split brain.
- Vuelta atrás: antes de aceptar nuevas escrituras, retorno simple al origen congelado; después, reconciliar/copiar operaciones del destino antes del retorno. No proponer solo “volver DNS” cuando ya cambió BD.
- Salida: dominio en nube verificado y datos correctos, monitor/backup funcionando y restore ensayado.

### Fase 3 — calidad de interfaz/PWA (3–6 días estimados)

- Corregir cache/estado online/borradores y reconexión; filtros/URL, selección etiquetas, permisos visibles por rol y copy.
- Un shell móvil, a11y semántica, drawer y controles accesibles; detener cámara correctamente.
- Elegir entre completar push o retirar configuración/copy inoperante; probar PWA real en iPhone.
- Salida: flujos aprobados en 390/768/820/1024px y teclado/VoiceOver; cinco ciclos de actualización/reconexión sin perder operación confirmada.

### Fase 4 — producto por módulos (2–6 semanas según alcance)

- Prioridad recomendada: devolución/garantía → compras/recepción → conteo/ubicación → crédito con vencimiento → reportes y reposición → autoservicio.
- Cada módulo con una operación real observada, reglas de permisos/reversas, evidencia de salida y prueba piloto de tienda. No desarrollar toda la suite en una sola entrega.

Las duraciones son estimaciones iniciales de esfuerzo, no compromisos; dependen del tamaño real de datos y de cuáles hallazgos ya estén resueltos en producción distinta a esta copia.

Con el contexto actualizado, las prioridades de fase 4 deben recortarse a necesidades demostradas en tienda. El costo de desarrollo y mantenimiento de funciones sin uso puede superar ampliamente el ahorro entre proveedores nube; iniciar con correcciones P1, restauración y un flujo corto de consulta→reserva/pago→entrega.

## Matriz mínima de verificación para el plan

| Área | Casos decisivos |
|---|---|
| Venta/reserva | Varias líneas, última unidad en dos sesiones, reintento mismo id, respuesta perdida después de commit, línea inválida, precio cambiado |
| Pagos/crédito/caja | Tarjeta/transferencia no suman efectivo, deuda y venta atómicas, abono con saldo límite, devolución parcial, caja abierta/cerrada concurrente |
| Roles/datos | Admin, empleado, cliente aprobado/pendiente/rechazado, rutas directas y APIs, comprobantes ajenos, datos de sesión anteriores |
| Catálogo/UX | Más de 20 productos/reservas, PENDING_PAYMENT, filtros en página avanzada, red lenta con respuestas cruzadas, impresión de selección entre páginas |
| iPhone/PWA | Cámara permiso denegado/concedido, cerrar al iniciar, volver de background, actualización, pérdida de red, teclado/VoiceOver, safe areas |
| Nube/DR | Instancia nueva desde cero, migración en copia existente, restore BD+archivos, rollback antes/después de escrituras, solo un poller/cron, alerta por fallo real |
| Evidencia | Versiones, fecha, comandos, totals/fails/skips, logs sin PII, diferencias locales vs producción, NOT_RUN para todo flujo no observado |

## Preguntas que más cambiarían el plan

Ya se confirmó una tienda, 2–3 usuarios simultáneos, preferencia de menos de US$20/mes, prioridad de conservar datos y tolerancia a interrupciones. El usuario identificó esta carpeta como la versión usada; comparar imagen, esquema y volúmenes reales sigue siendo una verificación distinta.

- ¿La venta/reserva cliente debe seguir por web y Telegram, o el sitio cliente es legado y Telegram es el único canal comercial?
- ¿Cuántos productos, tamaño de imágenes/BD y ventas diarias? ¿La tienda cobra en MXN solamente o maneja USD real?
- ¿Existen backups actuales fuera del escritorio y evidencia de restauración? ¿Qué pérdida máxima de operaciones y demora de recuperación aceptaría el dueño en un desastre?
- ¿Qué hacen hoy con garantías, devoluciones, compras a proveedores, facturas y crédito? ¿Qué operación les cuesta más tiempo/errores?
- ¿La copia presente es exactamente la que corre en Docker del N5 y hay acceso autorizado para cotejar versión/volúmenes sin datos personales?
- ¿Necesitan seguir vendiendo cuando la tienda pierde internet/energía, además de que clientes externos conserven el acceso a nube?

## Acceso al escritorio y datos reales

Las observaciones iniciales de este anexo se hicieron antes de las comprobaciones posteriores de Tailscale, SSH y Parsec del agente principal. Por eso no se utiliza aquí aquel estado inicial de equipo fuera de línea como dictamen vigente.

El estado actualizado y los límites del acceso se concentran en [Escritorio y datos reales](06-escritorio-y-datos-reales.md). Los documentos locales mencionan más de una ubicación Windows: al conseguir acceso hay que cotejar imagen y montajes reales de Docker, sin adivinar el volumen por el nombre de una carpeta sincronizada. Syncthing de código no demuestra copia de PostgreSQL.

La inspección de este subanexo no accedió a datos productivos. No ejecutar scripts de despliegue ni imprimir variables o credenciales para hacer el inventario; obtener versiones, montajes, tamaños y conteos agregados dentro del alcance autorizado.
