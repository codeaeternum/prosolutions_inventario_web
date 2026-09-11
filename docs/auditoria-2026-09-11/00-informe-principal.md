# ProSolutions: auditoría y decisiones recomendadas

**11 de septiembre de 2026 · Código local, ejecución aislada y comparación de nube**

El proyecto sirve como base para la tienda, pero hoy puede alterar inventario, caja y crédito de forma incorrecta aunque la compilación termine bien. También hay fallas de acceso reproducidas. Recomiendo conservar Next.js/PostgreSQL y simplificar el producto, corregir los flujos centrales y trasladarlo con respaldo y restauración verificados.

Para los **2–3 usuarios simultáneos** que indicas, con tu preferencia de **menos de US$20/mes**, recomiendo evaluar **DigitalOcean 2 GiB con web, bot y PostgreSQL, respaldo diario del servidor y copia externa de datos**: estimación inicial **US$16.60/mes antes de impuestos**. La instancia real contiene una BD de unos 9.1 MiB y 45 archivos de unos 47.6 MiB; una medición de contenedores en reposo sumó unos 229 MiB de RAM. Esto respalda el escenario pequeño, pero los 2 GiB y el costo siguen sujetos a picos de carga, generación de WAL y retención completa de copias. Ya se restauró una copia real; falta automatizar y ensayar la estrategia continua antes de garantizar una factura inferior a US$20. La alternativa con base administrada ronda US$31–35/mes y queda fuera de tu presupuesto actual. La selección y las cifras se desarrollan en el [plan de nube](04-plan-y-nube.md). No se ha contratado ni desplegado ningún servicio.

## Contexto utilizado

- Sistema para el local de reparación de teléfonos de un amigo.
- Compradores consultan precios, disponibilidad y fotografías; reservan o pagan pantallas.
- Uso inicial reducido y poco recorrido por el operador; interesa quitar repetición y módulos excesivos.
- Se tolera una interrupción, pero conservar datos es prioritario. Prefieres menos de US$20 al mes.
- El escritorio GALINDOASC ya se inspeccionó por SSH a través de Tailscale, sin modificar datos comerciales. PostgreSQL 16.11 contiene 98 productos, 5 usuarios y 3 reservas; app y bot estaban activos. PostgreSQL publica 5432 en todas las interfaces del host, sin prueba de accesibilidad desde Internet.
- Se compararon 167 archivos idénticos entre Mac, carpeta sincronizada de Windows y fuente incluida en la imagen del bot. El archivo fuente del Route Handler de uploads sólo está en Mac, pero su artefacto compilado sí existe en la app productiva. Los hashes de package.json y schema.prisma de la app coinciden; esto no atribuye toda la imagen web a un commit. Véase [comprobación del escritorio](06-escritorio-y-datos-reales.md).
- **Se creó un respaldo cifrado fuera de Syncthing y se restauraron BD y archivos reales en aislamiento.** Coinciden conteos y SHA-256 de 16 tablas y 45 archivos. La captura se hizo con el origen activo: dump y archivos no forman una instantánea conjunta atómica. No se restauraron app/bot ni se ensayaron WAL, RPO o RTO.

## Cómo leer la entrega

1. Este documento resume el dictamen y las decisiones.
2. [Seguridad](01-seguridad.md): 14 observaciones con evidencia, precondiciones, remedio y aceptación.
3. [Integridad y negocio](02-integridad-y-negocio.md): 22 observaciones sobre stock, reservas, ventas, crédito, caja y reportes.
4. [Producto y operación](03-producto-y-operacion.md): 30 observaciones sobre interfaz, accesibilidad, Docker, PWA y recuperación.
5. [Plan detallado y nube](04-plan-y-nube.md): orden de trabajo, entregables, costos, migración, retorno y mantenimiento.
6. [Evidencia y límites](05-evidencia-y-limites.md): resultados ejecutados y lo que no se comprobó.
7. [Escritorio y recuperación](06-escritorio-y-datos-reales.md): instalación activa, acceso, copia cifrada y restore real.
8. [Dependencias](07-dependencias.md): versiones afectadas, precondiciones y aplicabilidad de los avisos.
9. [Datos verificados](08-datos-verificados.md): esquema y agregados reales, anomalías que requieren conciliación y límites de interpretación.

