# Datos del escritorio: esquema e integridad verificados

**11 de septiembre de 2026 · PostgreSQL productivo, consultas sólo de lectura.**

Se accedió por SSH autorizado al contenedor de base de datos de ProSolutions. Cada bloque SQL utilizó transacción `REPEATABLE READ READ ONLY`, `statement_timeout=15s` y `lock_timeout=2s`; la sesión devolvió `transaction_read_only=on`. Las observaciones se obtuvieron entre las 07:45:17 y las 07:47:10 UTC, en transacciones separadas. No se escribieron registros ni se ejecutaron reparaciones, migraciones o backups desde esta revisión.

Se conservaron [28 bloques de resultados de esquema y agregados](evidencias/desktop-business-aggregates.json) y las [consultas SELECT ejecutadas](evidencias/desktop-business-readonly.sql). No se seleccionaron nombres, correos, teléfonos, comprobantes, contraseñas ni identificadores individuales de clientes, productos, ventas o movimientos. Los importes y cantidades mostrados son totales agregados. Los nombres de tablas/columnas son metadatos de esquema.

Los registros provienen de la instancia usada en el escritorio. **No se clasifican como datos de demostración ni se presume pérdida de dinero.** La inspección técnica de procesos, volúmenes y respaldo/restauración se documenta por separado en [Escritorio y datos reales](06-escritorio-y-datos-reales.md).

## Tamaño y actividad observada

| Elemento | Resultado |
|---|---:|
| PostgreSQL | 16.11; zona horaria del servidor UTC |
| Productos | 98 |
| Existencias registradas | 202 unidades |
| Usuarios | 5 |
| Reservas | 3: 1 COMPLETED y 2 CANCELLED |
| Reservas activas o vencidas aún activas | 0 |
| Movimientos de inventario | 153 |
| Movimientos de crédito | 9 |
| Movimientos de caja | 5 |
| Cajas | 1 OPEN, 0 CLOSED |

Estos conteos permiten dimensionar el estado inspeccionado; no indican volumen futuro de ventas ni prueban que la mercancía física coincida con el sistema.

## Esquema real frente al Prisma local

- Se cotejaron **15 modelos y 135 columnas escalares**, además de los enums. No faltan tablas o columnas y no se detectaron diferencias de tipos ni nulabilidad de campos escalares no-array. La tabla adicional `_prisma_migrations` es metadato esperado.
- Todos los enums coinciden, incluido ReservationStatus: **PAID y SHIPPED no existen en la base real**. El fallo de `action=pay` observado con datos sintéticos también enfrenta esa incompatibilidad en el esquema productivo; no se intentó validar ningún pago real.
- `Product.images` permite NULL físicamente como array SQL; se observaron **0 arrays NULL**. Esto se registra como particularidad de almacenamiento, no como evidencia de datos dañados ni como una migración pendiente demostrada.
- Hay **una sola migración registrada**, la de crédito, terminada y sin fallo pendiente. Esto no resuelve el problema de reconstruir una base vacía: esa migración presupone las tablas anteriores.
- Se observaron **0 restricciones CHECK** que impidan cantidades/precios/stock inválidos. Existen claves foráneas, pero las referencias polimórficas `CreditMovement.referenceId` y `CashMovement.referenceId` no están protegidas por FK al documento de origen.
- Las cascadas que eliminan reservas al borrar producto/usuario y movimientos al borrar producto también existen en la base real. Por tanto el riesgo de pérdida de historia del [anexo de integridad](02-integridad-y-negocio.md) no es sólo una diferencia hipotética de configuración.

La comparación anterior no es una validación exhaustiva de todos los defaults, índices y acciones FK contra un DDL generado de nuevo. No debe sustituir el baseline y el ensayo de migración del plan.

## Anomalías comprobadas que necesitan conciliación

