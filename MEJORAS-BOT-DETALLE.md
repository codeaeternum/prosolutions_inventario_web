# Mejoras del bot — plan detallado

Cambios concretos en mensajes, flujos y comportamiento para que el bot sea más inteligente y útil. Cada punto indica **archivo**, **qué cambiar** y **texto o lógica sugerida**.

---

## 1. Contexto de corto plazo (sesión por chat)

### 1.1 Objetivo
Guardar en memoria (por `telegramId`) la última acción relevante para poder responder a "más", "detalles", "agregar al carrito" sin que el usuario repita el producto.

### 1.2 Implementación

**Archivo**: `src/bot/index.ts` (y opcionalmente `src/bot/lib/context.ts`).

- **Estructura de contexto** (en memoria, con TTL opcional):
  - `lastSearchQuery: string | null` — última búsqueda de productos.
  - `lastSearchResults: { id, name, retailPrice, stock }[] | null` — últimos productos mostrados (máx. 5).
  - `lastAction: 'search' | 'reservation' | 'sale' | null` — para saber a qué responde "más" o "otro".
- **Dónde guardar**:
  - Tras una búsqueda exitosa (handler de texto que devuelve productos con botones): guardar `query` y lista de productos en `botContext[telegramId]`.
  - Limpiar o no usar `lastSearchResults` cuando el usuario inicia otra búsqueda o un comando.

**Uso**:
- Si el usuario escribe "más", "ver más", "el primero", "el 2":
  - Si hay `lastSearchResults` y la acción fue búsqueda, interpretar "el 1" / "el 2" como selección por índice (igual que el callback de botón) y mostrar detalle o "¿Reservar? ¿Agregar al carrito?" (si es admin).
- Si escribe "otro" o "buscar otro":
  - Limpiar último resultado y pedir "¿Qué producto buscas?"

**Límite**: Mantener solo una sesión de "última búsqueda" por usuario; no persistir en BD para no complicar.

---

## 2. Mensajes de error y siguiente paso

### 2.1 Búsqueda sin resultados

**Archivo**: `src/bot/index.ts`, handler `bot.on('text')` donde se hace la búsqueda de productos.

**Actual** (aprox. línea 2442):
```ts
return ctx.reply(`🤔 No encontré productos para "${query}".\n\nIntenta:\n• Menos palabras\n• /categorias para navegar`)
```

**Mejorar a**:
- Incluir sugerencia concreta: "Prueba con menos palabras (ej: solo «Pantalla») o revisa la ortografía."
- Añadir: "¿Quieres ver el catálogo por categoría? Usa /categorias."
- Opcional: si la búsqueda tiene 1 palabra, sugerir "¿Buscas algo de otra categoría? /modelos para ver por marca."

**Texto propuesto**:
```
🤔 No encontré productos para «{query}».

• Prueba con menos palabras (ej: «Pantalla» o «Batería»).
• Revisa la ortografía.
• Ver todo el catálogo: /categorias o /modelos.
```

### 2.2 Error genérico en búsqueda

**Actual**: `ctx.reply('Hubo un error al buscar.')`

**Mejorar a**:
```
❌ Algo falló al buscar. Vuelve a intentar en un momento.
Si sigue pasando, escribe /ayuda o intenta /categorias.
```

### 2.3 Errores en comandos admin (Prisma no disponible)

**Archivo**: `src/bot/lib/guards.ts` — el mensaje que devuelve `requirePrisma`.

**Actual**: "No disponible temporalmente."

**Mejorar a**:
```
⚠️ El sistema no está disponible en este momento. Vuelve a intentar en unos segundos.
```

---

## 3. Ayuda según rol (/help y /ayuda)

### 3.1 Objetivo
Que `/help` y `/ayuda` muestren un mensaje distinto para clientes y para admins (sin duplicar lógica de comandos).

### 3.2 Implementación

**Archivo**: `src/bot/commands/help.ts`.

