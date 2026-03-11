# Mejoras y pulido del panel administrativo

Ideas concretas para llevar el panel admin a un nivel más profesional y consistente. Cada punto incluye **qué hacer** y **dónde**.

---

## 1. Navegación y contexto

### 1.1 Breadcrumbs
- **Qué**: Mostrar ruta actual (ej. Dashboard > Productos > Pantalla iPhone 15) en páginas de detalle y listas.
- **Dónde**: Componente reutilizable `Breadcrumbs` usado en `layout` admin o en cada página que lo necesite.
- **Archivos**: Crear `src/components/admin/breadcrumbs.tsx`; usarlo en `productos/[id]`, `productos/nuevo`, `productos/escanear`, `verificar`, `usuarios`, etc.
- **Beneficio**: El usuario siempre sabe en qué sección está y puede volver con un clic.

### 1.2 Título de página en el layout
- **Qué**: Que el `<main>` reciba o lea el título de la página actual (ej. desde `metadata` o un wrapper) para mostrarlo en el header o justo encima del contenido, de forma consistente.
- **Dónde**: Opción A: cada página exporta un título; Opción B: el header lee `pathname` y muestra un mapa path → título (ej. `/admin/productos` → "Productos").
- **Beneficio**: Consistencia visual y mejor orientación.

### 1.3 Enlace "Volver" consistente
- **Qué**: En páginas que hoy tienen solo un botón con flecha (ej. Escanear producto, Verificar), usar el mismo patrón: "← Volver a Productos" o "← Reservas" con `Link` y estilo único.
- **Dónde**: `productos/escanear/page.tsx`, `verificar/page.tsx`, `productos/nuevo/page.tsx`, `productos/[id]/page.tsx`.
- **Componente opcional**: `<BackLink href="..." label="Productos" />` para no repetir estilos.

---

## 2. Headers y acciones por página

### 2.1 Estructura estándar de cabecera
- **Qué**: En cada sección admin, un bloque superior con:
  - Título (h1)
  - Descripción corta (opcional)
  - Acciones principales alineadas a la derecha (móvil: debajo o en fila)
- **Dónde**: Inventario y Movimientos ya lo tienen; revisar Productos, Ventas, Reservas, Usuarios, Reportes, Configuración para que sigan el mismo patrón.
- **Ejemplo**: Reservas tiene título + "Valida pagos..."; Ventas podría tener "Venta rápida" + "Busca por nombre o escanea" + [Escanear] [Buscar].

