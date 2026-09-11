# Evidencia, método y límites

Auditoría de 2026-09-11. El código revisado está en `/Users/galindoasc/Proyectos_Sincronizados/prosolutions_inventario_web`. Se utilizó análisis de tres agentes especializados, revisión principal, ejecución aislada, navegador, consultas oficiales de precios/avisos, inspección remota del escritorio y restore aislado de datos reales.

## Entorno y protección de datos

- No se modificó código de aplicación, lockfile, configuración del servicio ni datos comerciales reales. Se habilitó el acceso SSH autorizado para inspección/respaldo. Informes y evidencia sin registros personales están bajo `docs/auditoria-2026-09-11`; el respaldo cifrado y su clave se almacenaron aparte, fuera de Syncthing.
- No hay directorio Git en la carpeta local de Mac; se guardó un [manifiesto SHA-256](evidencias/source-manifest.json) de 179 archivos relevantes. En el escritorio sí se observó commit y un árbol con 43 cambios, por lo que no se atribuye toda la imagen web a ese commit ni se asegura que un secreto nunca haya estado versionado.
- La copia de ejecución está en `/tmp/prosolutions-audit-20260911/work`; se excluyeron env reales, cachés y archivos de negocio. Se creó PostgreSQL sintético en OrbStack con puerto ligado a loopback.
- Se comprobó la igualdad de 168 archivos de src/prisma/scripts/types entre origen y copia. Hubo una exclusión inicial demasiado amplia de uploads que también omitió su Route Handler; se corrigió antes de la verificación final, se reconstruyó web/Docker y se repitió la prueba de archivos. El 404 inicial de una subida nueva **se descartó** como artefacto del entorno.
- Usuarios, correos, comprobantes e importes de las pruebas de aplicación son ficticios. Los identificadores o valores de autenticación incluidos como fixtures en los harness no son credenciales de producción. El bot productivo se observó activo; no se inició un bot adicional de pruebas ni se enviaron notificaciones a personas. El restore real se limitó a BD y archivos, con red deshabilitada.
- Los materiales de `acceso/` corresponden al acceso al escritorio autorizado por el usuario y se documentan aparte; la clave SSH que contienen es pública. No forman parte del fixture comercial y no deben confundirse con claves privadas o credenciales de clientes.
- OrbStack estaba detenido al principio; abrirlo puso en marcha también los contenedores preexistentes configurados con restart. No se operaron esos otros proyectos.
- Build local: Node 22.23.0, npm 10.9.8; imagen según Dockerfile usa Node 20 Alpine. Pruebas Docker en arm64 local, no validación x86 de la nube.
- Cierre del entorno: el agente principal detuvo el servidor de pruebas del puerto 3305 y eliminó únicamente los tres contenedores sintéticos de aplicación/base vacía/base temporal y su red propia. Permanecen las imágenes, la copia de trabajo y las evidencias. No se retiraron contenedores ni volúmenes de proyectos reales. Las URLs localhost de los registros describen pruebas ya finalizadas, no un servicio que continúe activo.

## Resultados reproducibles

