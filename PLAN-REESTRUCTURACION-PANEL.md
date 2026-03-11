# Plan de reestructuración del panel admin y bot

## Resumen ejecutivo

Objetivos: eliminar lo innecesario (toggle MXN/USD), corregir inconsistencias (nombres, duplicación Inventario/Movimientos), mejorar el dashboard con accesos directos útiles, concentrar Escanear reserva dentro de Reservas, y hacer el bot más inteligente. Este documento es la guía técnica para implementar los cambios por fases.

---

## 1. Moneda: quitar toggle pesos/dólares

### Estado actual
- `CurrencyProvider` en `layout.tsx` ofrece `currency`, `setCurrency`, `exchangeRate`, `formatPrice(priceInMXN)`.
- `CurrencyToggle` / `CurrencyToggleCompact` en: header admin, catálogo, perfil.
- `PriceDisplay` y páginas usan `formatPrice`; en USD se convierte con `exchangeRate`.
- Configuración guarda `exchangeRate` en BD.

### Cambios
| Acción | Archivo / lugar |
|--------|-----------------|
| Dejar de mostrar cualquier toggle de moneda | `components/admin/header.tsx`, `app/catalogo/page.tsx`, `app/perfil/perfil-client.tsx` |
| Simplificar `CurrencyProvider` | Solo exponer `formatPrice(priceInMXN)` en MXN; opcional mantener `exchangeRate` en contexto para reportes futuros pero sin UI de cambio. |
| Mantener precios en MXN en toda la app | Quitar rutas que usen `currency === "USD"` en `formatPrice` y en `PriceDisplay`. |
| Opcional | Eliminar o deprecar `CurrencyToggle` y `CurrencyToggleCompact`; si no se usan en ningún otro sitio, borrar `components/currency-toggle.tsx`. |
| Configuración | El campo `exchangeRate` en Configuración puede quedarse para uso futuro (reportes/export) pero no para un toggle visible. |

### Referencias a tocar
- `src/components/currency-provider.tsx`: dejar `formatPrice` siempre en MXN; quitar o no usar `setCurrency` en UI.
- `src/components/price-display.tsx`: quitar `showOriginal` / lógica USD o usar siempre MXN.
- Quitar import y uso de `CurrencyToggleCompact` en header, catálogo y perfil.

---

## 2. Dashboard

### Problemas actuales
- La tarjeta **Stock Bajo** usa `Badge variant="destructive"` cuando hay alerta; al mostrarse solo en esa tarjeta, puede hacerla más alta que las otras tres y romper la cuadrícula.
- Falta de accesos directos a acciones frecuentes (venta rápida, agregar producto, escanear, etc.).

### Cambios

#### 2.1 Igualar altura de las 4 tarjetas
- Evitar que solo una tarjeta tenga badge: **opción A** — en todas las tarjetas reservar la misma zona para “alerta” (texto o badge), y en las que no tengan alerta mostrar un espacio vacío o texto fijo (ej. “Al día”) para que la altura sea igual. **Opción B** — no usar badge dentro de la tarjeta; usar un indicador visual mínimo (punto, icono) o texto corto en la misma línea que la descripción, sin aumentar altura.
- Aplicar `min-height` o estructura de contenido idéntica en las 4 cards (mismo número de líneas / bloques).

#### 2.2 Contenido que importa
- Mantener: resumen de Productos, Usuarios, Reservas pendientes, Stock bajo (como métricas).
- Mantener: bloque de reservas pendientes recientes y enlace a Reservas.
- Mantener: alerta de stock bajo con lista de productos y enlace a productos filtrados.
- Opcional: reducir o quitar la tarjeta “Marcas” si no es prioritaria; o dejarla como métrica secundaria.

#### 2.3 Accesos directos (atajos)
- Añadir una sección “Accesos rápidos” con botones o enlaces claros:
  - **Venta rápida** → `/admin/ventas`
  - **Agregar producto** → `/admin/productos/nuevo`
  - **Escanear producto** → `/admin/productos/escanear`
  - **Reservas** → `/admin/reservas`
  - **Registrar movimiento** → `/admin/movimientos` (o a Inventario si ahí se centraliza “registrar movimiento”; ver sección 5)
