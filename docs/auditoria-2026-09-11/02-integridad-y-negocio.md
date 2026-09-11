# Auditoría de integridad de datos y operación — ProSolutions

Fecha: 2026-09-11. Repositorio revisado: `/Users/galindoasc/Proyectos_Sincronizados/prosolutions_inventario_web`.

Este informe cubre inventario, reservas, ventas, caja, crédito, reportes, importación y diferencias bot/web. No se modificó código de aplicación ni se leyó/escribió la base real. La búsqueda puntual de memoria no encontró referencias a este proyecto.

## Alcance de evidencia

- **Estática:** lectura de handlers, UI, esquema Prisma y única migración versionada.
- **Reproducción aislada:** 12 escenarios ejecutados con los handlers TypeScript reales y Zod real; Prisma, autenticación, NextResponse y notificaciones reemplazados por dobles en memoria. Los dobles NO simulan bloqueos, aislamiento ni rollback PostgreSQL. Por ello las pruebas concurrentes demuestran la intercalación vulnerable del código, no una medición de frecuencia en producción.
- **HTTP + PostgreSQL sintético:** el agente principal confirmó cancelación con deuda restante y dos rechazos que multiplican stock en el [registro autenticado](evidencias/http-authenticated.json). Una comprobación posterior confirmó tres reservas de la última unidad y el error de validar `PAID` en [concurrencia y pago](evidencias/http-concurrency-payment.json).
- **No ejecutado:** inspección/conciliación de producción, comprobantes reales, cobros reales, recuperación de backups de producción, pruebas de carga ni bot contra Telegram real.

Artefactos reproducibles:

- [Harness conservado](evidencias/business-repro.cjs) — carga los handlers auditados, sin red ni BD.
- [Resultados conservados](evidencias/business-repro-results.json) — 12 escenarios; 12 reproducciones logradas, 0 fallos del harness. Esto NO significa 12 pruebas de producto aprobadas: son 12 defectos/escenarios reproducidos.
- Comando desde la raíz del proyecto: `node docs/auditoria-2026-09-11/evidencias/business-repro.cjs`. El archivo conserva rutas del entorno original a código y dependencias; para repetir en otra máquina, ajustar sus constantes y la ruta de salida sobre una copia aislada. Véase [Evidencia y límites](05-evidencia-y-limites.md).

## Conclusión operativa

La aplicación contiene bastante funcionalidad útil, pero actualmente no existe una operación de negocio única que mantenga consistentes pedido, existencias, cobro, crédito y devolución. Cada pantalla/bot modifica las mismas tablas con reglas diferentes. La exposición a cortes de luz se suma a esta fragilidad: mover a nube mejora disponibilidad, pero mantiene las escrituras parciales, cobros duplicados y desajustes contables actuales.

La prioridad es introducir un servicio de dominio compartido, transacciones completas, control concurrente e idempotencia; después conciliar saldos históricos antes de declarar confiables caja, crédito e inventario.

## Hallazgos P1 — resolver antes de ampliar uso

### B01. Stock: comprobación y escritura no forman una operación concurrente segura

- Evidencia: `src/app/api/reservations/route.ts:125-142,200-263`; `src/app/api/inventory/route.ts:183-235`; `src/bot/commands/sales.ts:95-115`; `src/bot/commands/cart.ts:160-176`; `src/bot/commands/catalog.ts:299-357`.
- Web reserva lee stock, crea reserva, mueve crédito, decrementa stock y crea movimiento por separado. Dos solicitudes por la última unidad pueden validar el mismo stock y ambas decrementar. El POS y venta bot escriben un valor absoluto calculado con lectura previa; pierden actualizaciones concurrentes aunque algunas escrituras estén dentro de una transacción.
- Bot `processReservation` ni siquiera vuelve a consultar producto/stock al confirmar: usa `session.price`, cantidad y stock de una sesión anterior. Una segunda compra entre selección y pago basta para sobrevender sin simultaneidad exacta.
- Reproducción aislada: stock inicial 1; dos POST de cantidad 1 -> ambos 201, dos reservas y stock -1.
- **Confirmación posterior HTTP + PostgreSQL sintético:** tres solicitudes concurrentes de una unidad obtuvieron 201/201/201, crearon tres reservas y dejaron stock -2. El [registro conservado](evidencias/http-concurrency-payment.json) demuestra el defecto también con PostgreSQL, sin convertirlo en una prueba de carga representativa de producción.
- Solución: actualización condicional `stock >= quantity` + decremento dentro de una única transacción; verificar filas afectadas, bloquear filas de saldo/stock o serialización con reintento. Un orden estable de bloqueo de productos evita deadlocks en carrito. Añadir restricciones SQL de cantidades/saldos según reglas permitidas.
- Prueba de aceptación: dos conexiones PostgreSQL y barrera antes de adquirir última pieza; exactamente una operación exitosa. Probar POS vs bot vs reserva, también entrada/venta simultáneas.

