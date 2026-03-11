"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, ShoppingCart, CalendarCheck, User, LayoutDashboard, Store, Package } from "lucide-react"
import { cn } from "@/lib/utils"

interface MobileNavProps {
  isAdmin?: boolean
}

import { useCart } from "@/components/cart-context"

export function MobileNav({ isAdmin = false }: MobileNavProps) {
  const pathname = usePathname()
  const { totalItems } = useCart()

  const customerLinks = [
    { href: "/", icon: Home, label: "Inicio" },
    { href: "/catalogo", icon: Store, label: "Catálogo" },
    { href: "/carrito", icon: ShoppingCart, label: "Carrito" },
    { href: "/mis-reservas", icon: CalendarCheck, label: "Reservas" },
    { href: "/perfil", icon: User, label: "Perfil" },
  ]

  const adminLinks = [
    { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/admin/productos", icon: ShoppingCart, label: "Productos" },
    { href: "/admin/reservas", icon: CalendarCheck, label: "Reservas" },
    { href: "/perfil", icon: User, label: "Perfil" },
  ]

  const links = isAdmin ? adminLinks : customerLinks

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50 safe-area-bottom" aria-label="Navegación principal">
      <div className="flex items-center justify-around h-16">
        {links.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || (href !== "/" && pathname.startsWith(href))
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