| Evidencia | Resultado |
|---|---|
| [Instalación npm](evidencias/npm-ci.log) | npm ci completado |
| [Tests originales](evidencias/tests.log) | 3 archivos, 21 pasaron, 0 fallaron |
| [TypeScript](evidencias/typescript.log) | Comando finalizó 0; archivo vacío significa sin diagnósticos |
| [Build con fuente completa](evidencias/build-complete-source.log) | Next 16.1.6 compiló, incluida ruta /uploads |
| [Build Docker con fuente completa](evidencias/docker-build-complete-source.log) | Imagen construida |
| [Lint documentado](evidencias/lint-default.log) | next lint falla, ruta inexistente lint |
| [ESLint JSON](evidencias/eslint.json) | 64 errores, 89 avisos en 153 archivos |
| [Audit total](evidencias/npm-audit.json) | 53 paquetes/cadenas reportados |
| [Audit omit=dev](evidencias/npm-audit-production.json) | 39 paquetes/cadenas reportados |
| [Migración base vacía](evidencias/migrations-empty.log) | P3018, no existe User |
| [Prisma en imagen final](evidencias/docker-prisma-complete.log) | prisma: not found |
| [Health con BD sin tablas](evidencias/docker-empty-db-http.json) | health200, products500 |
| [HTTP anónimo](evidencias/http-anonymous.json) | Costos públicos y controles 401 de contraste |
| [HTTP autenticado](evidencias/http-authenticated.json) | Mutación anónima, crédito/cancelación, doble rechazo, permisos y sesión revocada |
| [HTTP fuente completa](evidencias/full-source-http.json) | Comprobante sintético creado tras arranque: lectura anónima 200, caché pública de un año; worker 404 |
| [Concurrencia y validación de pago](evidencias/http-concurrency-payment.json) | Tres reservas: 201/201/201 para stock 1, stock final −2; action=pay devuelve 500 |
| [Navegador](evidencias/browser-observations.json) | Marcador XSS, lista20 y pérdida de foco |
| [Respaldo/restauración sintéticos](evidencias/synthetic-restore.json) | Cuatro conteos agregados coinciden en BD restaurada |
| [Escritorio: inspección de sólo lectura](evidencias/desktop-readonly.jsonl) | SSH autenticado, instancia/montajes identificados, PostgreSQL 16.11 y agregados de datos reales |
| [Configuración runtime y GET reales](evidencias/desktop-runtime-config-check.json) | DB coincide con contraseña default; secretos auth sin fallback; Next/Node reales; GET anónimo devuelve claves internas del producto |
| [Manifiesto de respaldo real](evidencias/real-backup-manifest.json) y [descifrado/restauración](evidencias/real-backup-restore-check.json) | AES-256-GCM y SHA-256 verificados; restore de dump y extracción de archivos finalizaron 0 |
| [Restore real: tablas](evidencias/real-restore-table-checks.json) | 16 tablas: conteos y SHA-256 del contenido canónico coinciden entre origen y restauración |
| [Restore real: archivos](evidencias/real-restore-files.json) | 45 archivos / 49,891,307 bytes; SHA-256 agregado de rutas relativas y contenido coincide |
| [Datos reales: revisión de esquema y agregados](08-datos-verificados.md) | Comparación de 15 modelos/135 columnas y enums; inconsistencias comerciales acotadas, sin modificar datos |

El health engañoso se observó en la imagen completa contra una BD sin tablas comerciales. La única migración disponible presupone User; ni el entrypoint ni migrate deploy son suficientes para levantar esa base desde cero. No se intentó “reparar” el arranque ejecutando seed sobre el origen.

El restore sintético usó `pg_dump -Fc` y `pg_restore --exit-on-error --no-owner`. Coincidieron 3 usuarios, 27 productos, 5 reservas y 1 movimiento de crédito. **En esa prueba inicial no se compararon todas las tablas ni se restauraron archivos reales y no certifica consistencia financiera:** el fixture incluye intencionalmente datos de reproducción defectuosos. El restore real posterior se describe por separado a continuación.

## Inspección del escritorio y recuperación real

El alias SSH `galindoasc-desktop` autentica en hostname **GALINDOASC**. Se inspeccionaron contenedores y agregados SQL sin escrituras comerciales. La fuente sincronizada en Windows y la incluida en la imagen del bot coinciden con 167 archivos de Mac; el único archivo fuente adicional en Mac es `src/app/uploads/[[...path]]/route.ts`. Su artefacto compilado **sí existe** en la app productiva. Los hashes de package.json y schema.prisma coinciden. Esto identifica diferencias concretas, pero no equivale a verificar todos los artefactos compilados de la imagen web. [Detalle del escritorio](06-escritorio-y-datos-reales.md).

Datos observados: PostgreSQL **16.11**, BD **9,490,915 bytes**, PGDATA **65,016 KiB** y volumen uploads **48,824 KiB**. Hay 98 productos, 5 usuarios, 3 reservas, 153 movimientos de inventario, 9 de crédito, 5 de caja y 1 caja. La consulta de stock negativo devolvió cero en producción; los tres éxitos concurrentes y stock −2 corresponden al fixture aislado y no se provocaron en el negocio.