### B02. Pedidos y carritos dejan ventas/reservas parciales y duplican al reintentar

- Evidencia: `src/app/api/reservations/route.ts:200-263`; `src/app/carrito/page.tsx:60-89`; `src/app/admin/ventas/page.tsx:208-247`; `src/app/api/products/route.ts:164-209`.
- El carrito envía una petición independiente por producto. Si falla la segunda línea, la primera queda comprometida y el carrito original permanece. Reintentar vuelve a enviar también la línea ya vendida/reservada. El POS carga el crédito después de todas las salidas; una caída de red o rechazo de deuda deja mercancía descontada sin cargo correspondiente. Crear producto y registrar stock inicial también ocurre en escrituras separadas.
- Reproducción aislada del POST de reservas: error inyectado al crear el movimiento -> 500, pero reserva persistida y stock 10→9, sin movimiento. En código no existe transacción externa que pueda revertirlos.
- Solución: endpoint de pedido con todas sus líneas, total calculado en servidor, claves únicas de idempotencia y transacción completa. El cliente reintenta la misma operación identificada, recibe el resultado persistido y no reconstruye transacciones monetarias desde varias llamadas.
- Prueba: fallo deliberado en cada escritura/línea; cero efecto parcial o resultado único recuperable. Repetir petición después de timeout no crea nuevas líneas, cargos o salidas.

### B03. POS registra ventas a crédito como dinero en caja; método de pago no se conserva

- Evidencia: `src/app/admin/ventas/page.tsx:190-247`; `src/app/api/inventory/route.ts:247-278`; `src/app/api/credit/payment/route.ts:49-73`; `src/app/api/admin/reservations/[id]/route.ts:113-138`.
- El selector de método del POS no se envía a `/api/inventory`: sólo cambia el motivo textual. Toda `SALE` con total positivo genera `CashMovement IN`, incluso una venta a crédito. Después se carga deuda y el futuro abono vuelve a registrar entrada. Las entregas de reservas con TARJETA o TRANSFERENCIA también se suman al mismo total que se compara con dinero físico.
- Reproducción aislada: POST idéntico al POS con motivo «Venta a crédito», total 100 -> caja recibe 100 sin haber cobrado efectivo.
- Impacto: caja sobrada en sistema, faltante aparente al cerrar y doble reconocimiento al cobrar el crédito. No hay campo estructurado que permita separar efectivo/tarjeta/transferencia en el libro actual.
- Solución: `Sale`, `SaleLine`, `Payment` con método enumerado, moneda, importe y estado; caja física sólo recibe efectivo. Crédito crea cuenta por cobrar, no ingreso de efectivo. Reportar cobrado por medio, vendido y por cobrar separadamente.
- Prueba: ventas de 100 por efectivo/tarjeta/transferencia/crédito; caja física aumenta sólo 100. Abono posterior de crédito por efectivo aumenta otros 100 una sola vez.

### B04. Transiciones de reserva admiten doble restitución, doble cobro y entrega de pedidos terminales

- Evidencia: `src/app/api/reservations/[id]/route.ts:206-237` (`reject` no valida estado); `src/app/api/admin/reservations/[id]/route.ts:43-78,107-138` (`deliver` sin transición válida y `cancel` sólo excluye CANCELLED/COMPLETED); `src/bot/commands/reports.ts:413-428` (`entregar` sólo excluye COMPLETED).
- Rechazar repetidamente, incluso una reserva ya CANCELLED, aumenta stock cada vez. Cancelar EXPIRED o REJECTED con el endpoint admin vuelve a restituir stock previamente liberado. Repetir `deliver` con efectivo genera nuevas entradas de caja. Bot y endpoint admin permiten entregar una cancelada/expirada sin descontar mercancía nuevamente.
- **Confirmación HTTP + PostgreSQL sintético:** tras cancelación y stock 10, dos `reject` devuelven 200 y stock 11/12. El escenario de doble rechazo en memoria también reprodujo 5→9 en lugar de 7.
- Reproducciones aisladas adicionales: dos entregas de una reserva de 200 generan 400 en caja; cancelar EXPIRED aumenta stock 10→12.
- Solución: tabla explícita de transiciones y comando compartido; `UPDATE ... WHERE status = expected`, restitución/cobro sólo para la primera transición; unicidad de evento financiero por reserva/tipo. Estados terminales requieren flujo de nueva venta/reapertura autorizado con asientos compensatorios.
- Prueba: matriz exhaustiva estado×acción×rol×canal, doble click, retry HTTP, dos administradores y vencimiento concurrente con entrega/cancelación.

