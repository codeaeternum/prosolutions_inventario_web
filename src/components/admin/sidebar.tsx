"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
  ArrowLeftRight,
  CreditCard,
  Wallet,
  Wrench,
  Building2,
  MoreHorizontal,
  Package,
  FolderTree,
  Tag,
  Warehouse,
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
    name: "Catálogo",
    items: [
      { name: "Productos", href: "/admin/productos", icon: Package },
      { name: "Clasificación", href: "/admin/catalogo", icon: FolderTree },
      { name: "Etiquetas", href: "/admin/etiquetas", icon: Tag },
    ]
  },
  {
    name: "Inventario",
    items: [
      { name: "Stock por sucursal", href: "/admin/inventario", icon: Warehouse },
      { name: "Movimientos", href: "/admin/movimientos", icon: ArrowLeftRight },
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

interface AdminSidebarProps {
  user: {
    role: "ADMIN" | "EMPLOYEE" | "CUSTOMER"
  }
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const filteredNavigation = navigationGroups.filter(group => {
    // Hide "Administración" and "Taller" if user is EMPLOYEE
    if (user.role === "EMPLOYEE") {
      return group.name !== "Administración" && group.name !== "Taller"
    }
    return true
  })

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
            <span className="font-bold text-lg">Reficio</span>
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
                    const isActive = pathname === item.href ||
                      (item.href !== "/admin" && pathname.startsWith(item.href))
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
          {bottomBarItems.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href))
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
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r bg-card px-6">
          <div className="flex h-16 shrink-0 items-center gap-2 border-b">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wrench className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-tight">Reficio</span>
              <span className="text-[10px] text-muted-foreground leading-tight">ProSolutions</span>
            </div>
          </div>
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7 pt-4">
              {filteredNavigation.map((group) => (
                <li key={group.name}>
                  <div className="text-xs font-semibold leading-6 text-muted-foreground uppercase tracking-wider mb-2">
                    {group.name}
                  </div>
                  <ul role="list" className="-mx-2 space-y-1">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href ||
                        (item.href !== "/admin" && pathname.startsWith(item.href))
                      return (
                        <li key={item.name}>
                          <Link
                            href={item.href}
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
      </div>
    </>
  )
}