- Obtener si el usuario es admin: llamar a `isAdmin(ctx.from.id.toString())` (desde `lib/notify.ts`). Necesita pasar `prisma` o que `isAdmin` ya tenga acceso.
- Si **es admin**, devolver bloque con:
  - Comandos de cliente: /start, /perfil, /categorias, búsqueda por texto.
  - Comandos de admin: /admin (resumen), /vender, /carrito, /agregarc, /confirmarc, /qr, /pendientes, /agregar, /stock, /eliminar, etc.
  - Recordatorio: "/cancelar sale de cualquier proceso."
- Si **no es admin**, mantener mensaje actual o ampliarlo con:
  - "Escribe el nombre de un producto para buscar."
  - "/perfil - Ver tu perfil y código QR."
  - "/categorias - Catálogo por categoría."
  - "/ofertas - Productos destacados."

**Texto sugerido (cliente)**:
```
📋 *Ayuda — ProSolutions*

🔍 Escribe el nombre de un producto para buscar.
   Ej: Pantalla iPhone 15

/comandos:
/start - Reiniciar
/perfil - Tu perfil y código QR
/categorias - Catálogo por categoría
/ofertas - Productos destacados
/miid - Tu ID de Telegram

¿Necesitas algo más? Responde con tu búsqueda.
```

**Texto sugerido (admin)** — después del bloque de cliente, añadir:
```
---
👑 *Comandos de administración*
/admin - Ver todos los comandos admin
/vender <producto> - Venta rápida
/carrito - Ver carrito · /agregarc · /confirmarc · /vaciarc
/qr <producto> - Código QR
/pendientes - Reservas pendientes
/agregar - Nuevo producto · /stock · /eliminar

/cancelar - Sale de cualquier proceso
```

---

## 4. Confirmaciones en flujos críticos

### 4.1 Venta rápida (/vender) — confirmar antes de registrar

**Archivo**: `src/bot/index.ts`, flujo de `/vender` cuando ya hay producto y cantidad.

**Estado actual**: Con un producto y cantidad, se registra la venta directamente (o con "SI" en algún flujo).

**Mejora**: Antes de crear el movimiento, enviar un mensaje de resumen con botón inline "Confirmar venta" y "Cancelar":
- Mensaje: "Vas a registrar: **{producto}** × {cantidad} = **${total}**. ¿Confirmar?"
- Botones: `Markup.inlineKeyboard([ [ Markup.button.callback('✅ Confirmar venta', `confirm_sale_${productId}_${quantity}`), Markup.button.callback('❌ Cancelar', 'cancel_sale') ] ])`
- Handler `bot.action(/^confirm_sale_(.+)_(\d+)$/, ...)` que ejecute la lógica actual de venta y borre la sesión.
- Handler `bot.action('cancel_sale', ...)` que cancele y avise "Venta cancelada."

### 4.2 Eliminar producto — ya pide "SI"

Mantener el flujo actual; opcional: añadir botón inline "Sí, eliminar" / "No" además del texto "SI" para mayor claridad.

### 4.3 Confirmar venta del carrito (/confirmarc)

**Archivo**: `src/bot/index.ts`, comando `confirmarc`.

**Mejora**: Antes de ejecutar la transacción, enviar resumen:
- "Vas a registrar la venta de X productos (Y unidades). Total: $Z. ¿Confirmar?"
- Botones: "✅ Confirmar" / "❌ Cancelar" (callbacks).
- Al confirmar, ejecutar la lógica actual de `confirmarc`.

---

## 5. Sugerencias proactivas

### 5.1 Tras registro exitoso (wizard de /start)

**Archivo**: Donde se crea el usuario al terminar el wizard (paso GOAL, en `index.ts` o en el handler de `reg_goal_*`).

**Añadir** después del mensaje de bienvenida:
```
¿Quieres ver el catálogo? Escribe el nombre de un producto o usa /categorias.
```

### 5.2 Tras búsqueda sin resultados

Ya cubierto en §2.1: sugerir /categorias y /modelos.

### 5.3 Tras mostrar productos (búsqueda exitosa)

**Archivo**: Donde se envía la lista de productos con botones inline.

