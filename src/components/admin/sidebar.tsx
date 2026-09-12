"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard,
  Package,
  Tag,
  Layers,
  Tags,
  Users,
  CalendarCheck,
  BarChart3,
  Settings,
  X,
  Menu,
  Bell,
  Boxes,
  ShoppingCart,
  QrCode,
  ArrowLeftRight,
  CreditCard,
  Wallet,
  Wrench,
  Building2,
  MoreHorizontal,
} from "lucide-react"

const navigationGroups = [
  { name: "Taller · Piloto", items: [{ name: "Órdenes de servicio", href: "/admin/taller", icon: Wrench }] },
  {
    name: "General",
    items: [
      { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
    ]
  },
  {
    name: "Operaciones",
    items: [
      { name: "Punto de Venta", href: "/admin/ventas", icon: ShoppingCart },
      { name: "Caja", href: "/admin/caja", icon: Wallet },
      { name: "Reservas", href: "/admin/reservas", icon: CalendarCheck },
      { name: "Movimientos", href: "/admin/movimientos", icon: ArrowLeftRight },
    ]
  },
  {
    name: "Inventario",
    items: [
      { name: "Inventario Web", href: "/admin/inventario", icon: Boxes },
    ]
  },
  {
    name: "Administración",
    items: [
      { name: "Sucursales", href: "/admin/sucursales", icon: Building2 },
      { name: "Usuarios", href: "/admin/usuarios", icon: Users },
      { name: "Crédito y Cartera", href: "/admin/credito", icon: CreditCard },
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
    // Hide "Administración" and "Usuarios" if user is EMPLOYEE
    if (user.role === "EMPLOYEE") {
      return group.name !== "Administración" && group.name !== "Taller · Piloto"
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
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <span className="font-bold text-lg">Pro-Solutions</span>
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
                            "group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold transition-colors"
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
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <span className="font-bold text-lg">Pro-Solutions</span>
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
                              "group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold transition-colors"
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

