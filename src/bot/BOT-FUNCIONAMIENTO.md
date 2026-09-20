# Cómo funciona el bot de Telegram — ProSolutions

El bot es un cliente de Telegram que comparte la **misma base de datos** que la web. No llama a las APIs de la web: escribe y lee directamente en PostgreSQL vía Prisma. Por eso reservas, productos, usuarios y movimientos creados desde el bot aparecen en la web y viceversa.

---

## 1. Arranque y configuración

- **Entrada**: `src/bot/index.ts` (o `npm run bot:start` / `npm run bot:dev`).
- **Variables de entorno**: `TELEGRAM_BOT_TOKEN` (obligatorio), `DATABASE_URL` (misma que la web).
- **Inicialización**: Crea el cliente Telegraf, conecta Prisma con `getPrisma()`, registra comandos y handlers. Si falta el token, el proceso termina.

---

## 2. Flujos principales

### 2.1 Registro de usuarios (nuevos)

- **Comando**: `/start` (si el usuario no existe en la BD).
- **Módulo**: `commands/start.ts` + wizard en `index.ts` (callbacks `reg_type_1`, `reg_type_2`, `reg_type_3` y handler de texto).
- **Pasos**: Nombre → Tipo de cliente (Técnico / Local / Particular) → Nombre del negocio (opcional) → Teléfono → Meta de compra mensual.
- **Resultado**: Se crea un `User` en la BD con `role: CUSTOMER`, `status: APPROVED`, `telegramId` y un `qrCode` único. Se guarda en `registrationSessions` hasta completar.

### 2.2 Usuario ya registrado

- **Comando**: `/start` (si ya existe un usuario con ese `telegramId`).
- **Respuesta**: Mensaje de bienvenida y sugerencia de buscar productos por texto o usar `/categorias`, `/perfil`, `/ayuda`. Si es ADMIN, se muestra también `/admin`.

### 2.3 Búsqueda de productos (texto libre)

- **Entrada**: Cualquier mensaje de texto que **no** sea comando (no empiece por `/`) y que no esté dentro de un wizard activo (registro, reserva, agregar producto admin).
- **Lógica**: Se divide el texto en palabras (≥ 2 caracteres). Se buscan productos con **AND** (todas las palabras en el nombre). Si no hay resultados, se hace **OR** y se ordena por coincidencias. Solo productos `isPublic: true` y `stock > 0`.
- **Respuesta**: Lista de hasta 5 productos con botones inline; al pulsar uno se abre el detalle (`prod_<id>`).

### 2.4 Detalle de producto y acciones

- **Callback**: `prod_<productId>` (desde búsqueda o desde `/categorias` → categoría → producto).
- **Se muestra**: Nombre, categoría, precio, stock, descripción; si hay imágenes, se envían como foto o grupo de fotos.
- **Botones**:
  - **Todos**: “📅 Reservar (Cliente)” → inicia flujo de reserva.
  - **Solo ADMIN**: “⚡ Venta Rápida (1 un)”, “🛒 (+1) Al Carrito”, “📱 Ver QR”, “🗑️ Eliminar”.

### 2.5 Reserva desde el bot

- **Inicio**: Botón “Reservar (Cliente)” en detalle de producto → callback `reserve_<productId>`.
- **Comprobaciones**: Usuario debe existir en BD (registrado por `/start`). Producto con stock > 0.
- **Pasos**:
  1. El bot pide **cantidad** (mensaje de texto). Se valida que sea ≤ stock. Se guarda en `reservationSessions[telegramId]`.
  2. El bot pide **método de pago**: botones “Pago en Tienda” o “Transferencia (Subir comprobante)”.
  3. Si **Pago en Tienda** → se llama `processReservation(ctx, 'STORE')`.
  4. Si **Transferencia** → se pide **foto del comprobante**. Al recibir la foto se guarda fuera de `public/` en almacenamiento privado (`storage/payment-proofs/`, servido por `/api/payment-proofs/<archivo>` con sesión y propiedad verificadas) y se llama `processReservation(ctx, 'TRANSFER', urlLocal)`.