Los anexos se cruzan: una venta parcial puede ser simultáneamente problema de interfaz, integridad y recuperación. Sus cantidades **no son un total de defectos independientes**. Las fases de este resumen y del plan prevalecen sobre estimaciones orientativas de los anexos.

## Resultado de las verificaciones

| Verificación | Resultado observado | Qué demuestra |
|---|---|---|
| Instalación desde lockfile | Correcta | Dependencias instalables en copia limpia |
| Tests existentes | **21/21**, 3 archivos | Utilidades y redirecciones; no cubren ventas/reservas reales |
| TypeScript | Sin errores | Tipado compilable; el uso de `any` oculta estados inválidos |
| Build Next.js | Correcto, 16.1.6 con Turbopack | Puede compilar el código actual |
| Build Docker en OrbStack | Correcto, imagen Linux arm64 local | La imagen se construye; no prueba x86 del escritorio o nube |
| Arranque Docker con BD sin tablas | Arranca; health **200**; catálogo **500** | El health actual produce un falso estado saludable |
| Prisma dentro de imagen final | `prisma: not found` | El intento de sincronización del entrypoint falla y se oculta |
| Migraciones sobre BD vacía | **P3018 / relation "User" does not exist** | Falta una migración base reproducible |
| Lint principal | Falla: `next lint` no existe en esta versión | El comando documentado no verifica calidad |
| ESLint directo | **64 errores y 89 avisos**, 153 archivos | Deuda técnica concreta; no equivale a 64 vulnerabilidades |
| Dependencias, todas | **53 avisos:** 4 críticos, 31 altos, 15 moderados, 3 bajos | Coincidencias con avisos del registro a la fecha |
| Dependencias, omit=dev | **39 avisos:** 3 críticos, 26 altos, 9 moderados, 1 bajo | No es inventario exacto de módulos cargados en producción |
| PWA tras build normal | `/sw.js` **404**, sin worker generado | El icono/manifiesto no demuestra PWA offline funcional |
| Pruebas de defectos con dobles | 12 negocio + 9 seguridad reproducidas | Se ejecutó código real con BD/auth/Telegram simulados |
| Respaldo/restauración sintéticos | 3 usuarios, 27 productos, 5 reservas y 1 movimiento de crédito coinciden | Prueba inicial limitada con fixture de defectos |
| Inspección del escritorio por SSH | Instancia y volúmenes activos identificados; PostgreSQL 16.11; 98 productos, 5 usuarios y 3 reservas | Estado real observado; no prueba de carga ni conciliación comercial |
| Configuración y GET del servicio real | Next 16.1.6/Node 20.20.2; contraseña DB coincide con default; GET anónimo incluye campos internos | Configuración vigente y filtrado insuficiente confirmados; alcance desde Internet no probado |
| Respaldo/restauración reales | **16 tablas y 45 archivos coinciden en conteos y SHA-256** | Copia cifrada recuperable en aislamiento; no restore de roles/secretos/app/bot ni ensayo de recuperación continua |

Los avisos de dependencias requieren análisis de aplicabilidad. Por ejemplo, el aviso de ejecución remota específico de Windows no prueba explotación de una aplicación dentro de un contenedor Linux; los avisos de correo/OAuth de Auth.js no implican que esos proveedores estén configurados aquí. Sí urge actualizar Next.js y revisar el procesamiento de imágenes y los controles de sesión. [Detalle y fuentes](05-evidencia-y-limites.md).

