"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { adminPathAllowed, moduleForAdminPath } from "@/lib/access"
import { Button } from "@/components/ui/button"
import { BusinessName } from "@/components/admin/business-name"
import { openCommandPalette } from "@/components/admin/command-palette"
import {
  LayoutDashboard,
  Users,
  BarChart3,
  Settings,
  X,
  Menu,
  Boxes,
  Search,
  ShoppingCart,
  Wallet,
  Wrench,
  MoreHorizontal,
  Store,
  Shield,
  Handshake,
  UsersRound,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { BusinessKind } from "@prisma/client"

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  // Solo visible para ADMIN: páginas que no son módulo asignable
  // (p. ej. el registro de actividad); el filtro por módulos no las cubre.
  adminOnly?: boolean
}

interface NavGroup {
  name: string
  items: NavItem[]
}

const navigationGroups: NavGroup[] = [
  {
    name: "Inicio",
    items: [
      { name: "Inicio", href: "/admin", icon: LayoutDashboard },
    ]
  },
  {
    name: "Día a día",
    items: [
      { name: "Vender", href: "/admin/ventas", icon: ShoppingCart },
      { name: "Taller", href: "/admin/taller", icon: Wrench },
      { name: "Inventario", href: "/admin/inventario", icon: Boxes },
      { name: "Caja", href: "/admin/caja", icon: Wallet },
    ]
  },
  {
    name: "Comunidad y Red",
    items: [
      { name: "Clientes", href: "/admin/clientes", icon: Users },
      { name: "Mercado", href: "/admin/mercado", icon: Store },
    ]
  },
  {
    name: "Negocio",
    items: [
      { name: "Equipo", href: "/admin/equipo", icon: UsersRound, adminOnly: true },
      { name: "Reportes", href: "/admin/reportes", icon: BarChart3 },
      { name: "Configuración", href: "/admin/configuracion", icon: Settings },
    ]
  }
]

// Bottom bar items for mobile quick access (4 pilares operativos)
const bottomBarItems: NavItem[] = [
  { name: "Inicio", href: "/admin", icon: LayoutDashboard },
  { name: "Vender", href: "/admin/ventas", icon: ShoppingCart },
  { name: "Taller", href: "/admin/taller", icon: Wrench },
  { name: "Inventario", href: "/admin/inventario", icon: Boxes },
]

// Bottom bar para negocios exclusivamente de refacciones (PARTS, sin Taller)
const partsBottomBarItems: NavItem[] = [
  { name: "Inicio", href: "/admin", icon: LayoutDashboard },
  { name: "Vender", href: "/admin/ventas", icon: ShoppingCart },
  { name: "Inventario", href: "/admin/inventario", icon: Boxes },
  { name: "Caja", href: "/admin/caja", icon: Wallet },
]

const ALL_NAV_HREFS = [
  ...navigationGroups.flatMap(g => g.items.map(i => i.href)),
  ...bottomBarItems.map(i => i.href),
  "/platform",
  "/aliado",
]

// Portal del taller aliado (captador): su pantalla principal es /aliado y
// desde el sidebar también puede entrar al Mercado para comprar refacciones.
const workshopGroups: NavGroup[] = [
  {
    name: "Aliado",
    items: [
      { name: "Portal aliado", href: "/aliado", icon: Handshake },
      { name: "Mercado", href: "/admin/mercado", icon: Store },
    ]
  }
]

// Consola de plataforma: solo la ve el superadmin (operador Reficio).
const platformGroup: NavGroup = {
  name: "Plataforma",
  items: [
    { name: "Consola", href: "/platform", icon: Shield },
  ]
}

// Negocio captador con taller asociado configurado: portal para captar equipos
// y dar seguimiento a las órdenes delegadas. Solo aparece cuando el tenant
// tiene repair_partner_business_id en su configuración.
const partnerGroup: NavGroup = {
  name: "Aliados",
  items: [
    { name: "Portal aliado", href: "/aliado", icon: Handshake },
  ]
}