- **processReservation**:
  - Usa **ajustes**: `reservation_hours` y `bank_info` de `SystemSettings` (configurables con `/ajustes`).
  - Crea un registro `Reservation` en la BD (status `PENDING` o `PENDING_PAYMENT` según método).
  - Resta la cantidad del **stock** del producto.
  - Genera un QR con el ID de la reserva y lo envía al usuario.
  - Notifica a todos los admins por Telegram (el comprobante se revisa solo desde la sesión web autenticada).
- **Importante**: Las reservas del bot **no** pasan por la API REST de la web; se crean directamente con Prisma. La web y el cron de expiración usan la misma tabla.

### 2.6 Ventas rápidas y carrito (solo ADMIN)

- **Venta rápida (1 unidad)**:
  - Callback `fastsell_<productId>` o comando `/vender <nombre>`.
  - Se elige producto (por lista o número). Se pide cantidad. Al confirmar (o con “SI” en venta rápida) se crea un `InventoryMovement` con `type: 'OUT'`, se descuenta stock y se notifica a otros admins con `notifyAdmins`.
- **Carrito**:
  - `/agregarc <nombre>`: busca producto y lo deja en “pendiente”; el usuario escribe la cantidad y se suma al carrito en memoria (`cartSessions[telegramId]`).
  - `/carrito`: muestra ítems y total.
  - `/confirmarc`: por cada ítem del carrito crea un movimiento `OUT` en la BD y actualiza stock; luego vacía el carrito.
  - `/vaciarc`: limpia el carrito en memoria.

Las ventas del bot crean **movimientos de inventario** en la misma tabla que usa la web; por eso en “Movimientos” de la web aparecen también las ventas hechas por Telegram.

### 2.6b Orden de reparación desde el bot (staff: ADMIN/EMPLOYEE con módulo "taller")

- **Comando**: `/orden`. Es el equivalente a `/admin/taller/recibir` de la web.
- **Guard**: el usuario debe existir, estar `APPROVED`, tener rol `ADMIN`/`EMPLOYEE` y el módulo `taller` permitido (`hasModule`, misma regla que `requireModule("taller")` en la API).
- **Pasos** (sesión `sessions.orden[telegramId]`): nombre del cliente → teléfono (7–15 dígitos; 10 dígitos se asumen MX con `normalizePhone`) → tipo de equipo (teclado con los tipos configurados en `workshop_equipment_types`, tope 8 + "Otro"; también acepta texto libre) → marca (texto o chips del catálogo `DeviceModel`; omisible) → modelo (omisible) → falla reportada → sucursal de recepción (solo si hay más de una elegible: activas ∩ `allowedBranchIds`) → confirmación con botones ✅/❌.
- **Creación**: llama `createRepair` (dominio compartido con la web) con la misma forma de datos del intake (`customerName`, `customerPhone`, `equipmentType`, `brand`, `model`, `reportedIssue`, `intakeBranchId`). La llave de idempotencia `bot-orden-<telegramId>-<ts>` se fija al abrir el wizard: doble "Crear" devuelve la misma orden.
- **Respuesta**: folio impreso (`order_prefix`/`order_folio_digits` del negocio) + link de rastreo `/<slug>/order-status?folio=…&t=…` (o `/seguimiento` sin slug).
- **Delegación**: si `resolveRepairPartner` resuelve un taller asociado apto (SystemSettings `repair_partner_business_id` + negocio activo + sucursal + staff), la confirmación agrega el botón "🔧 Enviar a taller asociado" → `delegateRepairToPartner` crea la orden espejo en el tenant reparador y marca la local como `EXTERNAL_LAB` (idempotente: reintentos reportan la misma espejo).

### 2.7 Panel de administración (solo ADMIN)

- **Comando**: `/admin`. Muestra lista de comandos: agregar producto, stock, eliminar, vender, carrito, makeadmin/removeadmin, pendientes, etc.
- **Comandos útiles**:
  - `/agregar`: wizard (nombre → categoría → precios → stock → foto). Crea `Product` en la BD.
  - `/stock <producto> <cantidad>`: actualiza stock del producto.
  - `/eliminar <nombre>`: busca producto, pide confirmación “SI” y elimina de la BD.
  - `/makeadmin <teléfono|telegram_id>`, `/removeadmin`: cambian `role` del usuario a ADMIN o CUSTOMER.
  - `/pendientes`: lista reservas pendientes (PENDING y PENDING_PAYMENT), con expiración; gestionar en la web.
  - `/testnt`: envía un mensaje de prueba a todos los admins (para probar notificaciones).