La [revisión de datos reales](08-datos-verificados.md) también encontró diferencias entre existencia y kardex y referencias de crédito que requieren conciliación. No se presume pérdida de dinero ni faltante físico: la fidelidad del restore conserva tanto los datos correctos como sus posibles inconsistencias.

## Hallazgos que bloquearían un traslado literal a Internet

**P0 significa resolver antes del corte público; no significa que se haya observado un ataque.**

| Problema | Evidencia concreta | Acción necesaria | Referencia |
|---|---|---|---|
| Modificación del catálogo sin login | POST anónimo cambió un nombre en PostgreSQL sintético | Retirar endpoint de mantenimiento público; operación administrativa auditada | SEC-01 |
| JavaScript ejecutado al terminar login | Un callback de prueba cambió el título del navegador bajo la sesión iniciada | Admitir únicamente destinos locales seguros | SEC-06 |
| Costos internos públicos | GET anónimo sintético y GET de sólo lectura al servicio real incluyen costo/mayoreo/datos internos; evidencia real conserva sólo claves | DTO público explícito y precio según permiso vigente | SEC-02 |
| Comprobantes bancarios públicos | Imagen conocida responde 200 sin sesión; archivos nuevos llevan caché pública de un año | Almacenamiento privado y acceso por propietario/admin | SEC-05 |
| Privilegios revocados siguen funcionando | Admin degradado a cliente rechazado todavía obtiene usuarios con su cookie anterior | Revalidar cuenta/rol/estado en operaciones y revocar sesiones | SEC-03 |
| Autoaprobación en Telegram | Escribir la meta permite APPROVED; usar botón da PENDING | Unificar registro y política de aprobación | SEC-04 |
| Límite de login evadible | Claves de formulario codificadas evitan el contador en prueba aislada | Limitar el endpoint y cuenta/IP sin heurística sobre texto crudo | SEC-07 |
| Configuración DB peligrosa confirmada | Contraseña real coincide con default Compose y 5432 está publicado en interfaces del host; no se probó acceso desde Internet | Rotar DB coordinando app/bot, cerrar publicación y exigir secretos seguros; no modificado en esta auditoría | SEC-09/10 |
| Reservas concurrentes sobreasignan la última pieza | **Prueba aislada por HTTP/PostgreSQL: tres reservas para una pieza, 201/201/201 y stock −2** | Validación y actualización condicional dentro de transacción | B01 |
| Rechazos y entregas repetidos | Dos rechazos de cancelada: stock 10→11→12; dobles cobros en reproducción aislada | Transiciones de estado condicionales e idempotencia | B04 |
| Cancelación conserva deuda | Reserva cancelada; saldo de crédito sigue en 101 | Revertir compromiso/deuda y conciliar pagos | B05 |
| Anulación borra historia y stock posterior | Se restaura el stock antiguo y se eliminan asientos | Contramovimientos, nunca reescribir historia | B06/07 |
| Ventas/checkout parciales | Una llamada por línea; deuda posterior en otra llamada | Comando de venta/pedido completo con identificador de reintento | B02, U04 |
| Crédito/tarjeta confundidos con caja | El método no se envía; toda venta crea entrada en caja | Separar venta, pago, cuenta por cobrar y efectivo | B03 |
| Traslado no reproducible | Imagen omite CLI funcional, fallo silenciado y migración base ausente | Migración previa controlada, readiness real y restauración ensayada | O01/02 |

## Bugs visibles que conviene arreglar en la primera entrega

