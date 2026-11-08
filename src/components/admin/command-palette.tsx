"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"
import { DialogOverlay } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { hasModule } from "@/lib/access"
import type { ModuleKey } from "@/lib/access"
import type { BusinessKind, UserRole } from "@prisma/client"
import {
  BarChart3,
  Boxes,
  Handshake,
  LayoutDashboard,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  ReceiptText,
  ScanBarcode,
  ScanLine,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Store,
  Tags,
  User,
  Users,
  UsersRound,
  Wallet,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

/**
 * Paleta de comandos global del área admin (⌘K / Ctrl+K):
 * - Acciones rápidas (nueva venta, recibir equipo, nuevo producto…)
 * - Navegación a cada pantalla y pestaña interna de los hubs
 * - Resultados de búsqueda de entidades (órdenes, ventas, clientes,
 *   productos) — las mismas fuentes que usaba el SearchBar del header.
 *
 * Se monta una sola vez en AdminShell. Cualquier botón la abre despachando
 * el evento OPEN_COMMAND_PALETTE_EVENT (helper `openCommandPalette()`), el
 * mismo patrón del evento de colapso del sidebar.
 */
export const OPEN_COMMAND_PALETTE_EVENT = "reficio:open-command-palette"

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
}

interface CommandItem {
  id: string
  label: string
  // Contexto de la entrada, p. ej. "Inventario · Entradas".
  hint?: string
  // Términos extra para el filtro (sinónimos, siglas).
  keywords?: string
  href: string
  icon: LucideIcon
  group: string
  // Módulo que autoriza la entrada (mismo gate del sidebar/middleware).
  module?: ModuleKey
  // Solo ADMIN (p. ej. el hub de Equipo, que el sidebar también oculta).
  adminOnly?: boolean
  // Secuencia de teclas estilo GitHub ("g d" = g y luego d) que dispara la
  // misma acción sin abrir la paleta.
  shortcut?: string
}

interface EntityResult {
  type: "product" | "model" | "order" | "customer" | "sale"
  id: string
  name: string
  subtitle: string
  folio?: string
}

// Quítale los acentos y baja a minúsculas para que "crédito" == "credito".
function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // rango U+0300–U+036F: diacríticas combinadas
    .toLowerCase()
}

// Ventana para completar la secuencia "g" + letra (estilo GitHub).
export const GO_SEQUENCE_MS = 800

// Segunda tecla de un "g …" → comando cuyo shortcut coincide. La lista ya
// viene filtrada por módulo/rol (visibleCommands), así que el gate del
// sidebar se hereda solo: sin módulo taller no hay "g t".
export function findGoCommand<T extends { shortcut?: string }>(
  commands: readonly T[],
  secondKey: string
): T | null {
  const want = `g ${secondKey.toLowerCase()}`
  return commands.find(c => c.shortcut === want) ?? null
}

// Búsqueda pre-cargada de la paleta cuando "n" no tiene una acción obvia en
// la página: "nuev" matchea "nueva" y "nuevo" a la vez → aparecen Nueva
// venta, Recibir equipo (Nueva orden de servicio) y Nuevo producto.
export const NEW_SHORTCUT_QUERY = "nuev"

/**
 * Acción de la tecla "n" («nueva…») según la ruta actual:
 * - "command": ejecuta un comando de la paleta → hereda el gate de
 *   módulo/rol (si el comando no es visible, cae al fallback de paleta).
 * - "href": navega a una ruta calculada; solo si `gatedBy` (id de comando)
 *   es visible — p. ej. la ficha de cliente enlaza "Nueva venta" pero solo
 *   cuando el usuario puede vender.
 * - "focus": enfoca un control de la página (el buscador del mostrador).
 * - "palette": sin acción obvia → abrir la paleta buscando «nuev…».
 * Nunca devuelve algo destructivo: a lo sumo navega o abre un alta vacía.
 */
export type NewShortcutAction =
  | { kind: "command"; commandId: string }
  | { kind: "href"; href: string; gatedBy: string }
  | { kind: "focus"; selector: string }
  | { kind: "palette"; query: string }