**Añadir** al final del mensaje (una línea):
```
_También puedes escribir "más" si quieres ver más opciones._
```
(Solo si en el futuro se implementa "ver más" con paginación o más resultados; si no, omitir.)

---

## 6. Respuestas más naturales (detección de intención)

### 6.1 Frases que deben resolverse sin búsqueda

**Archivo**: `src/bot/index.ts`, handler de texto, antes de la búsqueda de productos.

Añadir comprobaciones para:

| Entrada (ejemplos) | Acción |
|--------------------|--------|
| "qué puedes hacer", "ayuda", "opciones", "comandos" | Enviar mismo contenido que /ayuda (reusar función de help). |
| "mi perfil", "ver perfil", "mis datos" | Redirigir a /perfil (reply con "Usa /perfil para ver tu perfil y código QR." o invocar lógica de perfil). |
| "catálogo", "categorías", "ver categorías" | "Usa /categorias para ver el catálogo por categoría." |
| "ofertas", "destacados" | "Usa /ofertas para ver productos destacados." |
| "cancelar", "salir", "no quiero" | Si hay sesión activa (registro, venta, etc.): "Usa /cancelar para salir del proceso." Si no: "No hay ningún proceso en curso. ¿En qué te ayudo?" |

Implementación: array de `{ keywords: string[], action: 'help' | 'perfil' | 'categorias' | 'ofertas' | 'cancelar' }` y comprobar `queryLower` con `includes` o regex suave; luego ejecutar la acción correspondiente.

### 6.2 Saludos ampliados

**Actual**: Lista de saludos y respuesta "¿En qué puedo ayudarte?..."

**Mantener** y opcionalmente añadir al final:
"Si eres admin, escribe /admin para ver comandos de ventas e inventario."

---

## 7. Resumen de mensajes a cambiar (checklist)

| Ubicación | Mensaje actual | Cambio |
|-----------|-----------------|--------|
| Búsqueda sin resultados | No encontré productos... Intenta: Menos palabras, /categorias | Texto §2.1 con sugerencias claras |
| Catch error búsqueda | Hubo un error al buscar | Texto §2.2 con /ayuda y /categorias |
| requirePrisma | No disponible temporalmente | Texto §2.3 |
| /help (cliente) | Comandos disponibles... | Texto §3.2 (cliente) |
| /help (admin) | (igual que cliente) | Añadir bloque admin §3.2 |
| Tras registro wizard | (solo bienvenida) | Añadir sugerencia §5.1 |
| /vender confirmación | (directo a venta) | Añadir resumen + botones §4.1 |
| /confirmarc | (directo a venta) | Añadir resumen + botones §4.3 |

---

## 8. Orden sugerido de implementación

1. **Fase 1 (rápida)**  
   - Mensajes de error (§2.1, §2.2, §2.3).  
   - Ayuda por rol (§3).  
   - Sugerencia tras registro (§5.1).  

2. **Fase 2**  
   - Intención "ayuda", "perfil", "catálogo", "cancelar" (§6).  
   - Confirmaciones con botones para venta y carrito (§4.1, §4.3).  

3. **Fase 3**  
   - Contexto de última búsqueda (§1) y respuestas a "el 1", "más", "otro".  

4. **Fase 4 (opcional)**  
   - Modularizar comandos en `commands/` y handlers en `handlers/` para mantener el bot escalable (según STRUCTURE.md).

---

## 9. Archivos a tocar

| Archivo | Cambios |
|---------|--------|
| `src/bot/index.ts` | Búsqueda sin resultados, error genérico, saludos, intención (ayuda/perfil/catálogo), confirmaciones venta/carrito, contexto última búsqueda (si se implementa), mensaje tras registro. |
| `src/bot/commands/help.ts` | Ayuda según rol (recibir prisma o isAdmin), dos bloques de texto. |
| `src/bot/lib/guards.ts` | Mensaje de requirePrisma. |
| `src/bot/lib/context.ts` (nuevo) | Opcional: objeto `botContext[telegramId]` con lastSearchQuery, lastSearchResults, lastAction. |

Con esto se puede bajar a código cada mejora de forma directa.