| Módulo | Fallo | Cambio propuesto |
|---|---|---|
| Catálogo | Sólo muestra los primeros 20 productos; probado con 25 activos | Paginación/cargar más y total real |
| Búsqueda | Filtro pierde foco al teclear, confirmado en navegador | Componente estable, cancelación de búsquedas obsoletas |
| Reservas cliente | Cancelar su propia reserva devuelve 403 | Permitir la acción del propietario con validación de estado |
| Pago por depósito | Cliente recibe 403 al subir comprobante | Endpoint privado específico de comprobantes |
| Validación de transferencia | `action=pay` intenta guardar PAID, enum inexistente; HTTP 500 reproducido | Unificar estados de pago y entrega |
| Mis reservas | Sólo primera página; PENDING_PAYMENT no aparece en grupos | Consultas y agrupación exhaustivas |
| Escaneo POS | Toma primer resultado aproximado; puede ser otro código | Coincidencia exacta al escanear |
| Productos admin | Buscar desde página avanzada puede aparentar catálogo vacío | Reiniciar página y conservar filtros en URL |
| Etiquetas | Selección de varias páginas se imprime incompleta | Resolver todos los IDs seleccionados |
| Cámara | Se solicita un stream preliminar que no se detiene | Un único controlador de cámara con limpieza |
| Caja | Doble envío y conteo físico precargado con el esperado | Idempotencia y conteo obligatorio inicialmente vacío |
| Bot/caja | Total calculado sólo con los últimos cinco movimientos | Agregado completo y últimos cinco sólo como detalle |
| Precios | STORE usa mayoreo web y menudeo bot | Servicio único de cotización |
| Plazos | Web/bot/pantalla usan configuraciones distintas | Política única de reserva y fechas del servidor |
| Reportes | Mezclan reserva, entrega, venta y cobro; filtros omiten operaciones | Métricas derivadas de documentos y fecha de negocio |
| Archivos Excel | Puede poner ceros, perder compatibilidades y saltarse el kardex | Vista previa, validación y ajustes auditados |
| Móvil/accesibilidad | Navegación duplicada, botones sin nombre y controles no accesibles | Un shell por rol y controles semánticos |
| PWA/notificaciones | Worker ausente, push incompleto, SSE e historial locales | Elegir alcance real y probar reconexión/privacidad |

No propongo “arreglar” comprobantes haciendo pública una ruta de administrador ni dar por corregida seguridad porque desaparezca un botón: los controles deben existir en el servidor.

## Simplificación del producto para esta tienda

La estructura actual hace que la misma operación exista en varios lugares con reglas diferentes. Eso añade más riesgo que beneficio con el uso previsto.

**Conservar como núcleo:**

- Catálogo web navegable sin cuenta, con información pública acordada.
- Inventario con precio, compatibilidad, fotos, existencia disponible y ubicación.
- Pedido/reserva con un folio, anticipo/saldo y una sola acción clara de entregar o cancelar.
- Venta en mostrador y ticket completo.
- Caja sencilla si el dueño realmente registra efectivo en el sistema.
- Avisos al dueño por Telegram y consulta del estado del pedido.

**Unificar:**

| Hoy | Propuesta |
|---|---|
| Varias páginas/handlers para aprobar, verificar, pagar y entregar | Una bandeja “Pedidos” y el mismo servicio de transición |
| Inventario, movimientos y ventas con acciones que se cruzan | Productos + historial de existencias; ventas/pedidos como documentos |
| Marcas, modelos y categorías en navegación principal | “Catálogo → Configuración de catálogo” |
| Reglas comerciales duplicadas en bot y web | Una lógica compartida; bot como otro canal |
| Varias vistas de reportes y tablero | Un resumen de ventas, cobros, stock bajo y pendientes |

**Deshabilitar por configuración hasta confirmar que se usan:** crédito, metas mensuales, notificaciones push y gestión administrativa extensa por bot. La desactivación debe bloquear también sus APIs/comandos, además de ocultar menús; conservar datos históricos y acceso autorizado para conciliarlos. Metas y push están incompletos; crédito presenta riesgo financiero y no debe activarse por defecto. Estos módulos pueden corregirse después si quedan deshabilitados de forma efectiva. El corte a nube exige que el núcleo habilitado —acceso, catálogo, stock, pedidos/ventas, pagos usados y recuperación— pase sus pruebas y que los saldos pendientes estén identificados.

