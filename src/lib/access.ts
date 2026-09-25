/**
 * Control de acceso del staff por módulo y sucursal.
 *
 * User.allowedModules / User.allowedBranchIds: lista VACÍA = sin restricción.
 * Las claves de módulo se comparten entre: middleware (gate de páginas
 * /admin/*), api-auth (requireModule en rutas sensibles), el sidebar
 * (filtra el menú) y la pantalla de usuarios (checkboxes de asignación).
 */

// Claves de módulo asignables. "dashboard" no es asignable: todo el staff
// conserva /admin como pantalla de aterrizaje.
export const MODULES = [
  "taller",
  "ventas",
  "caja",
  "reservas",
  "clientes",
  "credito",
  "mercado",
  "inventario",
  "sucursales",
  "usuarios",
  "reportes",
  "notificaciones",
  "configuracion",
] as const
export type ModuleKey = (typeof MODULES)[number]

export const MODULE_LABELS: Record<ModuleKey, string> = {
  taller: "Órdenes de servicio",
  ventas: "Vender (punto de venta)",
  caja: "Caja",
  reservas: "Apartados",
  clientes: "Clientes",
  credito: "Fiado y cartera",
  mercado: "Mercado con aliados",
  inventario: "Inventario: productos, stock, entradas y encargos",
  sucursales: "Sucursales",
  usuarios: "Usuarios y permisos",
  reportes: "Reportes y gráficas",
  notificaciones: "Notificaciones",
  configuracion: "Configuración",
}

// Prefijo de página /admin/* → módulo. Orden importa: el primer match gana
// (/admin/taller/catalogo sigue siendo "taller").
const MODULE_BY_PATH: readonly (readonly [string, ModuleKey])[] = [
  ["/admin/taller", "taller"],
  ["/admin/convenio", "taller"],
  ["/admin/ventas", "ventas"],
  ["/admin/caja", "caja"],
  ["/admin/reservas", "reservas"],
  ["/admin/clientes", "clientes"],
  ["/admin/credito", "credito"],
  ["/admin/mercado", "mercado"],
  // Todo lo de productos/stock vive en el módulo "inventario" (una sola
  // pantalla). Las rutas legacy /admin/productos* redirigen ahí pero su
  // mapeo queda por si alguna URL vieja llega directo al middleware.
  ["/admin/productos", "inventario"],
  ["/admin/marcas", "inventario"],
  ["/admin/modelos", "inventario"],
  ["/admin/categorias", "inventario"],
  ["/admin/etiquetas", "inventario"],
  ["/admin/inventario", "inventario"],
  ["/admin/movimientos", "inventario"],
  ["/admin/encargos", "inventario"],
  ["/admin/sucursales", "sucursales"],
  ["/admin/usuarios", "usuarios"],
  ["/admin/reportes", "reportes"],
  ["/admin/notificaciones", "notificaciones"],
  ["/admin/configuracion", "configuracion"],
]

export function moduleForAdminPath(pathname: string): ModuleKey | null {
  for (const [prefix, module] of MODULE_BY_PATH) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module
  }
  return null // /admin (dashboard) y páginas no mapeadas: sin restricción
}

interface AccessSubject {
  role: string
  allowedModules?: string[] | null
  allowedBranchIds?: string[] | null
}

// Módulos reservados a ADMIN/encargados cuando el EMPLOYEE no tiene lista
// explícita: el mismo conjunto que el middleware bloquea en /admin/*
// (restrictedForEmployee). Sin esta réplica la API quedaba más laxa que la
// página — un empleado sin módulos podía leer /api/reports (topClients con
// correos) aunque la UI lo redirigía.
const EMPLOYEE_RESTRICTED: ReadonlySet<ModuleKey> = new Set([
  "usuarios",
  "credito",
  "reportes",
  "notificaciones",
  "configuracion",
])

/** ADMIN no se restringe por módulos: solo aplica a EMPLOYEE/WORKSHOP. */
export function hasModule(user: AccessSubject, module: ModuleKey): boolean {
  if (user.role === "ADMIN") return true
  const list = user.allowedModules
  if (!list || list.length === 0)
    return !(user.role === "EMPLOYEE" && EMPLOYEE_RESTRICTED.has(module))
  if (list.includes(module)) return true
  // Alias legacy: usuarios guardados con el módulo viejo "productos"
  // conservan acceso al módulo unificado "inventario".
  return module === "inventario" && list.includes("productos")
}

/** Sin restricción cuando la lista está vacía; ADMIN tampoco se limita por sucursal. */
export function hasBranchAccess(user: AccessSubject, branchId: string | null | undefined): boolean {
  if (!branchId) return true
  if (user.role === "ADMIN") return true
  const list = user.allowedBranchIds
  if (!list || list.length === 0) return true
  return list.includes(branchId)
}
