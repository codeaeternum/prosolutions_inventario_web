import Link from "next/link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { sectionNavLinks } from "./section-data"
import { ReficioMark } from "@/components/brand/reficio-mark"

export function LandingHeader({ isLoggedIn, canAccessAdmin }: { isLoggedIn: boolean; canAccessAdmin: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-lg"><ReficioMark aria-hidden className="h-6 w-6 text-primary" />Reficio</Link>
        <nav aria-label="Secciones" className="hidden items-center gap-4 text-sm md:flex">{sectionNavLinks.map(link => <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">{link.label}</Link>)}</nav>
        <div className="flex items-center gap-2">
          <div className="hidden sm:block"><ThemeToggle /></div>
          {canAccessAdmin ? <Button asChild size="sm" className="hidden sm:inline-flex"><Link href="/admin">Ir al panel</Link></Button> : !isLoggedIn && <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex"><Link href="/login">Iniciar sesión</Link></Button>}
          <Button asChild size="sm"><Link href="/registro">Crear mi negocio gratis</Link></Button>
        </div>
      </div>
    </header>
  )
}
