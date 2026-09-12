"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BusinessName } from "@/components/admin/business-name"
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  BarChart3,
  Settings,
  X,
  Menu,
  Bell,
  Boxes,
  ShoppingCart,
  CreditCard,
  Wallet,
  Wrench,
  Building2,
  MoreHorizontal,
  Package,
  FolderTree,
  Tag,
  Warehouse,
  BookOpen,
  Store,
} from "lucide-react"

const navigationGroups = [
  {
    name: "Inicio",
    items: [
      { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
    ]
  },
  {
    name: "Taller",
    items: [
      { name: "Órdenes de servicio", href: "/admin/taller", icon: Wrench },
      { name: "Catálogo de servicios", href: "/admin/taller/catalogo", icon: BookOpen },
    ]
  },
  {
    name: "Ventas y Caja",
    items: [
      { name: "Punto de Venta", href: "/admin/ventas", icon: ShoppingCart },
      { name: "Caja", href: "/admin/caja", icon: Wallet },
      { name: "Reservas", href: "/admin/reservas", icon: CalendarCheck },
      { name: "Clientes", href: "/admin/clientes", icon: Users },
      { name: "Crédito y Cartera", href: "/admin/credito", icon: CreditCard },
    ]
  },
  {
    name: "Catálogo e inventario",
    items: [
      { name: "Mercado", href: "/admin/mercado", icon: Store },
      { name: "Productos", href: "/admin/productos", icon: Package },
      { name: "Inventario", href: "/admin/inventario", icon: Warehouse },
      { name: "Clasificación", href: "/admin/catalogo", icon: FolderTree },
      { name: "Etiquetas", href: "/admin/etiquetas", icon: Tag },
    ]
  },
  {
    name: "Administración",
    items: [
      { name: "Sucursales", href: "/admin/sucursales", icon: Building2 },
      { name: "Usuarios", href: "/admin/usuarios", icon: Users },
      { name: "Reportes", href: "/admin/reportes", icon: BarChart3 },
      { name: "Notificaciones", href: "/admin/notificaciones", icon: Bell },
      { name: "Configuración", href: "/admin/configuracion", icon: Settings },
    ]
  }
]

// Bottom bar items for mobile quick access
const bottomBarItems = [
  { name: "Inicio", href: "/admin", icon: LayoutDashboard },
  { name: "Ventas", href: "/admin/ventas", icon: ShoppingCart },
  { name: "Inventario", href: "/admin/inventario", icon: Boxes },
  { name: "Caja", href: "/admin/caja", icon: Wallet },
]

const ALL_NAV_HREFS = [
  ...navigationGroups.flatMap(g => g.items.map(i => i.href)),
  ...bottomBarItems.map(i => i.href),
]

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
  }
  collapsed?: boolean
}

export function AdminSidebar({ user, collapsed = false }: AdminSidebarProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredNavigation = navigationGroups
    .map(group => {
      // WORKSHOP (taller aliado): solo ve la entrada "Mercado"
      if (user.role === "WORKSHOP") {
        return { ...group, items: group.items.filter(item => item.href === "/admin/mercado") }
      }
      return group
    })
    .filter(group => {
      // Grupos vacíos no muestran header
      if (group.items.length === 0) return false
      // Hide "Administración" if user is EMPLOYEE (los empleados sí usan el taller)
      if (user.role === "EMPLOYEE") {
        return group.name !== "Administración"
      }
      return true
    })

  // Bottom bar móvil: el taller aliado solo necesita el Mercado
  const visibleBottomBarItems = user.role === "WORKSHOP"
    ? [{ name: "Mercado", href: "/admin/mercado", icon: Store }]
    : bottomBarItems

  return (
    <>
      {/* Mobile menu button - visible in header area */}
      <Button
        variant="outline"
        size="icon"
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
              <BusinessName fallback="ProSolutions" className="text-[10px] text-muted-foreground leading-tight" />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
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
                <BusinessName fallback="ProSolutions" className="text-[10px] text-muted-foreground leading-tight" />
              </div>
            )}
          </div>
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