### B05. Reservas a crédito canceladas/rechazadas/expiradas conservan deuda; cambios de método no compensan

- Evidencia: deuda al crear en `src/app/api/reservations/route.ts:226-243` y `src/bot/commands/catalog.ts:335-351`; cancelación/rechazo/expiración en `src/app/api/reservations/[id]/route.ts:98-149,206-239`, `src/app/api/reservations/check-expiring/route.ts:69-104`, `src/bot/commands/reports.ts:381-390`, `src/bot/index.ts:101-103`; conversión en `src/app/api/admin/reservations/[id]/route.ts:49-61`.
- No hay asiento de reversión de deuda en esos flujos. Convertir CREDIT a otro método modifica la reserva y puede cobrar efectivo sin retirar la deuda. Al pasar a crédito una reserva con anticipo, se carga `totalPrice` completo, sin restar anticipo verificado.
- **Confirmación HTTP + PostgreSQL sintético:** cancelación admin responde 200, reserva CANCELLED, deuda 101 antes y después. Reproducción aislada: mercancía vuelve a stock 10 y deuda 100 sigue pendiente.
- Solución: definir si crédito se compromete al reservar o al entregar; distinguir crédito reservado/deuda efectiva. Cancelación libera compromiso o asienta reversión de deuda original; pagos/anticipos son entidades, se calcula saldo pendiente y se decide devolución/retención explícitamente. No etiquetar reversión como abono de dinero recibido.
- Prueba: reserva crédito→cancelar/rechazar/expirar; depósito parcial→crédito; crédito→efectivo; verificar saldos, asientos y caja una vez.

### B06. Borrar movimiento restablece stock histórico, destruye operaciones posteriores y borra caja cerrada

- Evidencia: `src/app/api/inventory/route.ts:128-157`; UI anuncia «Stock y caja revertidos» en `src/app/admin/movimientos/page.tsx:151-160`.
- DELETE MOVEMENT usa `stock = movement.previousStock`, no inverso del delta sobre saldo actual. Venta vieja de 3 unidades (10→7), reposición posterior de 5 (stock actual 12): al anular vieja venta se obtiene 10, cuando corresponde 15. Se borra físicamente el registro y todo `CashMovement` con ese referenceId, aun de turno ya cerrado. DELETE RESERVATION simplemente elimina el registro, sin devolver stock ni crédito/caja.
- Reproducción aislada: caso 12→10 confirmado con respuesta 200.
- Variante bot carrito: un único movimiento de caja del total apunta sólo al primer InventoryMovement (`src/bot/commands/cart.ts:200-210`). Borrar primera línea elimina cobro de todo carrito; borrar otra deja todo cobro.
- Solución: quitar borrado financiero como forma de anulación; crear contramovimiento enlazado al original, motivo, actor, fecha e importe exactos. Cajas cerradas conservan su fotografía; correcciones se asientan en turno vigente o ajuste documentado.
- Prueba: anular operación antigua entre otras, anular parcial carrito, intentar anular dos veces, anular turno cerrado y verificar trazabilidad completa.

### B07. Eliminaciones en cascada destruyen historia comercial y pueden dejar saldos huérfanos

- Evidencia: `src/app/api/products/[id]/route.ts:251-294`; `src/app/api/users/[id]/route.ts:58-70`; `src/bot/commands/catalog.ts:214-219`; `prisma/schema.prisma:69-74,183,206,251-252,282-286`.
- Producto web bloquea sólo reservas PENDING/DEPOSIT_VERIFIED; APPROVED y PENDING_PAYMENT no bloquean. Después borra TODAS sus reservas y movimientos, incluidos completados. Bot borra producto directamente. Esquema hace cascade a reservas, movimientos e historial de precio. Borrar un cliente puede borrar reservas activas sin liberar stock y eliminar deuda/historial de crédito. `CashMovement.referenceId` y `CreditMovement.referenceId` son texto, sin FK al documento: pueden sobrevivir apuntando a documentos eliminados.
- Estado: estático; no se borraron datos reales ni sintéticos desde estos handlers.
- Solución: archivar producto/cliente con estado y conservar snapshots de venta; restringir eliminación cuando exista historia operativa; privacidad/anónimos sin quitar identidad del asiento. Relaciones explícitas para operación financiera o documento con integridad referencial.
- Prueba: archivar producto con reserva de cada estado y ventas/cobros antiguos; nunca desaparecen folios, deuda ni conciliación; clientes con pedidos activos siguen resolubles.

### B08. Inventario y edición permiten valores inválidos y precios manipulables

