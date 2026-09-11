# ProSolutions Taller: propuesta y plan

Actualizado: 11 de septiembre de 2026. Contexto confirmado por Daniel: taller de electrónicos de distintos tipos, dos locales, dos secretarias y dos técnicos; el dueño es uno de los técnicos. Actualmente utilizan TallerControl. La prioridad es presentar un piloto, observar su uso y ajustar con su retroalimentación. Se mantiene el escritorio; la migración a nube queda aplazada y conserva como referencia un presupuesto inferior a US$20/mes.

## Decisión de producto

Convertir ProSolutions en un sistema de taller e inventario por módulos. La unidad central de trabajo será la **orden de servicio de un equipo**. Recepción, presupuesto, refacciones, cobros y garantía deben referirse a esa orden, sin copiar datos ni registrar el mismo cobro dos veces.

El primer piloto es de recepción y seguimiento, accesible inicialmente para administradores y con datos ficticios. Sirve para evaluar el recorrido, no para sustituir todavía TallerControl ni para llevar los saldos reales de las dos sucursales. No se importó información del proveedor actual.

## Qué aportan las seis referencias

Consulta de páginas oficiales públicas el 11 de septiembre de 2026. Son funcionalidades anunciadas por sus proveedores: no se probaron sus aplicaciones autenticadas, su rendimiento, sus integraciones ni sus afirmaciones comerciales. La selección de prioridades para ProSolutions es una propuesta propia.