export function resolveNewShortcut(pathname: string): NewShortcutAction {
  // Ficha 360 del cliente (/admin/clientes/<id>): replica su botón «Nueva
  // venta», que precarga al cliente en el mostrador.
  const clienteId = /^\/admin\/clientes\/([^/?#]+)\/?$/.exec(pathname)?.[1]
  if (clienteId) {
    return { kind: "href", href: `/admin/ventas?cliente=${encodeURIComponent(clienteId)}`, gatedBy: "acc-vender" }
  }
  // Nueva orden de servicio — incluye /taller/recibir (reabrir el intake).
  if (pathname === "/admin/taller" || pathname.startsWith("/admin/taller/")) {
    return { kind: "command", commandId: "acc-recibir" }
  }
  // «Nueva venta» en el mostrador = empezar a capturar: foco al buscador
  // (mismo destino que el atajo "/" de esa pantalla, no destructivo).
  if (pathname === "/admin/ventas") {
    return { kind: "focus", selector: "#pos-product-search" }
  }
  if (pathname === "/admin/inventario") {
    return { kind: "command", commandId: "acc-nuevo-producto" }
  }
  // /admin/clientes no tiene alta propia (los registros se aprueban en
  // Usuarios) ni el resto de hubs una acción «nueva» unívoca → la paleta
  // pre-cargada con "nuev" enseña las altas disponibles para el rol.
  return { kind: "palette", query: NEW_SHORTCUT_QUERY }
}

// ¿El evento de teclado nació en un campo editable? Entonces la letra le
// pertenece al usuario y los atajos globales no deben interceptarla.
// (`closest` cubre inputs dentro de regiones contenteditable y viceversa.)
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true'], [contenteditable='']") !== null
  )
}

// Un diálogo abierto (la propia paleta, un modal de Radix…) apaga los
// atajos globales: las teclas le pertenecen a esa vista. Radix desmonta el
// portal al cerrar, así que basta con que exista uno no "closed".
function anyDialogOpen(): boolean {
  if (typeof document === "undefined") return false
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
  ).some(el => el.dataset.state !== "closed")
}