### 2.2 Responsive en headers
- **Qué**: En móvil, que el título no se corte y que los botones pasen a fila o se agrupen (ej. menú de tres puntos) si hay muchos.
- **Dónde**: Revisar todas las páginas con `flex justify-between` en el header; usar `flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.

---

## 3. Listas y tablas

### 3.1 Empty states
- **Qué**: Cuando no hay datos, mostrar un mensaje claro + ilustración o icono + acción sugerida (ej. "No hay productos" + "Agregar producto").
- **Dónde**: Productos, Reservas, Movimientos, Usuarios, Ventas (carrito vacío). Algunas ya tienen algo; unificar estilo (mismo componente `EmptyState` con icono, texto, botón opcional).
- **Componente**: `src/components/admin/empty-state.tsx` con props `icon`, `title`, `description`, `action?: { label, href }`.

### 3.2 Estados de carga
- **Qué**: Listas y tablas deben mostrar skeleton o spinner consistente mientras cargan.
- **Dónde**: Ya existe `LoadingSpinner` y `admin/loading.tsx`; asegurar que las páginas client que hacen fetch (Productos, Movimientos, Inventario, Ventas) muestren loading al inicio y no un flash de "No hay datos".

### 3.3 Paginación y "Sin resultados"
- **Qué**: Si hay búsqueda/filtros y el resultado es 0, mensaje: "No hay resultados para X. Prueba otro término o quita filtros."
- **Dónde**: Productos (búsqueda + filtro low-stock), Movimientos (filtro tipo), Usuarios (filtro pendientes).

---

## 4. Formularios y feedback

### 4.1 Toasts y mensajes
- **Qué**: Usar `toast.success` / `toast.error` de forma consistente en todas las acciones (guardar, eliminar, agregar al carrito). Evitar `alert()`.
- **Dónde**: Revisar Configuración, Productos (crear/editar), Usuarios (aprobar/rechazar), Ventas (confirmar), Inventario (nuevo movimiento). Ya se usa sonner en varios sitios; completar donde falte.

### 4.2 Confirmación antes de acciones destructivas
- **Qué**: Eliminar producto, vaciar carrito, cancelar reserva, etc.: mostrar diálogo de confirmación (AlertDialog) con texto claro ("¿Eliminar X? Esta acción no se puede deshacer.").
- **Dónde**: Productos (eliminar), Movimientos (eliminar movimiento si aplica), Reservas (cancelar), Ventas (vaciar carrito en web si se añade esa opción).

### 4.3 Deshabilitar botones mientras se envía
- **Qué**: En submit de formularios (crear producto, guardar configuración, confirmar venta), deshabilitar el botón y opcionalmente mostrar spinner en el botón.
- **Dónde**: Ya se hace en varios; revisar Configuración, Productos/nuevo, Reservas (acciones en lista).

---

## 5. Accesibilidad y UX

### 5.1 Focus y teclado
- **Qué**: Que los flujos principales se puedan usar con teclado (Tab, Enter). Los modales deben atrapar el foco y cerrar con Escape.
- **Dónde**: Dialog de Shadcn ya suele manejarlo; verificar que al abrir Escanear, Nuevo movimiento, Crear producto, el foco vaya al primer campo o botón.

### 5.2 Etiquetas y aria
- **Qué**: Botones con solo icono deben tener `aria-label` (ej. "Cerrar", "Escanear", "Refrescar").
- **Dónde**: Sidebar (menú móvil), headers con iconos, tablas con acciones (eliminar, editar).

### 5.3 Contraste y legibilidad
- **Qué**: Revisar que textos secundarios (`text-muted-foreground`) sigan teniendo contraste suficiente en modo claro y oscuro.
- **Dónde**: Ya se hizo trabajo en selects; revisar badges, placeholders y mensajes de empty state.

---

## 6. Consistencia visual

### 6.1 Espaciado y contenedores
- **Qué**: Mismo `space-y-6` o `gap-6` entre secciones; mismo `max-w` o sin max-width en listas para que el contenido respire igual en todas las páginas.
- **Dónde**: `admin/layout.tsx` ya tiene `p-4 lg:p-8`; las páginas internas no deberían añadir padding contradictorio.

### 6.2 Cards
- **Qué**: Usar siempre Card de Shadcn para bloques de contenido (listas, formularios, resúmenes). Evitar divs con solo `border rounded-lg` que no sean Card.
- **Dónde**: Revisar Reservas (lista ya usa componentes), Reportes, Configuración.

### 6.3 Botones primarios vs outline
- **Qué**: Una sola acción principal por bloque (primaria); el resto outline o ghost. En accesos rápidos del dashboard ya está "Venta rápida" como primaria y el resto outline; mantener ese criterio en el resto del panel.

---

## 7. Funcionalidades opcionales (valor añadido)

### 7.1 Búsqueda global en header
- **Qué**: La SearchBar del header podría buscar productos, reservas o usuarios según contexto o un selector (pestañas "Productos" / "Reservas" / "Todo").
- **Dónde**: `components/admin/header.tsx` y `components/search-bar.tsx`; API de búsqueda global si no existe.

### 7.2 Atajos de teclado (avanzado)
- **Qué**: Por ejemplo: "N" para nuevo producto cuando se está en Productos, "Esc" para cerrar modales. Requiere `useEffect` con `keydown` y prevención de conflictos con inputs.
- **Dónde**: Layout admin o un hook `useAdminShortcuts()`.

### 7.3 Filtros guardados o recientes
- **Qué**: En Productos (low-stock, público) o Movimientos (tipo), recordar último filtro en `sessionStorage` para que al volver a la página se mantenga.
- **Dónde**: Páginas que usan `useState` para filtros; leer/inicializar desde `sessionStorage`.

---

## 8. Resumen de prioridades

| Prioridad | Mejora | Esfuerzo |
|-----------|--------|----------|
| Alta | Empty states consistentes | Bajo |
| Alta | Breadcrumbs en detalle y subpáginas | Medio |
| Alta | Confirmación en acciones destructivas | Bajo |
| Media | BackLink / "Volver" consistente | Bajo |
| Media | Headers con misma estructura (título + descripción + acciones) | Medio |
| Media | Loading states en listas client | Bajo |
| Baja | Búsqueda global en header | Medio |
| Baja | Atajos de teclado | Medio |

Implementar en este orden da buen impacto con poco riesgo. Las de "Bajo" esfuerzo se pueden hacer en una misma pasada (empty states + confirmaciones + BackLink).
