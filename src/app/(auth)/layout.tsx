import { Suspense } from "react"
import { Wrench, CheckCircle2 } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

const highlights = [
  "Órdenes de servicio de la recepción a la entrega",
  "Inventario, caja y ventas por sucursal",
  "Tus clientes siguen su reparación en línea",
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[45%_55%]">
      {/* Panel de marca — solo desktop */}
      <aside className="hidden lg:flex relative flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(600px circle at 20% 20%, rgba(255,255,255,0.35), transparent 50%), radial-gradient(800px circle at 90% 90%, rgba(0,0,0,0.35), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Wrench className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xl font-bold leading-tight">Reficio</p>
            <p className="text-xs opacity-80 leading-tight">reficio.app</p>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="text-3xl font-bold leading-tight">
            El sistema operativo<br />de tu taller.
          </h1>
          <ul className="space-y-3">
            {highlights.map((h) => (
              <li key={h} className="flex items-start gap-3 text-sm opacity-90">
                <CheckCircle2 className="h-5 w-5 shrink-0 opacity-80" />
                {h}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs opacity-70">
          Del latín <em>reficere</em> — reparar, restaurar.
        </p>
      </aside>

      {/* Columna del formulario */}
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-8">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <main id="main-content" role="main" className="w-full flex justify-center">
          <Suspense fallback={
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          }>
            {children}
          </Suspense>
        </main>
      </div>
    </div>
  )
}