App y bot estaban activos; web publicada en 3005 y PostgreSQL 5432 en todas las interfaces del host. No se verificó que 5432 sea alcanzable desde Internet. Se identificaron los volúmenes activos `prosolutions_postgres_data` y `prosolutions_uploads`; de otros volúmenes heredados sólo se observó su existencia. Una muestra de memoria de web+bot+BD sumó aproximadamente **229 MiB en reposo**, sin ensayo de picos y sin representar todo el consumo del host.

La [comprobación final de runtime](evidencias/desktop-runtime-config-check.json) confirmó **Next 16.1.6 y Node 20.20.2** en la app. La contraseña real de PostgreSQL coincide con el default documentado de Compose; se registró sólo el resultado booleano, sin emitir la contraseña. AUTH_SECRET/NEXTAUTH_SECRET son iguales, tienen al menos 32 caracteres y no coinciden con el fallback; CRON_SECRET está configurado. Se requiere rotación coordinada de la credencial DB en app/bot y cierre de publicación, todavía no realizados.

Un GET anónimo de sólo lectura a `/api/products?limit=1` del servicio real devolvió **200**, total **98**, y claves `costPrice`, `wholesalePrice` y `_count` entre otros campos internos. La evidencia conserva sólo nombres de claves, conteos y estado HTTP, sin productos ni importes. Esto verifica el filtrado insuficiente de esa respuesta real, no acceso público desde Internet. Las mutaciones y el resto de reproducciones destructivas siguen siendo exclusivamente sintéticas.

Se creó un **respaldo cifrado AES-256-GCM** en `/Users/galindoasc/.codex/prosolutions-backups/2026-09-11-audit`, fuera de Syncthing, con la clave separada y no incluida en los informes. No se leyó ni publicó la clave en esta revisión documental. Se restauraron BD y uploads en un entorno aislado sin red, usando almacenamiento temporal en memoria (`tmpfs`). Después de verificar tablas y archivos se eliminó ese contenedor, por lo que ya no conserva datos clonados descifrados. Permanecen el respaldo cifrado, el recuperador Node.js verificado y sus instrucciones fuera de la carpeta sincronizada.

La comparación de BD abarcó **16 tablas**: mismos conteos y SHA-256 de la representación canónica de todas las filas, sin emitir registros. La fuente se volvió a consultar después del dump. En archivos coinciden **45 archivos, 49,891,307 bytes y el digest SHA-256 del árbol**, calculado con nombres relativos ordenados y contenido de cada archivo. Esto acredita la recuperación de la copia inspeccionada, no que sus saldos sean comercialmente correctos.

**Límites del restore real:** el dump se obtuvo con la BD activa y los archivos se capturaron aparte; no forman una instantánea conjunta atómica. No se respaldaron/restauraron roles productivos, configuración secreta ni todo el servicio; no se arrancaron app ni bot restaurados. No se validaron transacciones reales con el dueño ni se ensayaron WAL/PITR, RPO o RTO. Tampoco se verificó una automatización externa de respaldos preexistente. La copia cifrada es local e independiente del escritorio, pero copia y clave están en la misma Mac y no cubren la pérdida de ese equipo. No es un despliegue de backups continuos en nube. La recuperación completa y la conciliación siguen pendientes; las [anomalías de datos observadas](08-datos-verificados.md) no se corrigieron ni se clasificaron automáticamente como pérdida económica.

## Pruebas con adaptadores simulados

- [Negocio: resultados](evidencias/business-repro-results.json) y [harness](evidencias/business-repro.cjs): **12 reproducciones de defectos**.
- [Seguridad: resultados](evidencias/security-probes-results.json) y [harness](evidencias/security-probes.cjs): **9 comprobaciones reproducidas**.