- Ubicación: debajo de las 4 tarjetas o en una barra horizontal, siempre visibles sin scroll en desktop.

---

## 3. Menú lateral y nombres

### Cambios acordados
| Actual | Nuevo / Acción |
|--------|-----------------|
| "Ventas" (Operaciones) | **"Venta rápida"** (para que coincida con la función). |
| "Escanear reserva" (ítem en menú) | **Eliminar** del sidebar. El escaneo de reservas se hace desde la página Reservas con un botón “Escanear”. |

### Estructura objetivo del menú (Operaciones)
- Venta rápida  
- Reservas  
- Inventario (redefinido; ver sección 5)  
- Movimientos  

Sin ítem “Escanear reserva”.

### Archivo
- `src/components/admin/sidebar.tsx`: cambiar label "Ventas" → "Venta rápida"; quitar el ítem `{ name: "Escanear reserva", href: "/admin/verificar", icon: QrCode }`.

---

## 4. Reservas: botón Escanear

### Cambios
- En la página **Reservas** (`/admin/reservas`), añadir un botón visible **“Escanear”** (icono QR/cámara) que lleve a `/admin/verificar` (página donde se escanea el QR de la reserva y se redirige a verificar/entregar).
- Así, “Escanear reserva” deja de ser un ítem del menú pero sigue estando disponible desde el contexto correcto (Reservas).

### Archivos
- `src/app/admin/reservas/page.tsx`: en el header o barra de acciones, añadir `<Link href="/admin/verificar">` o `<Button asChild><Link>Escanear</Link></Button>` con icono (ej. `QrCode`).

---

## 5. Inventario vs Movimientos: redefinir y desduplicar

### Problema actual
- **Inventario** muestra una lista de “movimientos” (historial) + flujo “Nuevo Movimiento” + escáner.
- **Movimientos** muestra el historial completo de movimientos con filtros y tabla.
- Hay duplicación de “historial de movimientos” y confusión de roles.

### Definición objetivo

| Módulo | Propósito | Contenido |
|--------|-----------|-----------|
| **Inventario** | Estado actual del stock y acciones para modificarlo. | Vista útil del stock (por producto o resumen), alertas de stock bajo, y **una sola acción principal**: “Registrar movimiento” (entrada, salida, ajuste, etc.). **No** incluir lista larga de historial; en su lugar un enlace: “Ver historial en Movimientos”. |
| **Movimientos** | Historial y trazabilidad. | Listado completo de movimientos (tabla), filtros por tipo y fecha, y eliminación/anulación si aplica. Sin duplicar el flujo “nuevo movimiento”. |

### Cambios técnicos

1. **Inventario** (`src/app/admin/inventario/page.tsx`):
   - Quitar la sección “Historial de Movimientos” (la lista de movimientos y sus filtros).
   - Mantener (o añadir si no existe) una vista breve de “Estado de stock”: por ejemplo productos con stock bajo o lista compacta de productos con cantidad, con enlace a Productos o a filtro `?filter=low-stock`.
   - Mantener el flujo “Nuevo Movimiento”: botón, diálogo con búsqueda/escáner de producto, tipo de movimiento, cantidad, notas.
   - Añadir un enlace/botón: “Ver historial completo → Movimientos” que lleve a `/admin/movimientos`.

2. **Movimientos** (`src/app/admin/movimientos/page.tsx`):
   - Dejar como está: solo historial (tabla + filtros). Opcional: añadir en la parte superior un enlace “Registrar movimiento → Inventario” para quien llegue buscando “dónde registro un movimiento”.

3. **Menú**
   - Inventario: descripción corta en el menú o tooltip que deje claro que es “Stock y registrar movimientos”.
   - Movimientos: “Historial de movimientos”.

