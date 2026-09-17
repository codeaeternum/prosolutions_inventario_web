"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CalendarCheck,
  LayoutDashboard,
  Package,
  PackageSearch,
  ShoppingCart,
  Store,
  User,
  Wallet,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface MobileNavProps {
  isAdmin?: boolean
}

import { useCart } from "@/components/cart-context"

/**
 * Rutas donde el menú inferior aplica: tienda del cliente y panel admin.
 * Cualquier otra ruta (landing /, /registro, /login, /<slug> de tenants,
 * /cotizacion/*, etc.) no muestra el menú.
 */
const NAV_PREFIXES = [
  "/catalogo",
  "/carrito",
  "/mis-reservas",
  "/perfil",
  "/seguimiento",
  "/admin",
]

const customerLinks = [
  { href: "/catalogo", icon: Store, label: "Catálogo" },
  { href: "/carrito", icon: ShoppingCart, label: "Carrito" },
  { href: "/mis-reservas", icon: CalendarCheck, label: "Reservas" },
  { href: "/seguimiento", icon: PackageSearch, label: "Rastreo" },
  { href: "/perfil", icon: User, label: "Perfil" },
]

const adminLinks = [
  { href: "/admin", icon: LayoutDashboard, label: "Panel" },
  { href: "/admin/taller", icon: Wrench, label: "Taller" },
  { href: "/admin/inventario", icon: Package, label: "Inventario" },
  { href: "/admin/caja", icon: Wallet, label: "Caja" },
  { href: "/perfil", icon: User, label: "Perfil" },
]

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function MobileNav({ isAdmin = false }: MobileNavProps) {
  const pathname = usePathname()
  const { totalItems } = useCart()

  // Solo tienda del cliente y admin; en landing, registro, login y vitrinas
  // públicas de tenants no se muestra.
  const showNav = NAV_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))
  if (!showNav) return null

  // En /admin/* se muestran los accesos de staff; en el resto, los de cliente.
  const isAdminSection = matchesPrefix(pathname, "/admin")
  const links = isAdminSection && isAdmin ? adminLinks : customerLinks

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50 safe-area-bottom" aria-label="Navegación principal">
      <div className="flex items-center justify-around h-16">
        {links.map(({ href, icon: Icon, label }) => {
          const isActive = matchesPrefix(pathname, href)
          const isCart = label === "Carrito"
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={isCart && totalItems > 0 ? `Carrito (${totalItems} producto${totalItems !== 1 ? "s" : ""})` : label}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-[10px] font-medium">{label}</span>
              {isCart && totalItems > 0 && (
                <span className="absolute top-1 right-2 h-4 w-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center" aria-hidden>
                  {totalItems}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