// "g d" → [g][d] como teclas, igual que la ayuda de GitHub.
function ShortcutKeys({ shortcut }: { shortcut: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {shortcut.split(" ").map(key => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

const COMMANDS: CommandItem[] = [
  // ── Acciones rápidas ────────────────────────────────────────────────
  { id: "acc-vender", label: "Nueva venta", hint: "Abrir el mostrador (POS)", keywords: "vender cobrar ticket pos caja registradora", href: "/admin/ventas", icon: ShoppingCart, group: "Acciones rápidas", module: "ventas" },
  { id: "acc-escanear", label: "Escanear QR de apartado", hint: "Verificar pedido del cliente", keywords: "verificar qr escanear apartado", href: "/admin/ventas?escanear=1", icon: ScanLine, group: "Acciones rápidas", module: "ventas" },
  { id: "acc-recibir", label: "Recibir equipo", hint: "Nueva orden de servicio", keywords: "intake orden reparacion ingreso equipo", href: "/admin/taller/recibir", icon: Wrench, group: "Acciones rápidas", module: "taller" },
  { id: "acc-nuevo-producto", label: "Nuevo producto", hint: "Alta en el catálogo", keywords: "alta crear producto inventario", href: "/admin/inventario?tab=stock&nuevo=1", icon: PackagePlus, group: "Acciones rápidas", module: "inventario" },
  { id: "acc-entrada", label: "Entrada rápida", hint: "Sumar stock escaneando", keywords: "escanear codigo barras stock entrada mercancia", href: "/admin/inventario?tab=stock&entrada=1", icon: ScanBarcode, group: "Acciones rápidas", module: "inventario" },
  { id: "acc-etiquetas", label: "Imprimir etiquetas", hint: "Códigos de barras", keywords: "etiquetas barcode imprimir precios", href: "/admin/inventario?tab=stock&herramienta=etiquetas", icon: Tags, group: "Acciones rápidas", module: "inventario" },

  // ── Día a día ───────────────────────────────────────────────────────
  { id: "nav-ventas", label: "Vender", hint: "Mostrador, cobrar y apartados", keywords: "pos ventas punto de venta", href: "/admin/ventas", icon: ShoppingCart, group: "Día a día", module: "ventas", shortcut: "g v" },
  { id: "nav-taller", label: "Órdenes de servicio", hint: "Taller · Tablero", keywords: "reparaciones ordenes trabajo ot", href: "/admin/taller", icon: Wrench, group: "Día a día", module: "taller", shortcut: "g t" },
  { id: "nav-taller-precios", label: "Precios de reparación", hint: "Taller · Catálogo de servicios", keywords: "catalogo servicios precios mano de obra", href: "/admin/taller?tab=precios", icon: Wrench, group: "Día a día", module: "taller" },
  { id: "nav-stock", label: "Stock", hint: "Inventario · Productos", keywords: "productos existencias catalogo almacen", href: "/admin/inventario", icon: Boxes, group: "Día a día", module: "inventario", shortcut: "g i" },
  { id: "nav-entradas", label: "Entradas y compras", hint: "Inventario · Mercancía recibida", keywords: "compras lote recepcion proveedores", href: "/admin/inventario?tab=entradas", icon: Boxes, group: "Día a día", module: "inventario" },
  { id: "nav-proveedores", label: "Proveedores", hint: "Inventario · Entradas", keywords: "proveedor compras credito", href: "/admin/inventario?tab=entradas&sub=proveedores", icon: Boxes, group: "Día a día", module: "inventario" },
  { id: "nav-encargos", label: "Encargos", hint: "Inventario · Pedidos especiales", keywords: "encargo pedido especial sobre pedido", href: "/admin/inventario?tab=encargos", icon: Boxes, group: "Día a día", module: "inventario" },
  { id: "nav-historial", label: "Historial de movimientos", hint: "Inventario · Entradas y salidas", keywords: "movimientos kardex ajustes merma", href: "/admin/inventario?tab=historial", icon: Boxes, group: "Día a día", module: "inventario" },
  { id: "nav-caja", label: "Caja · Turno actual", hint: "Corte, entradas y salidas", keywords: "corte dinero efectivo turno", href: "/admin/caja", icon: Wallet, group: "Día a día", module: "caja", shortcut: "g c" },
  { id: "nav-caja-mov", label: "Movimientos de caja", hint: "Caja · Historial", keywords: "gastos retiros depositos", href: "/admin/caja?tab=movimientos", icon: Wallet, group: "Día a día", module: "caja" },
  { id: "nav-caja-semana", label: "Semana de caja", hint: "Caja · Resumen", keywords: "semana resumen cortes", href: "/admin/caja?tab=semana", icon: Wallet, group: "Día a día", module: "caja" },
  { id: "nav-caja-sol", label: "Solicitudes de caja", hint: "Caja · Autorizaciones", keywords: "retiros autorizaciones solicitudes dinero", href: "/admin/caja?tab=solicitudes", icon: Wallet, group: "Día a día", module: "caja" },
  { id: "nav-caja-prov", label: "Pagos a proveedores", hint: "Caja · Proveedores", keywords: "pagar proveedor saldo", href: "/admin/caja?tab=proveedores", icon: Wallet, group: "Día a día", module: "caja" },

  // ── Clientes y mercado ──────────────────────────────────────────────
  { id: "nav-clientes", label: "Clientes", hint: "Directorio y estado de cuenta", keywords: "directorio contactos", href: "/admin/clientes", icon: Users, group: "Clientes y mercado", module: "clientes", shortcut: "g u" },
  { id: "nav-cobranza", label: "Cobranza y fiado", hint: "Clientes · Crédito", keywords: "credito deuda abonos fiado saldo", href: "/admin/clientes?tab=cobranza", icon: Users, group: "Clientes y mercado", module: "clientes" },
  { id: "nav-pedidos", label: "Pedidos y reservas", hint: "Clientes · Apartados", keywords: "apartados reservas pedidos cliente", href: "/admin/clientes?tab=pedidos", icon: Users, group: "Clientes y mercado", module: "clientes" },
  { id: "nav-mercado", label: "Mi publicación", hint: "Mercado · Vitrina aliada", keywords: "mercado publicar vitrina", href: "/admin/mercado", icon: Store, group: "Clientes y mercado", module: "mercado", shortcut: "g m" },
  { id: "nav-mercado-cat", label: "Catálogo del mercado", hint: "Mercado · Comprar a aliados", keywords: "aliados refacciones comprar", href: "/admin/mercado?tab=catalogo", icon: Store, group: "Clientes y mercado", module: "mercado" },
  { id: "nav-mercado-sol", label: "Solicitudes del mercado", hint: "Mercado · Pedidos entre negocios", keywords: "solicitudes pedidos aliados", href: "/admin/mercado?tab=solicitudes", icon: Store, group: "Clientes y mercado", module: "mercado" },
  { id: "nav-mercado-compras", label: "Compras del mercado", hint: "Mercado · Lo que pedí", keywords: "compras aliados refacciones", href: "/admin/mercado?tab=compras", icon: Store, group: "Clientes y mercado", module: "mercado" },
  { id: "nav-mercado-cuentas", label: "Cuentas de convenio", hint: "Mercado · Convenio B2B", keywords: "convenio cuentas b2b aliados", href: "/admin/mercado?tab=cuentas", icon: Store, group: "Clientes y mercado", module: "mercado" },

  // ── Negocio ─────────────────────────────────────────────────────────
  { id: "nav-reportes", label: "Reportes", hint: "Ventas, cortes y comparativos", keywords: "graficas estadisticas analitica", href: "/admin/reportes", icon: BarChart3, group: "Negocio", module: "reportes", shortcut: "g r" },
  { id: "nav-equipo", label: "Equipo", hint: "Actividad, usuarios y turnos", keywords: "empleados equipo hub staff", href: "/admin/equipo?tab=usuarios", icon: UsersRound, group: "Negocio", adminOnly: true, shortcut: "g e" },
  { id: "nav-usuarios", label: "Usuarios y permisos", hint: "Equipo · Cuentas", keywords: "empleados roles permisos modulos nomina cuentas staff usuarios", href: "/admin/equipo?tab=usuarios", icon: UsersRound, group: "Negocio", module: "usuarios", adminOnly: true },
  { id: "nav-actividad", label: "Registro de actividad", hint: "Equipo · Bitácora", keywords: "actividad log auditoria historial", href: "/admin/equipo?tab=actividad", icon: UsersRound, group: "Negocio", adminOnly: true },
  { id: "nav-turnos", label: "Turnos del equipo", hint: "Equipo · Asistencia", keywords: "turnos equipo asistencia horarios sesiones checador", href: "/admin/equipo?tab=turnos", icon: UsersRound, group: "Negocio", adminOnly: true },
  { id: "nav-desempeno", label: "Desempeño", hint: "Equipo · Productividad", keywords: "metricas productividad empleados", href: "/admin/equipo?tab=desempeno", icon: UsersRound, group: "Negocio", adminOnly: true },
  { id: "nav-config", label: "Configuración", hint: "Datos del negocio y taller", keywords: "ajustes negocio perfil", href: "/admin/configuracion", icon: Settings, group: "Negocio", module: "configuracion", shortcut: "g s" },
  { id: "nav-sucursales", label: "Sucursales", hint: "Configuración · Sedes", keywords: "sucursal sede tienda", href: "/admin/configuracion?tab=sucursales", icon: Settings, group: "Negocio", module: "configuracion" },
]

const HOME_COMMAND: CommandItem = { id: "nav-home", label: "Inicio", hint: "Panel principal", keywords: "dashboard resumen", href: "/admin", icon: LayoutDashboard, group: "Inicio", shortcut: "g d" }
const PARTNER_COMMAND: CommandItem = { id: "nav-aliado", label: "Portal aliado", hint: "Captar y dar seguimiento", keywords: "aliado taller captador", href: "/aliado", icon: Handshake, group: "Clientes y mercado", shortcut: "g a" }
const PLATFORM_COMMAND: CommandItem = { id: "nav-platform", label: "Consola de plataforma", hint: "Operador Reficio", keywords: "superadmin plataforma tenants", href: "/platform", icon: Shield, group: "Negocio", shortcut: "g p" }

interface CommandPaletteProps {
  user: {
    role: UserRole
    isSuperAdmin?: boolean
    allowedModules?: string[]
  }
  hasPartner?: boolean
  businessKind?: BusinessKind | null
}

export function AdminCommandPalette({ user, hasPartner = false, businessKind }: CommandPaletteProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<EntityResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  // true cuando la paleta se abrió con "?" → muestra el bloque de atajos.
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Secuencia "g …" armada (esperando la segunda tecla).
  const [goPending, setGoPending] = useState(false)
  const goPendingRef = useRef(false)
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Mismo filtro por módulos que el sidebar (hasModule cubre ADMIN,
  // lista vacía con restringidos de EMPLOYEE y alias legacy). Los atajos
  // "g"+letra resuelven sobre esta lista → heredan el gate.
  const visibleCommands = useMemo(() => {
    if (user.role === "WORKSHOP") {
      const items = [PARTNER_COMMAND]
      items.push({ ...COMMANDS.find(c => c.id === "nav-mercado-cat")!, label: "Mercado", hint: "Comprar refacciones a aliados", shortcut: "g m" })
      return items
    }
    // El portal aliado se inserta al final del grupo "Clientes y mercado"
    // (antes del primer ítem de "Negocio") para no crear un grupo duplicado;
    // la consola de plataforma cierra la lista dentro de "Negocio".
    const reportesIndex = COMMANDS.findIndex(c => c.id === "nav-reportes")
    const negocioStart = reportesIndex === -1 ? COMMANDS.length : reportesIndex
    const items = [
      HOME_COMMAND,
      ...COMMANDS.slice(0, negocioStart),
      ...(hasPartner ? [PARTNER_COMMAND] : []),
      ...COMMANDS.slice(negocioStart),
      ...(user.isSuperAdmin ? [PLATFORM_COMMAND] : []),
    ]
    return items.filter(item => {
      if (item.adminOnly && user.role !== "ADMIN") return false
      if (businessKind === "PARTS" && item.module === "taller") return false
      if (!item.module) return true
      return hasModule({ role: user.role, allowedModules: user.allowedModules }, item.module)
    })
  }, [user.role, user.isSuperAdmin, user.allowedModules, hasPartner, businessKind])

  // Estado limpio al cerrar: la siguiente apertura siempre arranca vacía.
  // (Se resetea en el handler de cierre, no en un efecto de `open`.)
  const resetPalette = useCallback(() => {
    setQuery("")
    setResults([])
    setLoading(false)
    setActiveIndex(0)
    setShowShortcuts(false)
  }, [])

  const goTo = useCallback((href: string) => {
    setOpen(false)
    resetPalette()
    router.push(href)
  }, [router, resetPalette])

  // Fallback de la tecla "n": la paleta pre-cargada con «nuev» enseña las
  // acciones de alta que el rol sí tiene (Nueva venta, Recibir, Producto).
  const openNewSearch = useCallback((query = NEW_SHORTCUT_QUERY) => {
    setShowShortcuts(false)
    setQuery(query)
    setActiveIndex(0)
    setOpen(true)
  }, [])

  // Tecla "n" = acción «nueva» de la página actual. Navegación/foco nada
  // más — jamás confirma ni borra nada. Las acciones que apuntan a un
  // comando heredan su gate de módulo/rol; sin acceso o sin acción obvia,
  // cae a la paleta pre-cargada.
  const runNewShortcut = useCallback(() => {
    const action = resolveNewShortcut(pathname ?? "")
    if (action.kind === "focus") {
      const el = document.querySelector<HTMLElement>(action.selector)
      if (el) {
        el.focus()
        return
      }
    } else if (action.kind === "command") {
      const cmd = visibleCommands.find(c => c.id === action.commandId)
      if (cmd) {
        goTo(cmd.href)
        return
      }
    } else if (action.kind === "href") {
      if (visibleCommands.some(c => c.id === action.gatedBy)) {
        goTo(action.href)
        return
      }
    } else {
      openNewSearch(action.query)
      return
    }
    openNewSearch()
  }, [pathname, visibleCommands, goTo, openNewSearch])

  // Atajos globales:
  // - ⌘K / Ctrl+K abre o cierra la paleta (único atajo con modificador).
  // - "?" abre la paleta en modo ayuda (bloque de atajos visible).
  // - "g" + letra (< GO_SEQUENCE_MS) navega como en GitHub, reutilizando
  //   la misma lista de comandos ya filtrada por módulo/rol.
  // - "n" dispara la acción «nueva» de la página (nueva orden, capturar
  //   producto, alta de producto…) o la paleta buscando «nuev».
  // Todo lo demás se ignora con modificadores, dentro de campos editables
  // o mientras haya un diálogo abierto (incluida la propia paleta).
  useEffect(() => {
    const disarmGo = () => {
      goPendingRef.current = false
      setGoPending(false)
      if (goTimerRef.current !== null) {
        clearTimeout(goTimerRef.current)
        goTimerRef.current = null
      }
    }
    const armGo = () => {
      if (goTimerRef.current !== null) clearTimeout(goTimerRef.current)
      goPendingRef.current = true
      setGoPending(true)
      goTimerRef.current = setTimeout(disarmGo, GO_SEQUENCE_MS)
    }
    const openFromEvent = () => {
      setShowShortcuts(false)
      setOpen(true)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setShowShortcuts(false)
        setOpen(prev => !prev)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      if (isEditableShortcutTarget(e.target) || anyDialogOpen()) return

      if (goPendingRef.current) {
        disarmGo()
        const item = findGoCommand(visibleCommands, e.key)
        if (item) {
          e.preventDefault()
          goTo(item.href)
        }
        return
      }
      if (e.key === "g") {
        armGo()
        return
      }
      if (e.key === "n") {
        e.preventDefault()
        runNewShortcut()
        return
      }
      if (e.key === "?") {
        // En el POS "?" abre la ayuda propia del punto de venta (más específica
        // que la global); ambos escuchan keydown y preventDefault no detiene al
        // otro handler, así que aquí se cede esa página.
        if (pathname === "/admin/ventas") return
        e.preventDefault()
        setShowShortcuts(true)
        setOpen(true)
      }
    }
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openFromEvent)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openFromEvent)
      document.removeEventListener("keydown", handleKeyDown)
      if (goTimerRef.current !== null) clearTimeout(goTimerRef.current)
      // Si la lista cambia a mitad de una secuencia, el indicador no queda
      // armado para siempre.
      goPendingRef.current = false
      setGoPending(false)
    }
  }, [visibleCommands, goTo, runNewShortcut, pathname])

  // Precalienta las primeras rutas visibles al abrir: la navegación desde
  // la paleta (o con "g"+letra) se siente instantánea. Se deduplica por
  // pathname porque varios comandos apuntan al mismo hub con ?tab=…
  useEffect(() => {
    if (!open) return
    const seen = new Set<string>()
    for (const cmd of visibleCommands) {
      if (seen.size >= 10) break
      const path = cmd.href.split("?")[0]
      if (seen.has(path)) continue
      seen.add(path)
      router.prefetch(path)
    }
  }, [open, visibleCommands, router])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) resetPalette()
  }, [resetPalette])

  const q = normalize(query.trim())

  const filteredCommands = useMemo(() => {
    if (!q) return visibleCommands
    return visibleCommands.filter(item =>
      normalize(`${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${item.group}`).includes(q)
    )
  }, [visibleCommands, q])

  // Búsqueda de entidades (debounced) — mismas fuentes que el buscador
  // global del header: productos, órdenes de taller, clientes y ventas.
  // Con <2 caracteres no se dispara; resultados viejos se ocultan vía
  // `entityResults` y se limpian al cerrar la paleta.
  useEffect(() => {
    const term = query.trim()
    if (!open || term.length < 2) return
    const search = async () => {
      setLoading(true)
      try {
        const [productsRes, ordersRes, clientesRes, salesRes] = await Promise.all([
          fetch(`/api/search/pos?q=${encodeURIComponent(term)}`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/workshop?q=${encodeURIComponent(term)}&page=1`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/clientes?q=${encodeURIComponent(term)}&limit=4`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/sales?q=${encodeURIComponent(term)}&page=1`).then(r => r.json()).catch(() => ({})),
        ])
        const productResults: EntityResult[] = (productsRes.products || []).map((p: { id: string; name: string; barcode?: string | null; category?: { name: string } | null }) => ({
          type: "product" as const,
          id: p.id,
          name: p.name,
          subtitle: `${p.category?.name || ""} - ${p.barcode || "Sin código"}`,
        }))
        const orderResults: EntityResult[] = (ordersRes.orders || []).slice(0, 4).map((o: { id: string; number: number; folio?: string; customerName: string; equipmentType: string; brand?: string | null; model?: string | null }) => {
          const folio = typeof o.folio === "string" && o.folio ? o.folio : `OT-${String(o.number).padStart(6, "0")}`
          return {
            type: "order" as const,
            id: o.id,
            folio,
            name: `${folio} · ${o.customerName}`,
            subtitle: [o.equipmentType, o.brand, o.model].filter(Boolean).join(" · "),
          }
        })
        const customerResults: EntityResult[] = (clientesRes.clientes || []).slice(0, 4).map((c: { id: string; name: string; businessName?: string | null; phone?: string | null; email?: string | null }) => ({
          type: "customer" as const,
          id: c.id,
          name: c.name,
          subtitle: [c.businessName, c.phone, c.email].filter(Boolean).join(" · ") || "Cliente",
        }))
        const saleResults: EntityResult[] = (salesRes.sales || []).slice(0, 3).map((s: { id: string; number: number; total?: number | string | null; customer?: { name?: string | null } | null; items?: unknown[] }) => {
          const folio = `V-${String(s.number).padStart(6, "0")}`
          return {
            type: "sale" as const,
            id: s.id,
            folio,
            name: `${folio}${s.customer?.name ? ` · ${s.customer.name}` : ""}`,
            subtitle: `$${Number(s.total ?? 0).toFixed(2)} · ${s.items?.length ?? 0} art.`,
          }
        })
        setResults([...orderResults, ...saleResults, ...customerResults, ...productResults])
        setActiveIndex(0)
      } catch (error) {
        console.error("Command palette search error:", error)
      } finally {
        setLoading(false)
      }
    }
    const debounce = setTimeout(search, 300)
    return () => clearTimeout(debounce)
  }, [query, open])

  // Lista plana navegable: comandos filtrados + resultados de entidades
  // (los de entidades solo cuentan con término de búsqueda real).
  const entityResults = query.trim().length >= 2 ? results : []
  const totalItems = filteredCommands.length + entityResults.length

  // Mantener visible el ítem activo al navegar con flechas.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-command-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const selectEntity = useCallback((result: EntityResult) => {
    if (result.type === "order") {
      goTo(`/admin/taller?orden=${encodeURIComponent(result.id)}`)
    } else if (result.type === "sale") {
      goTo(`/admin/tickets/venta/${result.id}`)
    } else if (result.type === "customer") {
      goTo(`/admin/clientes/${result.id}`)
    } else if (result.type === "product") {
      goTo(`/admin/productos/${result.id}`)
    } else {
      goTo(`/admin/inventario`)
    }
  }, [goTo])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (totalItems > 0) setActiveIndex(prev => (prev + 1) % totalItems)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (totalItems > 0) setActiveIndex(prev => (prev - 1 + totalItems) % totalItems)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (activeIndex < filteredCommands.length) {
        const item = filteredCommands[activeIndex]
        if (item) goTo(item.href)
      } else {
        const result = entityResults[activeIndex - filteredCommands.length]
        if (result) selectEntity(result)
      }
    }
    // Escape lo maneja Radix (cierra el diálogo).
  }

  // Agrupar los comandos filtrados conservando el orden de aparición.
  const groups = useMemo(() => {
    const ordered: { name: string; items: { item: CommandItem; index: number }[] }[] = []
    filteredCommands.forEach((item, index) => {
      let group = ordered.find(g => g.name === item.group)
      if (!group) {
        group = { name: item.group, items: [] }
        ordered.push(group)
      }
      group.items.push({ item, index })
    })
    return ordered
  }, [filteredCommands])

  const entityBaseIndex = filteredCommands.length

  return (
    <>
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay className="z-[110] bg-black/60" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[10%] sm:top-[15%] z-[110] flex w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-background shadow-2xl outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95"
          onOpenAutoFocus={e => {
            // El foco debe caer en el input, no en el primer botón de la lista.
            e.preventDefault()
            inputRef.current?.focus()
          }}
        >
          <DialogPrimitive.Title className="sr-only">Buscar y navegar</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Busca páginas, acciones, órdenes, ventas, clientes y productos. Usa las flechas para moverte y Enter para abrir.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-3 border-b px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={totalItems > 0}
              aria-controls="command-palette-list"
              aria-autocomplete="list"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Busca páginas, acciones, folios, clientes o productos…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
            <kbd className="hidden sm:inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">esc</kbd>
          </div>

          <div
            ref={listRef}
            id="command-palette-list"
            role="listbox"
            className="max-h-[55vh] overflow-y-auto overscroll-contain p-2"
          >
            {totalItems === 0 && !loading && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Sin resultados para «{query}»
              </p>
            )}

            {/* Ayuda de atajos al abrir con "?": las mismas teclas que ya
                funcionan fuera de la paleta, filtradas por módulo/rol. */}
            {showShortcuts && !q && (
              <div className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Atajos de teclado
                </p>
                {visibleCommands.filter(item => item.shortcut).map(item => (
                  <button
                    key={`shortcut-${item.id}`}
                    type="button"
                    onClick={() => goTo(item.href)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                    <ShortcutKeys shortcut={item.shortcut!} />
                  </button>
                ))}
                {/* "n" no es navegación: depende de la página — por eso va
                    como fila informativa y no como comando con href. */}
                <div className="flex w-full items-center gap-3 rounded-lg px-3 py-2">
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    Acción «nueva» de la página (o busca «nuev…»)
                  </span>
                  <ShortcutKeys shortcut="n" />
                </div>
                <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs text-muted-foreground">
                  <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
                  abre/cierra esta búsqueda ·
                  <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">?</kbd>
                  esta ayuda ·
                  <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">n</kbd>
                  nuevo
                </p>
              </div>
            )}

            {groups.map(group => (
              <div key={group.name} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.name}
                </p>
                {group.items.map(({ item, index }) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    data-command-index={index}
                    onClick={() => goTo(item.href)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      index === activeIndex ? "bg-accent" : "hover:bg-accent/60"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      {item.hint && (
                        <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                      )}
                    </span>
                    {item.shortcut && <ShortcutKeys shortcut={item.shortcut} />}
                  </button>
                ))}
              </div>
            ))}

            {entityResults.length > 0 && (
              <div className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Resultados
                </p>
                {entityResults.map((result, i) => {
                  const index = entityBaseIndex + i
                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      data-command-index={index}
                      onClick={() => selectEntity(result)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        index === activeIndex ? "bg-accent" : "hover:bg-accent/60"
                      )}
                    >
                      {result.type === "order" ? (
                        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : result.type === "sale" ? (
                        <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : result.type === "customer" ? (
                        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : result.type === "product" ? (
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{result.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {result.type === "order"
                          ? "Taller"
                          : result.type === "sale"
                            ? "Venta"
                            : result.type === "customer"
                              ? "Cliente"
                              : result.type === "product"
                                ? "Producto"
                                : "Modelo"}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> moverse
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> abrir
            </span>
            <span className="hidden sm:inline">
              <kbd className="rounded border bg-muted px-1 font-mono">?</kbd> atajos
            </span>
            <span className="ml-auto hidden sm:inline">⌘K para abrir/cerrar</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>

    {/* "g" pulsada: se espera la segunda tecla de la secuencia. */}
    {goPending && (
      <div
        role="status"
        className="fixed bottom-4 right-4 z-[120] select-none rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs text-muted-foreground shadow-md"
      >
        g…
      </div>
    )}
    </>
  )
}
