import Link from "next/link"
import type { ReactNode } from "react"
import { ThemeToggle } from "@/components/theme-toggle"

interface PublicShellProps {
  /** Nombre que se muestra en la barra superior (negocio o taller). */
  brandName: string
  /** Portada del namespace, normalmente `/${slug}`. */
  homeHref: string
  /** Contenido extra a la derecha del header (links de sección, etc.). */
  headerRight?: ReactNode
  children: ReactNode
}

/**
 * Marco visual de las páginas públicas por slug: header con la marca del
 * negocio/taller y footer discreto "Powered by Reficio". Mismo lenguaje que
 * la landing principal (gradiente sutil, tokens del tema, sticky header).
 */
export function PublicShell({ brandName, homeHref, headerRight, children }: PublicShellProps) {
  const initial = brandName.trim().charAt(0).toUpperCase() || "R"

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 safe-area-sticky z-50">
        <div className="container mx-auto max-w-4xl flex h-14 items-center justify-between gap-3 px-4">
          <Link href={homeHref} className="flex items-center gap-2 min-w-0">
            <div
              aria-hidden
              className="h-9 w-9 shrink-0 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold"
            >
              {initial}
            </div>
            <span className="font-bold text-lg tracking-tight truncate">{brandName}</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {headerRight}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" role="main">
        {children}
      </main>

      <footer className="border-t py-6">
        <div className="container mx-auto max-w-4xl px-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="h-5 w-5 rounded bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground"
          >
            R
          </span>
          <span>
            Powered by{" "}
            <Link href="/" className="font-semibold text-foreground hover:text-primary transition-colors">
              Reficio
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