- Evidencia: `src/app/api/inventory/route.ts:173-227,247-248`; `src/app/api/products/[id]/route.ts:97-108,150-180`; `src/app/api/caja/route.ts:49-99`; importador `src/app/api/products/excel/route.ts:128-134`.
- Inventario sólo exige valores truthy, no cantidad entera positiva ni enum válido. Cantidad -2 en SALE suma 2 a stock. Tipo desconocido pasa switch sin cambiar stock, pero luego se almacena OUT. `unitPrice`/`totalPrice` se aceptan del cliente sin recálculo ni validación de relación; caja admite monto negativo. Crear producto tiene Zod, editar/importar no aplican el mismo contrato.
- Reproducción aislada: SALE -2 -> 201, stock10→12. Tipo TYPO cantidad2 -> 201, OUT2 con stock10→10.
- Solución: contratos Zod compartidos y restricciones SQL; cantidad entera >0; enumeraciones exhaustivas; importe finito y precisión acotada; total calculado desde precios autorizados en servidor. Descuento/precio manual como permiso y campo auditado, no aceptar totales arbitrarios.
- Prueba: cero, negativos, fracciones, strings, límites grandes, enum desconocido, total distinto de cantidad×precio, precio viejo tras actualización y moneda distinta.

### B09. Crédito pierde actualizaciones concurrentes y puede sobrepasar límite

- Evidencia: `src/app/api/credit/debt/route.ts:28-67`; `src/app/api/credit/payment/route.ts:28-47`; reserva web `src/app/api/reservations/route.ts:178-198,226-243`; bot `src/bot/commands/catalog.ts:310-314,335-351`.
- Cargo/abono leen saldo fuera de transacción y escriben valor absoluto. Dos abonos se registran ambos pero uno sobrescribe el saldo del otro. En reservas el incremento es atómico, pero la validación de límite es anterior: dos reservas pueden pasar y sobrepasarlo.
- Reproducción aislada: deuda100, abonos30/40 simultáneos -> 2 movimientos PAYMENT, saldo60 en lugar30. La intercalación real PostgreSQL requiere prueba adicional controlada.
- Solución: serializar operación por cliente y validar saldo/límite dentro de misma transacción; saldos derivados de libro o caché verificada contra éste; control de versión/actualización condicional e idempotencia.
- Prueba: cargos simultáneos al borde de límite, abonos simultáneos y cargo+abono; saldo final igual a suma algebraica del libro y saldo+crédito reservado dentro de límite autorizado.

### B10. Devoluciones pueden superar lo vendido y devolver efectivo en ventas a crédito

- Evidencia: `src/app/admin/movimientos/page.tsx:171-195`; `src/app/api/inventory/route.ts:201-204,238-250,282-299`; `prisma/schema.prisma:69-71`.
- La UI limita cada devolución a cantidad original pero no resta devoluciones previas. API recibe RETURN sin ID obligatorio de venta original; `relatedId` existe en esquema y no tiene escritores en el código. No valida unidades pendientes de devolución, importe pagado ni medio original. Repetir devolución aumenta stock/caja OUT indefinidamente. En venta a crédito, el flujo puede sacar efectivo en vez de corregir deuda.
- Estado: estático (código directo sin control ni relación); no se efectuó devolución HTTP real.
- Solución: Return y ReturnLine enlazados a SaleLine, cantidades acumuladas, reembolso limitado al pago cobrado y medio definido; crédito como nota de crédito. Separar producto revendible/dañado, revisión y garantía.
- Prueba: dos devoluciones parciales que agotan línea, tercera rechazada; devolución concurrente; devolución de crédito/anticipo/tarjeta; mercancía dañada no aumenta vendible.

### B11. Validar transferencia del bot usa estado PAID inexistente

- Evidencia: `src/app/api/admin/reservations/[id]/route.ts:43-45`; `prisma/schema.prisma:30-39`; `src/components/admin/ReservationsList.tsx:22-32,169-187`.
- Bot crea PENDING_PAYMENT. La pantalla muestra Validar y llama `action=pay`, que escribe `status='PAID'` usando `any`; PAID no está en ReservationStatus. Prisma debe rechazar la actualización. UI también contempla SHIPPED inexistente. DEPOSIT_VERIFIED/APPROVED existen pero la tabla principal sólo muestra Entregar para PENDING/PAID.
- **Confirmación posterior HTTP + PostgreSQL sintético:** `action=pay` devolvió 500 y dejó el registro en PENDING_PAYMENT; [evidencia conservada](evidencias/http-concurrency-payment.json). Se usó una transferencia ficticia; no se verificaron fondos ni pagos bancarios reales.
- Solución: unificar contrato de estados; preferir estado separado de pago y entrega, no agregar PAID apresuradamente a un enum que mezcla ambos. Reusar estados tipados generados y quitar `any` en mutaciones.
- Prueba: reserva de transferencia bot→validación web→entrega/QR; probar también depósito parcial web y comprobar mismo estado en todos los canales.