**Posponer:** app nativa, IA/Ollama, multi-sucursal, réplica activa del sistema del escritorio y nube, Kubernetes, Redis para todo y operación de ventas offline. Ninguna es necesaria para resolver el problema descrito. Un modo de contingencia puede conservar borradores, pero no anunciar una venta como confirmada sin respuesta del servidor.

Navegación sugerida del dueño: **Inicio · Productos · Pedidos/Ventas · Caja · Ajustes**. En móvil, las acciones más usadas deben ser buscar/escanear, registrar venta y revisar pendientes.

## Funciones nuevas por valor para el negocio

Son propuestas a validar con tu amigo, separadas de los bugs.

| Orden | Función | Beneficio | Alcance mínimo |
|---|---|---|---|
| 1 | Venta/pedido multiartículo y ticket único | Evita registros parciales y facilita entregar/cobrar | Folio, líneas, pagos, estado y reimpresión fiel |
| 2 | Garantías y devoluciones | Evita revender piezas defectuosas y perder trazabilidad | Venta original, cantidad pendiente, motivo, foto privada, resolución |
| 3 | Ubicación física y conteo | Encuentra piezas y detecta faltantes | Cajón/estante, conteo ciego, ajuste con motivo |
| 4 | Variantes de pantalla | Reduce compras equivocadas | OLED/LCD, calidad, color, marco y compatibilidades estructuradas |
| 5 | Recepción de proveedores | Controla entradas y costo real | Proveedor, recepción, cantidad, costo y comprobante |
| 6 | Reposición sencilla | Evita agotados sin sobrecomprar | Mínimo, stock reservado/disponible y sugerencia revisable |
| 7 | Pago en línea, si se necesita cobro automático | Reduce verificación manual | Pasarela, webhook firmado/idempotente, conciliación y reembolso |
| 8 | Recuperación de cuenta y acceso del dueño | Reduce dependencia del desarrollador | Identidad verificable, recuperación, acceso individual y revocación |

Hoy “pagar” significa principalmente registrar medio/comprobante y verificarlo manualmente; no se encontró un ciclo completo de pasarela que confirme fondos automáticamente. No debe mostrarse “pagado” por haber subido una imagen. Comisiones y requisitos del proveedor de pagos quedan fuera del costo de infraestructura y necesitan selección aparte.

## Qué ya está bien y conviene conservar

Prisma/PostgreSQL permiten construir transacciones y restricciones sin sustituir toda la base. Hay hash bcrypt, validación Zod en varias altas, guardas de roles en muchas APIs, restricciones owner/admin en consultas de reserva, consultas SQL parametrizadas revisadas, health con consulta de conexión y usuario sin privilegios en la imagen web. Existe una base visual reutilizable y compatibilidad producto↔modelos.

No encontré motivo para reescribir la aplicación desde cero. La solución es unificar reglas y completar controles, con mejoras verificables por módulo.

## Próximos pasos concretos

1. **Conciliar los datos con el dueño y formalizar respaldos automáticos** a partir de la instancia ya identificada y de la copia real restaurada. Conservar ese respaldo y ensayar una captura coordinada de BD y archivos para el corte.
2. **Cerrar acceso y corrupción reproducidos** con pruebas de regresión que hoy faltan.
3. **Ensayar el traslado completo** en entorno privado: además de BD y archivos, levantar app/worker con comunicaciones externas deshabilitadas, comparar saldos y medir recuperación.
4. **Elegir/contratar la nube y ejecutar el corte** sólo con proveedor/costo aceptados y restauración comprobada.
5. **Validar con tu amigo cinco operaciones reales controladas**: alta de producto, venta, reserva, cancelación y devolución; retirar del menú lo que no use.

La auditoría del código y la inspección del escritorio, junto con el respaldo y restore puntual de datos reales, están realizados. La conciliación con el dueño, validación física del teléfono/impresora, automatización de respaldos, ensayo completo de recuperación y migración a nube permanecen pendientes.