### APIs
- Sin cambios de API: Inventario sigue usando `POST /api/inventory` para crear y podría usar `GET /api/inventory` o `GET /api/products` para la vista de stock; Movimientos sigue con `GET /api/inventory` para listar.

---

## 6. Bot: hacerlo más inteligente

### Áreas de mejora

1. **Contexto y memoria de corto plazo**
   - Mantener contexto de la última acción (ej. “última búsqueda”, “última reserva consultada”) para respuestas del tipo “dame más detalles” o “agregar al carrito” sin repetir datos.
   - No requiere BD; puede ser sesión en memoria por `chatId` con TTL.

2. **Sugerencias proactivas**
   - Tras registrar un usuario: “¿Quieres crear una reserva?”
   - Tras una búsqueda sin resultados: “¿Quieres que busque por categoría o que te muestre productos similares?”
   - Recordatorios suaves: reservas por vencer, stock bajo (si el bot tiene acceso a esos datos).

3. **Respuestas más naturales**
   - Detección de intención: “quiero reservar X”, “cuánto cuesta Y”, “cancelar mi reserva”, “ver mi perfil”.
   - Respuestas en lenguaje natural en lugar de solo listas o comandos.
   - Mensajes de error amigables con siguiente paso sugerido.

4. **Comandos y descubribilidad**
   - `/help` por contexto (ej. “En ventas puedes usar: agregar, ver carrito, confirmar”).
   - Respuesta a “qué puedes hacer” o “ayuda” con un menú corto de acciones según rol (cliente vs admin).

5. **Validación y reconfirmación**
   - En flujos críticos (venta, eliminar, cambiar stock), pedir confirmación antes de ejecutar.
   - Resumen claro antes de confirmar: “Vas a registrar: Producto X, cantidad 2, tipo Entrada. ¿Confirmar?”

6. **Modularización (ya en STRUCTURE.md)**
   - Extraer comandos y flujos a `commands/` y `handlers/` para poder mejorar “inteligencia” por flujo (búsqueda, reserva, venta) sin tocar todo el `index.ts`.

### Plan de implementación bot (por fases)
- **Fase 1**: Mejorar mensajes de error y sugerencias en flujos existentes (búsqueda sin resultados, registro, reserva).
- **Fase 2**: Añadir contexto de última acción en sesión (por chatId) y respuestas que lo usen.
- **Fase 3**: Respuestas a “qué puedes hacer” / “ayuda” según rol.
- **Fase 4**: Confirmaciones en flujos críticos y mensajes más naturales.
- **Fase 5**: Modularizar y, si se desea, integrar un pequeño “motor de intención” (keywords + respuestas) sin necesidad de IA externa.

---

## 7. Orden sugerido de implementación

1. **Moneda**: quitar toggles y dejar todo en MXN (rápido, bajo riesgo).
2. **Menú**: “Venta rápida”, quitar “Escanear reserva” (rápido).
3. **Reservas**: añadir botón “Escanear” (rápido).
4. **Dashboard**: igualar tarjetas (Stock Bajo) y añadir accesos directos (medio).
5. **Inventario vs Movimientos**: redefinir Inventario (quitar historial, añadir enlace a Movimientos) (medio).
6. **Bot**: mejoras por fases según prioridad (continuo).

---

## 8. Referencias de archivos clave

| Tema | Archivos |
|------|----------|
| Moneda / toggle | `layout.tsx`, `currency-provider.tsx`, `currency-toggle.tsx`, `price-display.tsx`, `admin/header.tsx`, `catalogo/page.tsx`, `perfil/perfil-client.tsx` |
| Dashboard | `admin/page.tsx` |
| Sidebar | `components/admin/sidebar.tsx` |
| Reservas | `admin/reservas/page.tsx`, `admin/verificar/page.tsx` |
| Inventario | `admin/inventario/page.tsx` |
| Movimientos | `admin/movimientos/page.tsx` |
| Bot | `src/bot/index.ts`, `src/bot/commands/`, `src/bot/lib/` |
