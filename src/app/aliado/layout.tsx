"use client"

// Portal del negocio aliado (modelo "Telcel trae → el taller repara"): layout
// propio y mínimo — el aliado NO es staff del taller reparador, así que no usa
// AdminShell. El acceso lo garantiza el middleware (/aliado exige login
// APPROVED y rol distinto de CUSTOMER); aquí solo va la identidad visual.
import Link from "next/link"
import { signOut, useSession } from "next-auth/react"
import { LogOut, ShoppingCart, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function AliadoLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/aliado" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wrench className="h-4 w-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-tight">Reficio</span>
              <span className="block text-xs text-muted-foreground">Portal de aliado</span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {/* El Mercado B2B aplica para WORKSHOP/EMPLOYEE/ADMIN; el link se
                muestra siempre (si el rol no puede entrar, /admin redirige). */}
            <Button variant="outline" size="sm" asChild>
              {/* En teléfono queda solo-icono: aria-label lo nombra. */}
              <Link href="/admin/mercado" aria-label="Comprar refacciones en el mercado">
                <ShoppingCart className="h-4 w-4 sm:mr-2" aria-hidden />
                <span className="hidden sm:inline">Comprar refacciones</span>
              </Link>
            </Button>
            <span className="hidden max-w-40 truncate text-sm text-muted-foreground md:block">
              {session?.user?.name}
            </span>
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} aria-label="Cerrar sesión">
              <LogOut className="h-4 w-4 sm:mr-2" aria-hidden />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" role="main" className="mx-auto w-full max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  )
}
