"use client"

import Link from "next/link"
import Image from "next/image"
import { signOut } from "next-auth/react"
import {
  Store,
  ShoppingCart,
  CalendarCheck,
  User,
  LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { useCart } from "@/components/cart-context"
import { cn } from "@/lib/utils"

export interface StoreHeaderProps {
  active?: "catalogo" | "reservas" | "perfil" | "carrito"
}

export function StoreHeader({ active }: StoreHeaderProps) {
  const { totalItems } = useCart()

  return (
    <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo.jpg"
            alt="Reficio"
            width={36}
            height={36}
            className="rounded-lg"
          />
          <span className="font-bold text-lg tracking-tight hidden sm:inline">
            Reficio
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            asChild
            className={cn(
              active === "catalogo" && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            )}
          >
            <Link
              href="/catalogo"
              aria-label="Catálogo"
              aria-current={active === "catalogo" ? "page" : undefined}
            >
              <Store className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className={cn(
              "relative",
              active === "carrito" && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            )}
          >
            <Link
              href="/carrito"
              aria-label="Carrito"
              aria-current={active === "carrito" ? "page" : undefined}
            >
              <ShoppingCart className="h-4 w-4" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                  {totalItems > 99 ? "99+" : totalItems}
                </span>
              )}
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className={cn(
              active === "reservas" && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            )}
          >
            <Link
              href="/mis-reservas"
              aria-label="Mis reservas"
              aria-current={active === "reservas" ? "page" : undefined}
            >
              <CalendarCheck className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className={cn(
              active === "perfil" && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            )}
          >
            <Link
              href="/perfil"
              aria-label="Mi perfil"
              aria-current={active === "perfil" ? "page" : undefined}
            >
              <User className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar sesión"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