Se cargan los handlers TypeScript reales; autenticación, Prisma, notificaciones y algunas respuestas HTTP se simulan. Esto permite inyectar fallos y ordenar intercalaciones. No simula aislamiento, bloqueos ni rollback de PostgreSQL. El stock negativo también se reprodujo después por HTTP contra PostgreSQL real sintético, como evidencia adicional.

Los harness conservan las rutas exactas empleadas en esta auditoría a código, node_modules y archivos de salida. Para repetir en otra máquina hay que ajustar esas rutas en una copia del harness y utilizar fuente aislada con las dependencias instaladas; no apuntarlos a servicios ni datos reales ni sobrescribir los resultados entregados. Los archivos bajo `evidencias/` son las copias durables de lectura; las rutas `/tmp/` sólo documentan el entorno original. No son una suite de regresión ya incorporada al producto.

**“12/12” y “9/9” significan reproducciones realizadas, no que los defectos estén corregidos.**

## Dependencias: interpretación responsable

El [análisis específico](07-dependencias.md) relaciona las versiones y configuraciones con los avisos. Next 16.1.6 y NextAuth beta30 están en rangos afectados; `next-auth` y `@auth/core` comparten avisos, y herramientas en dependencies aparecen en omit=dev aunque sean principalmente de compilación.

Priorizar el framework, procesamiento de imágenes, autenticación y el parser de Excel. No ejecutar downgrade automático de Prisma o next-pwa porque audit fix --force lo sugiera.

Fuentes verificadas directamente:

- [Next.js: optimización AVIF y parche 16.3.3](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4): requiere que el contenido afectado llegue al optimizador; no se explotó en esta auditoría.
- [Auth.js: objeto auth con error](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-8fpg-xm3f-6cx3): las comprobaciones de user del proyecto reducen ese caso; no se presenta como bypass probado.
- [Node.js: estado de soporte](https://nodejs.org/en/about/previous-releases): Node20 figura EOL. Construir con éxito no implica soporte de seguridad vigente.

No se ejecutaron cargas de denegación de servicio ni exploits upstream. Los fallos reproducidos de la propia aplicación bastan para exigir corrección antes de una migración literal.

## Cobertura y pendientes

**Revisado:** 33 archivos de rutas API, autenticación/roles, Prisma, inventario, reservas, caja/crédito/reportes, importación, bot y sesiones/cron, principales páginas/components, Docker/scripts, PWA, pruebas existentes y documentación. Los anexos incluyen rutas y líneas para cada hallazgo.

**Todavía no demostrado:**

- Correspondencia de toda la imagen web compilada con un commit limpio: hay coincidencia parcial de hashes y 167 archivos comparados; el fuente de uploads sólo está en Mac, aunque su artefacto compilado sí se encontró en la app real.
- Corrección financiera de los datos reales y conciliación de saldos/compromisos con el dueño; mismos hashes tras restore prueban fidelidad de copia, no validez de negocio.
- Restore completo de app/bot/configuración y captura coordinada de BD/archivos; sí se restauró la copia real de 16 tablas y 45 archivos.
- Respaldo externo automático continuo, retención completa de WAL, alertas y objetivos RPO/RTO ensayados.
- Recorrido de Telegram con servicio real, BotFather, cobros bancarios/pasarela y entrega física.
- PWA instalada, cámara, VoiceOver o impresión en dispositivo físico.
- Rendimiento con catálogo real, importaciones grandes, concurrencia representativa y latencia desde la tienda.
- Seguridad del dominio público, firewall real, configuración completa de Windows/Portainer o historial de incidentes.
- Costos facturados, contratación, despliegue nube, corte DNS o alta disponibilidad.

No se afirma que el sistema haya sido comprometido. “Auditoría completa” aquí significa revisión amplia del proyecto con los límites anteriores, no una certificación ni una garantía de ausencia de otros defectos.

## Revalidación propuesta tras arreglos

Repetir las reproducciones como tests que ahora exijan rechazo/consistencia; añadir integración PostgreSQL de transacciones y permisos, construir la imagen final, probar desde navegador y ejecutar restore. Sólo después etiquetar cada hallazgo “corregido”. Mantener estado abierto hasta adjuntar evidencia del cambio.