| Hallazgo | Qué se observó | Qué no permite concluir | Siguiente acción |
|---|---|---|---|
| D01. Crédito con referencia huérfana | **1 asiento DEBT por importe 1** apunta a una reserva que ya no existe | No identifica la causa del borrado ni prueba que el cargo deba eliminarse | Localizar el documento de origen mediante revisión autorizada del dueño; conservar el asiento y su evidencia hasta resolverlo |
| D02. Reservas canceladas mantienen cargo vinculado | **2 reservas CANCELLED a crédito** conservan 2 DEBT por **200**; no tienen PAYMENT vinculado a esas mismas reservas | Los abonos globales/manuales pueden existir. No demuestra que hoy se deban cobrar 200 ni que sean 200 de pérdida | Conciliar las dos cancelaciones contra abonos y política comercial; registrar compensación trazable si corresponde |
| D03. Existencia actual distinta del último kardex | **3 productos** tienen stock actual distinto del último movimiento; suman 4 unidades actuales frente a 3 en esos últimos movimientos. Diferencia absoluta **3**, neta **+1** | No prueba que falten o sobren físicamente tres piezas. Dos de esos productos tienen una actualización de reserva posterior al último movimiento, sin demostrar causalidad | Revisar reservas, ajustes y conteo físico; registrar movimiento compensatorio o saldo inicial de conciliación con motivo |
| D04. Salto entre movimientos consecutivos | **1 producto** tiene una discontinuidad entre el saldo final de un movimiento y el inicial del siguiente, por **2 unidades**. No hay empates de timestamp que expliquen un orden ambiguo | No identifica qué operación omitió el registro. Puede corresponder a los mismos productos de D03 | Revisar la secuencia y los canales bot/importación/ajuste; documentar el hueco y evitar reescribir movimientos anteriores |

**D02 excluye expresamente COMPLETED:** una venta entregada a crédito puede conservar deuda legítimamente. Tampoco se suman D01+D02 como “dinero perdido”, ni D03+D04 como faltante físico, porque los agregados no permiten esa conclusión.

Los hallazgos D03/D04 son compatibles con los canales que modifican existencias sin generar kardex completo, pero esa es una hipótesis para investigar con el dueño, no una atribución histórica demostrada.

## Comprobaciones que sí coinciden

- **Crédito:** saldo almacenado agregado **601**, suma neta de DEBT menos PAYMENT **601**, y **0 usuarios con diferencias** entre ambos. No hay saldos negativos ni usuarios por encima del límite registrado. La coincidencia aritmética no valida comercialmente los cargos de D01/D02.
- **Productos:** 0 stocks negativos, 0 precios negativos/no finitos, 0 productos activos no universales sin compatibilidad asignada y 0 productos con stock positivo sin movimiento alguno.
- **Inventario:** las 153 filas tienen cantidad positiva; no hay stock histórico negativo ni filas cuyo delta contradiga su tipo/cantidad. Esto no elimina los huecos entre filas ni las discrepancias con el saldo actual.
- **Caja:** cinco entradas suman **851**, compuestas por cuatro referencias SALE por **400** y un abono CREDIT_PAYMENT por **451**. No hay salidas, importes no positivos/no finitos, referencias huérfanas de caja ni referencias duplicadas según las claves revisadas.
- **Crédito vinculado:** no hay grupos duplicados de DEBT por cliente/documento entre las referencias existentes.
- **Cierre de caja:** hay **0 cajas cerradas**, por lo que concordancia del cierre y movimientos posteriores al cierre son **NO EVALUABLES con estos datos**. Un conteo cero de discrepancias de cierre no es una prueba del flujo de cierre.

No se inspeccionó efectivo físico ni se comprobó si las cuatro ventas registradas como entrada fueron realmente cobradas en efectivo. Los defectos de método de pago y de concurrencia siguen abiertos aunque estos agregados no muestren importes negativos o duplicados.

## Orden recomendado antes de migrar

1. Preservar el respaldo verificado por el agente principal y mantener estos agregados como punto de comparación; no ejecutar correcciones automáticas sobre producción.
2. Conciliar con el dueño D01/D02 antes de trasladar crédito como si todos los cargos fueran cobrables. Si crédito deja de usarse, bloquear nuevas operaciones manteniendo historia y resolución de saldos existentes.
3. Contar los productos afectados por D03/D04 y documentar la existencia física, disponible y reservada. No recomputar automáticamente todo el stock desde un kardex con huecos.
4. Corregir transacciones, estados, idempotencia y anulaciones antes del corte; todas las correcciones deben conservar motivo, actor y relación con el registro original.
5. Repetir los agregados después de correcciones y tras restaurar en nube. Conservar también discrepancias aceptadas por el dueño con explicación; que los hashes de un respaldo coincidan prueba copia fiel, no legitimidad de todos los datos copiados.

Esta verificación amplía la auditoría a la base del escritorio. No sustituye recorrido humano del negocio, comprobación de fondos, conteo físico, prueba de carga ni validación de producción posterior a los arreglos.