### 2.8 Notificaciones a admins

- **Función**: `notifyAdmins(bot, message)` en `lib/notify.ts`.
- **Comportamiento**: Busca en la BD todos los usuarios con `role: 'ADMIN'` y `telegramId` no nulo y les envía el mensaje en HTML.
- **Uso**: Tras una venta rápida o confirmación de carrito en el bot; también se puede usar desde la web (p. ej. al crear un movimiento de inventario) si se implementa una llamada al bot o un servicio compartido.

### 2.9 Cron: reservas vencidas

- **Frecuencia**: Cada 30 minutos (`cron.schedule('*/30 * * * *')`).
- **Qué hace**: Busca reservas con `status: 'PENDING'` y `expiresAt < ahora`. Las actualiza a `CANCELLED`, devuelve el stock al producto y envía un mensaje al usuario por Telegram si tiene `telegramId`.
- **Nota**: La web puede tener su propio cron (`/api/reservations/check-expiring`) con lógica similar; ambos trabajan sobre la misma tabla de reservas.

### 2.10 Ajustes del sistema (admin)

- **Comando**: `/ajustes`. Muestra dólar, horas de expiración y datos bancarios. Los valores se guardan en una tabla `SystemSettings` (key/value). El bot usa estos valores en los mensajes (p. ej. datos bancarios para transferencia). Si la web usa la tabla `Settings` (otra tabla), son configuraciones distintas; conviene unificarlas si quieres una sola fuente de verdad.

---

## 3. Sesiones en memoria

El bot guarda estado en objetos en memoria (no en BD):

- **registrationSessions**: wizard de registro (nombre, tipo, teléfono, etc.).
- **adminProductSessions**: wizard de agregar producto (nombre, categoría, precios, stock, foto).
- **reservationSessions**: reserva en curso (producto, cantidad, paso: cantidad / método de pago / comprobante).
- **cartSessions**: carrito de compras (ítems y opcionalmente `pendingAdd` para la cantidad).
- **saleSessions**, **deleteProductSessions**, **qrSessions**, **settingsSessions**: flujos de venta rápida, eliminar producto, generar QR y ajustes.
- **ordenSessions** (`sessions.orden`): wizard de /orden (recepción de reparación); lo limpia /cancelar como el resto.

Si el proceso del bot se reinicia, estas sesiones se pierden; el usuario tendría que volver a empezar el flujo.

---

## 4. Resumen de datos compartidos con la web

| Dato        | Dónde se escribe              | Dónde se lee                    |
|------------|--------------------------------|----------------------------------|
| Usuarios   | Bot (registro) / Web (registro) | Bot y web (por email/telegramId) |
| Productos  | Bot (/agregar) / Web (admin)   | Bot y web                        |
| Reservas   | Bot (reservar) / Web (reservas) | Bot (/pendientes) / Web / Cron   |
| Movimientos| Bot (ventas, carrito) / Web (inventario) | Web (Movimientos, Reportes)   |
| Stock      | Bot y web al reservar/vender/ajustar | Bot y web                   |

Todo se mantiene consistente porque **solo hay una base de datos** y ambos (bot y web) usan Prisma contra la misma.

---

## 5. Cómo probar el bot

1. Crear un bot con [@BotFather](https://t.me/BotFather) y copiar el token en `TELEGRAM_BOT_TOKEN`.
2. Tener la misma `DATABASE_URL` que la web (por ejemplo en `.env`).
3. Ejecutar `npm run bot:dev` (desarrollo) o `npm run bot:start` (producción).
4. Abrir el bot en Telegram y enviar `/start`. Si no estás en la BD, completar el registro. Si ya eres usuario, buscar un producto por nombre o usar `/categorias`.
5. Para probar admin: en la web (o en la BD) dar a tu usuario `role: 'ADMIN'` y asociar tu `telegramId` (después de hablar con el bot puedes ver tu ID con `/miid` y actualizarlo en la tabla `User`). Luego en el bot usar `/admin`, `/vender`, `/agregar`, etc.