// Un ítem está activo solo si su href es el prefijo MÁS LARGO del menú que
// coincide con la ruta — así /admin/taller/catalogo marca "Catálogo de
// servicios" y no también "Órdenes de servicio".
function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true
  if (href === "/admin") return false
  if (!pathname.startsWith(`${href}/`)) return false
  return !ALL_NAV_HREFS.some(other =>
    other !== href && other.length > href.length &&
    (pathname === other || pathname.startsWith(`${other}/`))
  )
}

interface AdminSidebarProps {
  user: {
    role: "ADMIN" | "EMPLOYEE" | "CUSTOMER" | "WORKSHOP"
    isSuperAdmin?: boolean
    allowedModules?: string[]
  }
  // El negocio tiene taller asociado configurado (repair_partner_business_id).
  hasPartner?: boolean
  businessKind?: BusinessKind | null
  collapsed?: boolean
}

export function AdminSidebar({ user, hasPartner = false, businessKind, collapsed = false }: AdminSidebarProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredNavigation = (user.role === "WORKSHOP" ? workshopGroups : navigationGroups)
    .map(group => ({
      ...group,
      // Restricción por módulo asignado (User.allowedModules; vacío = libre,
      // ADMIN nunca se restringe). Los href sin módulo mapeado siempre pasan,
      // salvo los marcados adminOnly (no son módulo asignable).
      items: group.items.filter(item => {
        if (item.adminOnly && user.role !== "ADMIN") return false
        // Si el negocio es exclusivamente de venta de refacciones (PARTS),
        // ocultamos "Servicio" (Taller) salvo que el usuario ya esté en esa ruta.
        if (businessKind === "PARTS" && item.href === "/admin/taller" && !pathname.startsWith("/admin/taller")) {
          return false
        }
        if (user.role === "ADMIN" || !user.allowedModules?.length) return true
        const required = moduleForAdminPath(item.href)
        return !required || adminPathAllowed(user.allowedModules!, required)
      }),
    }))
    .filter(group => {
      // Grupos vacíos no muestran header
      if (group.items.length === 0) return false
      // EMPLOYEE sin módulos asignados no ve "Negocio" (regla previa);
      // con módulos explícitos el filtro por ítem ya decidió qué entra.
      if (user.role === "EMPLOYEE" && !user.allowedModules?.length) {
        return group.name !== "Negocio"
      }
      return true
    })

  // Captadores con taller asociado (staff normal, no rol WORKSHOP — ese ya
  // tiene su menú propio): el portal aliado aparece tras "Día a día".
  if (hasPartner && user.role !== "WORKSHOP") {
    const diaIndex = filteredNavigation.findIndex(g => g.name === "Día a día")
    filteredNavigation.splice(diaIndex >= 0 ? diaIndex + 1 : filteredNavigation.length, 0, partnerGroup)
  }

  if (user.isSuperAdmin) {
    filteredNavigation.push(platformGroup)
  }

  // Bottom bar móvil: el taller aliado necesita su portal y el Mercado;
  // en negocios PARTS (sin Taller) se muestran Inicio, Vender, Inventario y Caja;
  // en el resto (REPAIR, FULL o sin especificar) los 4 pilares operativos:
  // Inicio, Vender, Taller e Inventario.
  const visibleBottomBarItems = user.role === "WORKSHOP"
    ? [{ name: "Portal", href: "/aliado", icon: Handshake }, { name: "Mercado", href: "/admin/mercado", icon: Store }]
    : businessKind === "PARTS"
      ? partsBottomBarItems
      : bottomBarItems

  return (
    <>
      {/* Mobile menu button - visible in header area */}
      <Button
        variant="outline"
        size="icon"
        aria-label="Abrir menú de navegación"
        className="fixed top-4 left-4 z-[100] lg:hidden bg-background shadow-md"
        onClick={() => setMobileMenuOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-[100] w-72 bg-card border-r transform transition-transform duration-300 ease-in-out lg:hidden",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between px-6 border-b">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wrench className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-tight">Reficio</span>
              <BusinessName fallback="Mi taller" className="text-[10px] text-muted-foreground leading-tight" />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar menú de navegación"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        {/* Búsqueda global: abre la paleta de comandos */}
        <div className="p-4 pb-0">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false)
              openCommandPalette()
            }}
            className="flex w-full h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Buscar…</span>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 pb-24">
          <ul role="list" className="space-y-6">
            {filteredNavigation.map((group) => (
              <li key={group.name}>
                <div className="text-xs font-semibold leading-6 text-muted-foreground uppercase tracking-wider mb-2 px-2">
                  {group.name}
                </div>
                <ul role="list" className="-mx-2 space-y-1">
                  {group.items.map((item) => {
                    const isActive = isNavItemActive(pathname, item.href)
                    return (
                      <li key={item.name}>
                        <Link
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={cn(
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            "group flex gap-x-3 rounded-lg px-3 py-2 text-sm leading-6 font-medium transition-all duration-150"
                          )}
                        >
                          <item.icon
                            className={cn(
                              isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                              "h-5 w-5 shrink-0"
                            )}
                            aria-hidden="true"
                          />
                          {item.name}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-[90] lg:hidden bg-background border-t safe-area-bottom">
        <nav className="flex items-center justify-around h-16 px-2">
          {visibleBottomBarItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-lg transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span className="text-[10px] font-medium">{item.name}</span>
              </Link>
            )
          })}
          <button
            type="button"
            aria-label="Abrir más módulos"
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-[10px] font-medium">Más</span>
          </button>
        </nav>
      </div>

      {/* Desktop sidebar */}
      <div
        className={cn(
          "hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:flex-col transition-all duration-300",
          collapsed ? "lg:w-20" : "lg:w-64"
        )}
      >
        <div className={cn("flex grow flex-col gap-y-5 overflow-y-auto border-r bg-card", collapsed ? "px-3" : "px-6")}>
          <div className={cn("flex h-16 shrink-0 items-center gap-2 border-b", collapsed && "justify-center")}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wrench className="h-5 w-5" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-lg leading-tight">Reficio</span>
                <BusinessName fallback="Mi taller" className="text-[10px] text-muted-foreground leading-tight" />
              </div>
            )}
          </div>
          {/* Búsqueda global (⌘K): mismo campo que el header */}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Abrir buscador y navegación (⌘K)"
            title={collapsed ? "Buscar (⌘K)" : undefined}
            className={cn(
              "mt-4 flex h-9 items-center gap-2 rounded-md border border-input bg-background text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground",
              collapsed ? "justify-center px-0" : "px-3"
            )}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left">Buscar…</span>
                <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">⌘K</kbd>
              </>
            )}
            {collapsed && <span className="sr-only">Buscar</span>}
          </button>
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7 pt-4">
              {filteredNavigation.map((group, groupIndex) => (
                <li key={group.name}>
                  {collapsed ? (
                    groupIndex > 0 && <div className="border-t border-border mb-3 -mx-1" aria-hidden="true" />
                  ) : (
                    <div className="text-xs font-semibold leading-6 text-muted-foreground uppercase tracking-wider mb-2">
                      {group.name}
                    </div>
                  )}
                  <ul role="list" className={cn("space-y-1", collapsed ? "" : "-mx-2")}>
                    {group.items.map((item) => {
                      const isActive = isNavItemActive(pathname, item.href)
                      return (
                        <li key={item.name}>
                          <Link
                            href={item.href}
                            title={collapsed ? item.name : undefined}
                            className={cn(
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                              "group flex gap-x-3 rounded-lg px-3 py-2 text-sm leading-6 font-medium transition-all duration-150",
                              collapsed && "justify-center px-0"
                            )}
                          >
                            <item.icon
                              className={cn(
                                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                                "h-5 w-5 shrink-0"
                              )}
                              aria-hidden="true"
                            />
                            {!collapsed && item.name}
                            {collapsed && <span className="sr-only">{item.name}</span>}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </>
  )
}