| Referencia | Funciones anunciadas que sirven como referencia | Aplicación propuesta para este taller |
|---|---|---|
| [TallerControl](https://tallercontrol.com/) | Recepción de electrónicos, evidencias, seguimiento, roles, sucursales, inventario, caja e impresión. | Aprovechar que el dueño conoce el recorrido para comparar tareas concretas: recibir, cotizar, autorizar, reparar y entregar. No reproducir toda su navegación. |
| [SGTaller](https://sgtaller.com.ar/caracteristicas/) | Órdenes por técnico, presupuestos, stock, cuentas y atención fuera del taller; campos según tipo de equipo. | Fichas adaptables a distintos electrónicos y asignación clara de responsables. Servicio a domicilio sólo si lo utilizan. |
| [ServitechApp](https://servitechapp.com/taller-moviles-celulares-computacion-informatica/) | Órdenes desde presupuestos, serie/IMEI, accesorios, plantillas de inspección, etiquetas, inventario y agenda. | Recepción breve con campos opcionales y listas de revisión por categoría. Las credenciales del dispositivo no deben quedar en notas generales. |
| [Celutaller](https://celutaller.com/) | Órdenes con fotos, historial de clientes y garantías, seguimiento mediante enlace y accesos para empleados/técnicos. | Historial por equipo, cola del técnico y portal de consulta que no revele datos internos. |
| [ReparaCel](https://reparacel.pro/business) | Evidencias de recepción, firma, inventario, gastos, utilidad y seguimiento público. | Priorizar prueba del estado físico, presupuesto entendible y margen real. Firma y autorizaciones deben diseñarse y validarse; no asumir validez jurídica por una afirmación comercial. |
| [Sariely](https://sariely.com/) | Reparaciones vinculadas a consumo de repuestos, POS, gastos y margen por reparación. | Evitar duplicar la salida de una pieza entre venta y reparación; separar cobro, costo y utilidad. |

No necesitamos de inicio un asistente de IA para diagnosticar, contabilidad bancaria completa, una plataforma para cientos de talleres ni conectores para todos los canales. Se reevaluarán si el uso real muestra una necesidad concreta.

## Piloto implementado en esta iteración

- Crear sucursales sin inventar nombres del negocio real.
- Recibir equipos de cualquier tipo; registrar cliente, teléfono, marca/modelo, serie opcional, accesorios, estado físico y falla reportada.
- Folio consecutivo, responsable, sucursal de recepción y ubicación actual por separado.
- Buscar por cliente, teléfono, modelo o serie; filtrar por ubicación y etapa; paginación.
- Registrar diagnóstico y presupuesto en MXN, con importes enteros en centavos.
- Registrar la autorización declarada por el operador, indicando quién y por qué medio. Esto no equivale a una aprobación digital del cliente ni a un comprobante de pago.
- Pasar por reparación, espera de refacción, revisión final, listo y entrega física. La entrega pide identificar quién recibe.
- Registrar llegada a otra sucursal y cambio de responsable, con historial de operador y fecha.
- Rechazar escrituras sobre versiones antiguas de una orden y reintentos duplicados; conservar eventos de órdenes cerradas.
- Seis órdenes ficticias para recorrer el sistema antes de capturar información real.

**Límites visibles del piloto:** acceso de administradores; sin permisos de taller por sucursal/rol; sin fotos ni firma; sin anticipo/cobro/refacción desde la orden; sin reserva de stock por sucursal; sin portal público de seguimiento ni envío automático de mensajes. La ubicación registra una llegada ya verificada: todavía no representa una transferencia con salida, tránsito y aceptación separadas. Los formularios no aceptan campos dedicados a PIN/contraseñas y avisan que no se capturen en notas.

## Flujo objetivo completo

1. Recepción encuentra o crea cliente, identifica equipo y local, registra accesorios/estado, toma evidencia y entrega recibo con folio.
2. El técnico ve su cola, registra diagnóstico y propone refacciones/mano de obra; una revisión que cambie el importe crea otra versión de presupuesto.
3. Recepción comparte el presupuesto; el cliente acepta o rechaza una versión concreta. Se guarda evidencia de esa decisión.
4. Se registra anticipo cuando corresponda, se comprometen refacciones de una ubicación y se programa trabajo. Una pieza comprometida deja de ofrecerse como libre para otra venta.
5. El técnico consume las piezas efectivamente usadas, registra trabajo y realiza revisión final según el tipo de equipo.
6. Recepción avisa que está listo, cobra el saldo con el medio correcto, registra a quién se entrega y emite documentación.
7. Una garantía o regreso crea un caso vinculado a la reparación anterior. Conserva la historia y distingue defecto, retrabajo y costo adicional.

Cancelación, presupuesto rechazado, irreparable, refacción pendiente, cliente que no responde y traslado entre locales son caminos explícitos. No deben resolverse borrando la orden o cambiando existencias manualmente sin motivo.

## Alcance por módulos y criterios de aceptación

| Módulo | Funciones necesarias | Criterio para considerarlo listo | Dependencias / prioridad |
|---|---|---|---|
| Identidad y sucursales | Dueño con acceso global; secretaria por local; técnico con órdenes asignadas; permisos acumulables para el dueño técnico; desactivar usuarios y sesiones. | Una secretaria no opera la caja ajena; un técnico no ve costos/saldos ajenos ni adquiere privilegios editando el navegador. | Antes del piloto con las cuatro personas. P0. |
| Clientes y equipos | Cliente sin cuenta web obligatoria; contactos; historial; varios equipos por cliente; serie opcional; detección de duplicados con revisión humana. | Una segunda visita recupera el historial correcto sin mezclar clientes por nombres similares. | Antes de datos reales. P0. |
| Recepción | Campos breves por tipo de electrónico; checklist, accesorios, fotos, condición, consentimiento versionado, recibo y etiqueta. | Recibir equipo, imprimir folio y volver a abrirlo sin transcribir información. Fotos sólo para usuarios autorizados. | Expandir el piloto actual. P0. |
| Cola técnica | Responsable, prioridades, fechas prometidas, tareas del día, motivo de bloqueo, notas internas y reasignaciones. | Técnico distingue qué puede trabajar, qué está esperando al cliente y qué necesita refacción. | Permisos y órdenes. P0. |
| Presupuestos | Conceptos de mano de obra/refacción, diagnóstico, descuento permitido, vigencia, revisiones y aceptación/rechazo. | Una autorización de un presupuesto viejo no autoriza el nuevo importe. | Órdenes y catálogo de servicios. P0. |
| Refacciones por local | Existencia física, comprometida, disponible, ubicación en estante, costo, mínimos y consumo ligado a orden. | Venta y reparación concurrentes no asignan la misma última pieza. Cancelar libera sólo lo comprometido; consumir no descuenta dos veces. | Migración controlada del stock global. P0. |
| Caja por sucursal | Apertura/corte por local y turno; ingresos/egresos; diferencias; arqueo; medios separados. | Se pueden abrir las dos cajas; una venta con tarjeta no aumenta el efectivo físico. | Reemplazar la caja global del sistema actual. P0. |
| Pagos de órdenes | Anticipo, varios abonos, saldo, crédito autorizado, devolución, conciliación y recibos. | Reintentar un cobro no duplica dinero; el total aprobado, cobrado, devuelto y pendiente concilia. | Presupuesto, caja y registro de pagos. P0. |
| Traslados | Solicitud, salida, en tránsito, aceptación/rechazo en destino; equipo/refacciones y responsable de custodia. | Durante traslado se conoce responsable y ubicación; stock destino aumenta sólo al recibir. | Sucursales, existencias y eventos. P0. |
| Control final y entrega | Checklist por dispositivo, responsable de revisión, accesorios devueltos, saldo y persona que recibe. | No se marca listo sin revisión ni se confunde entrega física con pago. | Pagos y recepción. P0. |
| Garantías | Caso vinculado a orden/parte original, condición pactada, fechas, hallazgo, resolución y costo de retrabajo. | Se abre una garantía sin borrar ni reutilizar la venta original; el costo queda medible. | Entregas y políticas del dueño. P1. |
| Portal del cliente | Enlace privado aleatorio, estados comprensibles, presupuesto autorizable, aviso de listo e instrucciones. | El enlace es revocable; no muestra IMEI completo, notas internas, costos ni datos de otros clientes. | Presupuestos y permisos. P1. |
| Comunicación | Mensajes preparados para compartir; registro del canal y envío; automatización sólo con proveedor configurado y estado de entrega. | No se anuncia “enviado” si sólo se abrió WhatsApp o falló la solicitud. | Portal y autorización operativa. P1. |
| Compras y proveedores | Solicitud de pieza, pedido, recepción parcial, costo/flete, factura del proveedor y devolución de pieza defectuosa. | La refacción comprada para una orden queda vinculada a su llegada y costo. | Inventario por local. P1. |
| POS y catálogo público | Disponibilidad por local, fotos, compatibilidad, precios autorizados, reserva y retiro; productos/servicios juntos. | Un comprador sabe en qué local puede recoger y no ve existencias en tránsito como disponibles. | Inventario, pagos, reservas. P1. |
| Informes del dueño | Órdenes bloqueadas/atrasadas, tiempo por etapa, caja, ventas, costos, margen por reparación/local y garantías. | Las cifras se reconcilian con movimientos y no se presentan cobros como utilidad. | Calidad de datos de módulos previos. P1. |
| Operación y continuidad | Respaldo cifrado automático, copia fuera del escritorio, prueba de restauración, alertas, arranque tras apagón. | Restaurar base y archivos en un entorno limpio y documentar cuánto se pierde desde la última copia. | Antes de uso real. P0. |
| Complementos | Agenda, servicios a domicilio, comisiones, facturación con proveedor, diagnóstico asistido y varias monedas. | Sólo se construye lo que confirme uso real, con costo, permisos y límites conocidos. | Después de estabilizar lo anterior. P2. |

P0 = necesario antes del uso real completo. P1 = siguiente expansión. P2 = opcional. No son fechas prometidas ni funciones ya existentes.

## Plan de ejecución con puntos de decisión

### 1. Presentar el piloto actual

El dueño recorre seis casos ficticios y crea dos propios. Recogemos fricciones observadas y tareas que requieren demasiados pasos. No pedirle diseñar el sistema desde cero. Entregable: lista corta de cambios priorizados y ejemplos concretos. Cierre: puede recibir, encontrar, presupuestar y entregar un equipo ficticio sin ayuda del desarrollador.

### 2. Incorporar a las cuatro personas

Configurar los nombres reales de locales, cuatro cuentas individuales, permisos por función y selección de sucursal. Ajustar recepción con evidencias y tickets. Cierre: pruebas con secretaria/técnico de cada local, incluida denegación de acceso cruzado y pérdida de sesión.

### 3. Unir stock, órdenes y dinero

Añadir existencias por ubicación y reserva de refacciones, caja por sucursal, conceptos de presupuesto y pagos. Mantener un registro de dinero distinto del registro físico de inventario; vincular ambos a una operación con identificador estable. Cierre: venta/reserva/reparación concurrentes, devolución parcial, crédito, traslado y cierre de caja probados juntos.

### 4. Reemplazo controlado de TallerControl

Investigar exportación disponible con acceso autorizado; no se verificó que exista una API/exportación completa. Guardar originales, preparar importación con vista previa, mapeo de estados/clientes/órdenes, detección de duplicados e informe de filas rechazadas. No trasladar PINs o patrones a notas. Decidir fecha de corte y sistema responsable de cada orden abierta. Comparar conteos, saldos, existencias y archivos; ensayar restauración y reversión. No operar el mismo cobro en ambos sistemas.

### 5. Cliente, garantías y compras

Portal privado, presupuesto autorizable, comunicación, garantías, compras y reportes. Automatizaciones de WhatsApp y pagos en línea requieren elegir proveedor y conocer sus costos; no están incluidos por el simple hecho de tener un servidor.

### 6. Reevaluar la nube

Con el piloto aceptado y datos/archivos medidos, actualizar la comparación de nube y costos. Un servidor económico puede caber en US$20, pero base, copias externas, almacenamiento y mensajes comparten ese presupuesto. La disponibilidad del escritorio y un respaldo fuera de él siguen siendo asuntos separados.

## Decisiones pendientes que se obtendrán observando uso

Nombres/direcciones de locales, quién puede ver/atender órdenes de otro local, cómo circulan equipos entre técnicos, políticas de diagnóstico/anticipo/garantía, moneda y medios de pago, impresoras, volúmenes reales y posibilidades de exportación desde TallerControl. No se fijaron porcentajes de anticipo, plazos de garantía ni políticas de equipos no recogidos sin conocer cómo opera el negocio.

## Ideas que conviene validar primero

1. **Bandeja “Qué necesita atención hoy”**: orden sin diagnóstico, esperando respuesta, refacción recién recibida o equipo listo sin recoger, con una acción clara para cada caso.
2. **Etiqueta de custodia**: folio y QR para equipo, bolsa de accesorios y estante; historial de quién lo movió y quién lo recibió en el otro local.
3. **Recepción según tipo de equipo**: consola pide controles/puertos, laptop cargador/batería, audio entradas/salidas. Campos opcionales progresivos para no repetir un formulario enorme.
4. **Presupuesto explicable al cliente**: falla, trabajo, pieza y total en una vista breve; la secretaria comparte la misma versión que autorizó el cliente.
5. **Refacción con procedencia y garantía**: identificar proveedor/lote de una pieza que falla y localizar otras reparaciones afectadas, sin culpar automáticamente al técnico.

## Relación con la auditoría previa

El informe en `../auditoria-2026-09-11/` conserva la evidencia del estado original. Las anomalías históricas de crédito e inventario no se corrigieron automáticamente. Los cambios y pruebas de esta iteración se registran por separado en `03-validacion-y-estado.md`; una prueba local o del piloto no demuestra que producción ya use esos cambios.