### B12. Expiración duplicada, incompleta y no recuperable tras fallo parcial

- Evidencia: `src/bot/index.ts:91-115`; `src/app/api/reservations/check-expiring/route.ts:28-104,129-146`.
- Bot cron cada30min sólo toma PENDING, cambia a CANCELLED, devuelve stock sin ledger. Web toma PENDING/DEPOSIT_VERIFIED/APPROVED y usa EXPIRED; PENDING_PAYMENT no vence en ninguno. Ambos pueden seleccionar la misma reserva antes de que uno cambie estado, devolver stock dos veces; no hay transición condicional ni exclusión de ejecución. Web cambia estado antes de devolver stock; si se cae después, la siguiente ejecución ignora ya-EXPIRED y nunca completa devolución. Aviso «sólo una vez» no se marca; se repite cada llamada dentro ventana25-30min.
- Estado: estático. El riesgo de dos workers aumenta al replicar en nube; no se invocaron crons reales.
- Solución: único trabajo de expiración con adquisición por filas, transición condicional transaccional y asientos de liberación; outbox persistida para avisos con clave única; incluir todos los estados por política de pago. Recuperar trabajos vencidos al arrancar y monitorear retraso.
- Prueba: dos workers, caída tras cada escritura, cron detenido1h, reserva PENDING_PAYMENT, entrega simultánea; inventario se libera como máximo una vez, deuda/depósito concilian.

## Hallazgos P2 — exactitud, control y mantenibilidad

### B13. Caja no garantiza un turno abierto único ni cierre consistente

- Evidencia: `src/app/api/caja/route.ts:51-99`; `prisma/schema.prisma:323-340`; consultas `findFirst({status:'OPEN'})` en todos los cobros.
- Dos aperturas pueden superar verificación anterior y crear dos cajas OPEN; no hay restricción única. Movimientos consultan abierta y luego insertan sin bloquear cierre. Venta sin caja simplemente omite `CashMovement`, sin cuenta pendiente explícita. Todos los usuarios comparten la primera caja hallada, sin establecimiento/terminal.
- Estado: estático.
- Solución: una caja OPEN por terminal/local mediante índice parcial, número de turno, cierre con bloqueo y snapshot de esperado/contado/diferencia por moneda/medio; política explícita para vender sin caja.
- Prueba: abrir simultáneamente, vender contra cerrar, abrir segundo terminal, retomar caja al reiniciar; no hay movimientos posteriores a cierre ni importes perdidos.

### B14. Un abono mayor que deuda pierde excedente como saldo del cliente

- Evidencia: `src/app/api/credit/payment/route.ts:31-47,62-71`.
- `Math.max(0, balance-amount)` acepta pago mayor que deuda, asienta y cobra todo pero trunca saldo a0. No modela saldo a favor ni devuelve/excluye sobrante.
- Reproducción aislada: deuda100, abono150 ->200, libro/caja150, saldo0 y 50 sin representación como saldo a favor. El libro histórico permite descubrir diferencia, pero el saldo de uso no la refleja.
- Solución: rechazar excedente y pedir importe exacto o modelar saldo a favor explícito, con permiso y comprobante. Guardar saldo anterior/posterior del recibo.
- Prueba: abono exactamente saldo, mayor saldo, deuda0, centavos y reversión de abono.

### B15. Dinero en Float, sin moneda ni regla única de redondeo

- Evidencia: `prisma/schema.prisma:63-64,98-105,163-165,202-203,232-235,279,328-329,351`; total/depósito en `src/app/api/reservations/route.ts:150-167`.
- PostgreSQL usa DOUBLE PRECISION para dinero; JS multiplica porcentajes sin redondeo de centavos. No hay moneda por venta/pago ni snapshot del tipo de cambio. Acumulaciones pueden divergir del total mostrado a dos decimales; el tipo de cambio posterior no debe reescribir valor histórico.
- Estado: diseño estático; no se cuantificó desajuste en base real.
- Solución: integer minor units o Decimal con precisión contractual; moneda ISO, regla de redondeo por línea/pedido, tipo de cambio capturado al cobrar y distinción entre presentación USD y cobro USD. Migración con comparación antes/después y tolerancia aprobada.
- Prueba: 0.10+0.20, varias líneas con descuento porcentual, anticipo de importe impar, devolución parcial, pago MXN/USD y cambios futuros de tipo de cambio.

