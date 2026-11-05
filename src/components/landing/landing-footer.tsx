import Link from "next/link"
import { ArrowRight, ShieldCheck, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Reveal } from "@/components/landing/reveal"
import { navLinks } from "@/components/landing/landing-data"

export function LandingFooter(props?: { signupEnabled?: boolean }) {
  void props
  return (
    <>
      {/* ===================== CTA final ===================== */}
      <section className="border-t">
        <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary via-indigo-500 to-violet-600 px-6 py-14 sm:px-12 text-center text-primary-foreground">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4), transparent 45%), radial-gradient(circle at 85% 80%, rgba(0,0,0,0.35), transparent 50%)",
                }}
              />
              <div className="relative max-w-2xl mx-auto space-y-6">
                <ShieldCheck className="h-11 w-11 mx-auto opacity-90" />
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  Tu taller ya tiene sistema operativo
                </h2>
                <p className="text-base sm:text-lg opacity-90">
                  Registra tu negocio, recibe tu primera orden con patrón y folio,
                  y mira tu vitrina en línea hoy mismo.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                  <Button
                    size="lg"
                    variant="secondary"
                    className="h-12 px-8 text-base gap-2 shadow-lg"
                    asChild
                  >
                    <Link href="/registro">
                      Crea tu negocio gratis
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 px-8 text-base gap-2 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    asChild
                  >
                    <Link href="/mercado">Explorar el mercado</Link>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===================== Footer ===================== */}
      <footer className="border-t">
        <div className="container mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
                <Wrench className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold tracking-tight">Reficio</span>
              <span className="text-sm text-muted-foreground">· reficio.app</span>
            </Link>

            <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-label="Pie de página">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-foreground transition-colors">
                  {link.label}
                </Link>
              ))}
              <Link href="/seguimiento" className="hover:text-foreground transition-colors">
                Rastrea tu reparación
              </Link>
              <Link href="/login" className="hover:text-foreground transition-colors">
                Iniciar sesión
              </Link>
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t text-center sm:text-left text-xs text-muted-foreground">
            <p>
              © {new Date().getFullYear()} Reficio — del latín <em>reficere</em>,
              reparar. Software para talleres de reparación.
            </p>
          </div>
        </div>
      </footer>
    </>
  )
}
