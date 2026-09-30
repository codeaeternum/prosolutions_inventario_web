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
  taller: "Servicio: órdenes y precios de reparación",
  ventas: "Vender (punto de venta)",
  caja: "Caja",
  reservas: "Pedidos del cliente (dentro de Clientes)",
  clientes: "Clientes",
  credito: "Cobranza y fiado (dentro de Clientes)",
  mercado: "Mercado con aliados",
  inventario: "Inventario: productos, stock, entradas y encargos",
  sucursales: "Sucursales (dentro de Configuración)",
  usuarios: "Usuarios y permisos (dentro de Equipo)",
  reportes: "Reportes y gráficas",
  notificaciones: "Notificaciones",
  configuracion: "Configuración",
}

// Prefijo de página /admin/* → módulo. Orden importa: el primer match gana.
// Las páginas absorbidas (credito→clientes?tab=cobranza, usuarios→equipo,
// sucursales→configuracion, etc.) mapean al módulo CANÓNICO destino; los
// permisos guardados con la clave vieja siguen entrando vía MODULE_ALIASES.
const MODULE_BY_PATH: readonly (readonly [string, ModuleKey])[] = [
  ["/admin/taller", "taller"],
  ["/admin/convenio", "mercado"],
  ["/admin/ventas", "ventas"],
  ["/admin/verificar", "ventas"],
  ["/admin/caja", "caja"],
  ["/admin/reservas", "clientes"],
  ["/admin/clientes", "clientes"],
  ["/admin/credito", "clientes"],
  ["/admin/mercado", "mercado"],
  // Todo lo de productos/stock vive en el módulo "inventario" (una sola
  // pantalla). Las rutas legacy /admin/productos* redirigen ahí pero su
  // mapeo queda por si alguna URL vieja llega directo al middleware.
  ["/admin/productos", "inventario"],
  ["/admin/marcas", "inventario"],
  ["/admin/modelos", "inventario"],
  ["/admin/categorias", "inventario"],
  ["/admin/etiquetas", "inventario"],
  ["/admin/catalogo", "inventario"],
  ["/admin/inventario", "inventario"],
  ["/admin/movimientos", "inventario"],
  ["/admin/encargos", "inventario"],
  ["/admin/sucursales", "configuracion"],
  ["/admin/usuarios", "usuarios"],
  ["/admin/reportes", "reportes"],
  ["/admin/configuracion", "configuracion"],
]

export function moduleForAdminPath(pathname: string): ModuleKey | null {
  for (const [prefix, module] of MODULE_BY_PATH) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return module
  }
  return null // /admin (dashboard) y páginas no mapeadas: sin restricción
}

// Claves de módulo viejas que siguen autorizando la página canónica nueva.
// Solo se expanden en gates de PÁGINA (middleware 2.4 y sidebar); las API
// conservan su requireModule estricto.
const MODULE_ALIASES: Partial<Record<ModuleKey, readonly string[]>> = {
  clientes: ["credito", "reservas"],
  configuracion: ["sucursales"],
  inventario: ["productos"],
}

/** Gate de página: la lista del usuario autoriza el módulo canónico o alguno
 * de sus alias legacy (empleados que tenían "credito" llegan a Cobranza). */
export function adminPathAllowed(allowedModules: readonly string[], required: ModuleKey): boolean {
  if (allowedModules.includes(required)) return true
  return (MODULE_ALIASES[required] ?? []).some(alias => allowedModules.includes(alias))
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
  // Alias legacy: usuarios guardados con claves viejas (p. ej. "productos")
  // conservan acceso al módulo canónico que las absorbió.
  return (MODULE_ALIASES[module] ?? []).some(alias => list.includes(alias))
}

/** Sin restricción cuando la lista está vacía; ADMIN tampoco se limita por sucursal. */
export function hasBranchAccess(user: AccessSubject, branchId: string | null | undefined): boolean {
  if (!branchId) return true
  if (user.role === "ADMIN") return true
  const list = user.allowedBranchIds
  if (!list || list.length === 0) return true
  return list.includes(branchId)
}