### B16. Historial de movimientos omite registros por paginación y filtro SALE excluye ventas POS

- Evidencia: `src/app/api/inventory/route.ts:35-41,46-51,60-109`; normalización SALE→OUT `:223-227`.
- Se pagina cada tabla (movimientos y reservas) por separado con el mismo offset, se fusionan y se corta a limit. Ejemplo limit2: primera página puede tener dos movimientos y descartar dos reservas; segunda salta esas reservas por offset y no vuelven a verse. `productId` sólo filtra movimientos, no reservas. Filtro SALE activa `onlyReservations=true`, por tanto excluye POS/bot almacenados OUT; filtros DAMAGED/LOST/OUT comparten enum y no pueden separarse por tipo real. `previousStock/newStock=0` en reservas de la lista tampoco son evidencia de existencias reales.
- Estado: estático y ejemplo lógico determinista.
- Solución: ledger único o UNION ordenada con paginación global por cursor `(occurredAt,id)`, discriminador de causa estructurado y mismos filtros. Evitar duplicar visualmente evento operativo y su reserva como si fueran dos movimientos.
- Prueba: intercalar tiempos en ambas fuentes, recorrer todas páginas sin huecos/duplicados, filtro producto y tipos; venta POS aparece bajo ventas.

### B17. Reportes muestran totales/rankings/periodos distintos de operación real

- Evidencia: `src/bot/commands/reports.ts:82-101` suma sólo últimos5 movimientos como total caja; `src/app/api/reports/route.ts:23-25,82-99,126-144,170-178,195-215`; dashboard `src/app/admin/page.tsx:28-29,60-67`.
- Bot /caja calcula esperado desde una relación limitada `take:5`, no todos los movimientos: a partir del sexto diverge de web. Top productos/clientes se limita ordenando por conteo total antes de mostrar conteo del período/completadas, excluyendo líderes reales. Top marcas elige cinco por cantidad de modelos antes de contar productos. Reportes usan creación de reserva, no fecha de entrega/pago; dashboard ventas usa texto `reason contains Venta`, omite reservas entregadas y no descuenta devoluciones. Fechas UTC de reportes y medianoche TZ servidor en dashboard pueden cambiar al migrar nube. Valor inventario usa precio mayoreo: debe etiquetarse como valor de venta potencial, no costo/activo contable.
- Estado: estático.
- Solución: métricas definidas sobre eventos Sale/Payment/Return; consultas agrupadas por período correcto y timezone empresarial America/Tijuana; sumar caja sobre todos los movimientos y traer últimos5 sólo como detalle. Costo histórico para utilidad; no inferir venta por texto libre.
- Prueba: 6+ movimientos de caja; producto muy vendido fuera de período frente a uno líder actual; venta/entrega/cobro en días diferentes; cambio horario de Tijuana; reembolso parcial.

### B18. Web y bot cobran precios y usan plazos/configuraciones diferentes

- Evidencia: web precio mayoreo para STORE `src/app/api/reservations/route.ts:150-154`; bot siempre retail en `src/bot/commands/catalog.ts:244-258,308`; bot Settings `src/bot/commands/settings.ts:44-46,68-70`; web Settings `src/lib/settings.ts:3-10,19-48` y bot plazo `src/bot/commands/catalog.ts:317-320`.
- Cliente STORE paga precio mayoreo en web y menudeo en bot. Bot guarda precio al seleccionar sin recalcular al confirmar. Plazo web temporal30min y bot `reservation_hours`24h vienen de tablas/claves distintas. Tipo de cambio bot `usd_rate` con default20 no es Settings.exchangeRate default17.5. Al faltar Settings o ante cualquier error, getSettings retorna incluso información bancaria de ejemplo; puede ocultar configuración incompleta durante migración.
- Estado: estático; corresponde confirmar qué política comercial se desea.
- Solución: servicio común de precios/políticas con versión; cotización con expiración y confirmación si cambió; único sistema de configuración validada. Configuración bancaria faltante debe impedir mostrar instrucciones de pago hasta completarse, no usar datos ficticios silenciosamente.
- Prueba: mismo cliente/producto/cantidad en ambos canales; precio actualizado durante checkout; plazo/configuración bancaria ausente y error transitorio de base.

### B19. Importación y comandos modifican stock/precios sin kardex completo

