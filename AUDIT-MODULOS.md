# Auditoría de módulos y estructura — ProSolutions Inventario

Objetivo: revisar que cada módulo del admin corresponda a su subrubro, eliminar redundancias, pulir nombres e integrar consistencia.

---

## 1. Mapa actual del panel admin

### 1.1 Sidebar (grupos e ítems)

| Grupo           | Ítems              | Ruta                    | Estado |
|-----------------|--------------------|-------------------------|--------|
| **General**     | Dashboard          | `/admin`                | ✅ |
| **Operaciones** | Ventas             | `/admin/ventas`         | ✅ POS, carrito, escáner |
|                 | Movimientos        | `/admin/movimientos`    | ✅ Historial de movimientos |
|                 | Reservas           | `/admin/reservas`       | ✅ |
|                 | Inventario         | `/admin/inventario`     | ✅ Ajustes de stock (entradas/salidas) |
| **Catálogo**    | Productos          | `/admin/productos`      | ✅ Listado, nuevo, editar, escanear |
|                 | Etiquetas QR       | `/admin/etiquetas`      | ✅ Imprimir etiquetas por producto |
|                 | Marcas             | `/admin/marcas`         | ✅ |
|                 | Modelos            | `/admin/modelos`        | ✅ Dependen de marcas |
|                 | Categorías         | `/admin/categorias`     | ✅ |
| **Administración** | Usuarios         | `/admin/usuarios`       | ✅ |
|                 | Reportes           | `/admin/reportes`       | ✅ |
|                 | Notificaciones     | `/admin/notificaciones` | ✅ Centro de notificaciones |
|                 | Configuración      | `/admin/configuracion`  | ✅ Reservas, moneda |

### 1.2 Correspondencia módulo ↔ subrubro

- **Operaciones**: Ventas (registro de ventas), Movimientos (consulta del historial), Reservas (gestión de reservas), Inventario (ajustes de stock). Coherente. “Inventario” podría llamarse “Ajustes de stock” para distinguir de “Movimientos” (solo lectura).
- **Catálogo**: Productos, Etiquetas QR (derivado de productos), Marcas, Modelos, Categorías. Orden sugerido: Categorías → Marcas → Modelos → Productos → Etiquetas QR (de lo más general a lo más concreto).
- **Administración**: Usuarios, Reportes, Notificaciones, Configuración. Coherente. EMPLOYEE no ve este grupo (oculto en sidebar).

---

## 2. API vs páginas

| Página / función      | API usada                    | Notas |
|-----------------------|------------------------------|--------|
| Dashboard             | Datos del servidor (Prisma)  | ✅ |
| Ventas                | `/api/search/pos`, productos | ✅ |
| Movimientos           | `GET/DELETE /api/inventory`  | Filtro por tipo: ver §4 |
| Reservas              | `/api/reservations`, admin   | ✅ |
| Inventario            | `/api/inventory`, productos  | ✅ |
| Productos             | `/api/products`, categories, brands, models | ✅ |
| Etiquetas             | `/api/products`              | ✅ |
| Marcas / Modelos / Categorías | `/api/brands`, `/api/models`, `/api/categories` | ✅ |
| Usuarios              | `/api/users`                 | ✅ |
| Reportes              | `/api/reports`               | ✅ |
| Notificaciones        | `/api/notifications/*`, stream | ✅ |
| Configuración         | `/api/settings`               | ✅ |

Hay rutas en `/api/reservations/*` y `/api/admin/reservations/[id]`; ambas tienen sentido (público vs admin). Sin redundancia crítica.

---

## 3. Mejoras aplicadas / recomendadas

### 3.1 Sidebar

- **Orden en Catálogo**: Categorías, Marcas, Modelos, Productos, Etiquetas QR.
- **Icono de Marcas**: Cambiar de `Smartphone` a `Tag` o `Bookmark` para no confundir con Modelos (celulares).

### 3.2 Tipos de movimiento (schema vs UI)

- **Prisma** `MovementType`: `IN`, `OUT`, `ADJUSTMENT`, `RETURN`.
- **UI** (Movimientos e Inventario): usa además `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `DAMAGED`, `LOST`.
- **API** `/api/inventory`: POST acepta los de la UI; el create de Prisma solo admite el enum. GET devuelve movimientos con tipo del enum y reservas mapeadas a `SALE`/`CANCELLED`.
- **Acción**: En el POST, normalizar tipo antes de crear: `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` → `ADJUSTMENT`, `SALE`/`DAMAGED`/`LOST` → `OUT`. En el GET, al filtrar por tipo, mapear `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` → `ADJUSTMENT` para que el filtro funcione.

### 3.3 Limpieza

- No hay páginas huérfanas: todas las rutas del sidebar existen y tienen contenido.
- Referencias a “Mantenimientos” en documentación: unificar con “Movimientos” (nombre actual del ítem).
- `api/reservations` vs `api/admin/reservations`: mantener ambos; el primero para flujo cliente/empleado y el segundo para acciones admin concretas.

### 3.4 Consistencia de nombres

- **Inventario** = página para hacer ajustes de stock (entradas/salidas/ajustes).
- **Movimientos** = página para ver historial de movimientos (y reservas completadas/canceladas si se mezclan en la misma API).
- Títulos de página: en su mayoría “Nombre del módulo” (ej. “Movimientos”, “Reservas”). Mantener ese patrón.

### 3.5 Seguridad y permisos (ya cubierto en AUDIT.md)

- EMPLOYEE puede entrar al panel pero no ve “Administración”; las APIs que requieren admin siguen comprobando rol. Reservations: requireAuth(); Reportes: requireAdminOrEmployee(); DELETE inventario: solo ADMIN. Permisos EMPLOYEE detallados en AUDIT.md §4.1.

---

## 4. Resumen de acciones

| Acción                         | Prioridad | Estado  |
|--------------------------------|-----------|---------|
| Reordenar Catálogo en sidebar (Categorías → Marcas → Modelos → Productos → Etiquetas QR) | Media | ✅ Aplicado |
| Reordenar Operaciones (Ventas → Reservas → Inventario → Movimientos) | Media | ✅ Aplicado |
| Icono Marcas (Tag en vez de Smartphone) | Baja | ✅ Aplicado |
| Normalizar tipo de movimiento en API inventory (POST: UI→Prisma; GET: filtro por SALE/CANCELLED/ADJUSTMENT) | Alta | ✅ Aplicado |
| Filtro "Reservas canceladas" (CANCELLED) en Movimientos | Baja | ✅ Aplicado |
| Documentar permisos EMPLOYEE en AUDIT.md | Baja | ✅ Aplicado |

---

## 5. Estructura de carpetas admin (referencia)

```
admin/
  page.tsx                 → Dashboard
  layout.tsx                → Layout con sidebar + header
  ventas/page.tsx
  movimientos/page.tsx
  reservas/page.tsx
  inventario/page.tsx
  productos/page.tsx
  productos/nuevo/page.tsx
  productos/[id]/page.tsx
  productos/escanear/page.tsx
  etiquetas/page.tsx
  marcas/page.tsx
  modelos/page.tsx
  categorias/page.tsx
  usuarios/page.tsx
  reportes/page.tsx
  notificaciones/page.tsx
  configuracion/page.tsx
```

Todos los ítems del sidebar tienen su página; no hay enlaces rotos.