- Evidencia: `src/app/api/products/excel/route.ts:128-175,178-215`; `src/bot/commands/reports.ts:24-35`; `src/bot/commands/catalog.ts:322-357`; `src/bot/index.ts:101-103`.
- Excel actualiza stock/precios directamente sin InventoryMovement/PriceHistory. Bot /stock sobrescribe sin razón/actor en movimiento; reserva y expiración bot cambian stock sin movimiento. Importador convierte campo vacío/malformado en0; minStock0 se cambia a5 (`||5`). Busca categoría con contains o usa primera categoría. Exporta sólo primer modelo compatible, importador ignora columnas Marca/Modelo: exportación no es respaldo completo ni ida/vuelta confiable. No hay previsualización, transacción de lote ni reporte completo (sólo10 errores).
- Estado: estático.
- Solución: staging y vista previa de diff; validación fuerte por fila, conservación de ID/barcode como texto, categoría exacta y lista completa de compatibilidades; importación mediante mismo servicio de ajustes/precios con runId y auditoría. La conciliación debe saber que el ledger histórico actual puede estar incompleto.
- Prueba: exportar/reimportar sin cambios produce cero diferencias; fila incompleta no pone stock/precio0; preservar código con ceros iniciales, varias compatibilidades, minStock0; corregir y reintentar lote sin duplicar.

### B20. Esquema e historial no modelan suficientemente venta, cobro y saldo histórico

- Evidencia: `prisma/schema.prisma:53-80,228-260,277-291,346-365`; tickets `src/app/admin/tickets/[tipo]/[id]/page.tsx:36-51,91-107`.
- Una venta es hoy InventoryMovement OUT con motivo, sin cabecera Sale, múltiples líneas, cliente, método, moneda, folio global, estado o costo capturado. Stock mezcla disponibilidad con mercancía física: reservar resta stock antes de entregar, pero no hay cantidad comprometida independiente para conteos de estante. Reimprimir recibo de abono muestra saldo ACTUAL del usuario en vez de saldo después del abono histórico. Ticket de venta calcula cantidad×unitPrice, mientras caja usa body.totalPrice y puede no coincidir. Nombre de producto y cliente históricos cambia con catálogo actual.
- Estado: limitaciones de diseño verificadas estáticamente, no errores contables medidos en producción.
- Solución: Sale/SaleLine/Payment/Return, documentos inmutables con snapshots; existencias físicas y comprometidas separadas con disponible derivado. Recibos capturan importe/saldo/medio/actor al emitir; cambio futuro no reescribe el comprobante.
- Prueba: venta con3líneas, cambiar nombre/precio, hacer segundo abono y reimprimir primero; reserva físicamente sigue en estante pero deja de estar disponible; conteo no vuelve a vender comprometido.

### B21. Metas de compra tienen campos y pantalla, pero no ciclo de actualización

- Evidencia: `prisma/schema.prisma:97-101`; `src/bot/commands/reports.ts:258-266`; búsqueda global sólo halló esas lecturas y tipos, sin escritores de totalPurchases/currentMonthPurchases/lastPurchaseReset.
- Las compras no alimentan el progreso ni hay reinicio mensual implementado; el porcentaje puede quedarse congelado, según datos cargados externamente.
- Solución: derivar progreso de ventas confirmadas netas de devoluciones en período local; o implementar proyección auditable. Hasta entonces etiquetar como incompleto/no usar para conceder precios o beneficios.
- Prueba: venta, devolución y cambio de mes actualizan total y progreso correctos sin cron frágil de reset.

### B22. Productos desactivados todavía pueden reservarse con ID conocido

- Evidencia: `src/app/api/reservations/route.ts:125-142`; `src/bot/commands/catalog.ts:241-258,299-357`.
- Listados filtran isActive, pero reserva por ID no lo comprueba. Cliente con carrito antiguo o mensaje de bot puede reservar producto retirado mientras quede stock. Bot tampoco vuelve a validar estado del usuario al confirmar desde sesión antigua (control inicial sí existe).
- Solución: todas las precondiciones del dominio se verifican al confirmar operación, incluyendo activo, política de venta, usuario aprobado y precio vigente.
- Prueba: agregar producto y luego desactivarlo/rechazar cliente antes de confirmar; respuesta controlada y ningún cambio de stock/crédito.

## Migraciones: requisito para restaurar o trasladar la base

Único archivo encontrado: `prisma/migrations/20250310000000_add_credit_module/migration.sql`. Comienza con `ALTER TABLE "User"` en líneas2-3 y sólo agrega crédito; no crea las tablas base. Por inspección, una base PostgreSQL vacía no puede reconstruirse mediante `migrate deploy` con este historial. Esto es un riesgo P1 de reproducibilidad de despliegue/restauración, a integrar con auditoría de infraestructura del agente principal.

Antes de nube: capturar esquema real read-only, comparar con schema.prisma, generar baseline versionado validado, ensayar restauración en base vacía, probar migraciones sobre copia anonimizada y verificar recuentos/restricciones. No lanzar `db push` ciegamente sobre producción ni interpretar que el esquema del repositorio demuestra el estado real.

## Plan de corrección e incorporación de funciones

### Fase 0 — Inventario de operación y respaldo verificable

1. Aclarar con negocio: número de cajas/personas, política de anticipos y expiración, momento de generar deuda, uso real bot/web, venta en USD, devolución/garantía y zona horaria.
2. Respaldo completo verificado en ambiente aislado; baseline de esquema y conteos. Separar producción de pruebas desde configuración.
3. Conciliación inicial sin modificar datos: stock negativo, libro vs saldo de crédito, múltiples cajas abiertas, reservas vencidas no terminales, referencias financieras huérfanas, cajas cerradas alteradas, total de devoluciones. No reconstruir stock histórico sólo con movimientos porque existen canales sin ledger.
4. Contener endpoints de borrado de historia y fijar defectos de estado/validación más directos con pruebas antes de ampliar ventas.

### Fase 1 — Núcleo confiable

1. Servicio `Inventory/Reservation/Sale/Payment/Credit` usado por web y bot; controles de rol se conservan en entrada y actor se pasa al dominio.
2. Modelo mínimo Sale/SaleLine y pago estructurado; importes exactos y snapshots. Pedido completo en una transacción, stock/límite verificados bajo concurrencia.
3. Idempotencia por operación/cliente y eventos únicos de crédito/caja/liberación; outbox de notificación posterior al commit.
4. Máquina de estados de reserva/pago/entrega; comando único de vencimiento; anticipos/deuda/reembolsos coordinados.
5. Anulaciones/devoluciones compensatorias sin DELETE de historia; límites por venta y pago original.

### Fase 2 — Cierre y conciliación diaria

1. Turnos por terminal/local, apertura única, cierre contado contra esperado por medio/moneda, diferencias con motivo y aprobación si procede.
2. Libro de crédito, antigüedad de deuda, fecha de vencimiento, estado de cuenta y recibos históricos estables. Bloqueo por morosidad como política separada del límite.
3. Kardex completo: físico/comprometido/disponible, conteo ciego y ajustes con razón. Alertas de stock bajo y reservas retenidas.
4. Reportes netos de ventas/devoluciones, cobrado/por cobrar, utilidad con costo histórico y rangos de fecha local.
5. Importación con previsualización y reporte descargable; toda operación emite auditoría.

### Fase 3 — Funciones de mayor retorno comercial

1. Compra a proveedores, orden de compra y recepción parcial; costo por lote/proveedor, diferencia recibido vs pedido y devoluciones a proveedor.
2. Reposición sugerida según consumo/plazo de proveedor, stock mínimo por artículo y productos sin rotación.
3. Tickets completos multiartículo con descuento autorizado, cliente y pagos divididos. Reimpresión fiel y búsqueda por folio/código.
4. Garantías/RMA: pieza defectuosa, no revendible, evidencias privadas, revisión, sustitución/reembolso y causa.
5. Seguimiento comercial: historial neto por cliente, mayoreo consistente, alertas de deuda vencida; metas sólo sobre ventas reales.
6. Permisos operativos finos: vender, descontar, ajustar stock, devolver, modificar precio, condonar/cambiar crédito, abrir/cerrar caja.
7. Panel de salud operativa: último backup restaurado, cola de tareas, reservas atascadas, diferencias de conciliación. Modo de contingencia de internet a definir después del núcleo: evitar un POS offline que replique las carreras existentes.

## Criterios de salida antes de corte a nube

- Toda venta/reserva/pago/devolución tiene ID, actor, líneas y asientos consistentes.
- Intentos concurrentes y reintentos no sobrevenden, no duplican caja/crédito y no pierden actualizaciones.
- Matriz estado×acción validada en web y bot; depósitos y deuda no desaparecen ni quedan sin compensación.
- Cajas cerradas y documentos históricos son inmutables; devoluciones/anulaciones tienen contramovimiento trazable.
- Restore de respaldo y aplicación de migraciones en base limpia demostrados; conteos y saldos comparados con origen.
- Conciliación inicial aprobada por quien opera caja/inventario; anomalías históricas registradas, sin corregir silenciosamente por algoritmos.
- Pruebas de integración PostgreSQL complementan el harness de esta auditoría; no declarar producción validada por mocks.

## Comprobación posterior de datos del escritorio

La inspección de datos reales por SSH y sus límites se documenta en [08-datos-verificados](08-datos-verificados.md). Incluye saldos conciliados contra asientos, referencias huérfanas, reservas canceladas con deuda vinculada y diferencias de kardex; no se corrigieron esos registros ni se atribuyeron pérdidas económicas.
