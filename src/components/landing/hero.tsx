import Link from "next/link"
import { Send, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SignupCta } from "./signup-cta"

export function Hero({ storefrontHref }: { storefrontHref: string }) {
  return (
    <section aria-labelledby="hero-title" className="relative border-b bg-linear-to-b from-primary/5 to-background">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-8 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:py-24">
        <div>
          <p className="mb-4 text-sm font-semibold text-primary">Software para talleres y tiendas de refacciones en México</p>
          <h1 id="hero-title" className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">Controla reparaciones, refacciones y caja de tu taller</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">Recibe equipos con patrón y evidencia, cotiza por enlace, revisa existencias por sucursal y cobra con folio. Con vitrina propia en <span className="font-medium text-foreground">reficio.app/tu-negocio</span>.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><SignupCta /><Button asChild size="lg" variant="outline" className="min-h-12"><Link href={storefrontHref}>Ver una vitrina real</Link></Button></div>
          <p className="mt-3 text-xs text-muted-foreground sm:text-sm">Gratis durante el piloto · Sin tarjeta · En español</p>
        </div>
        <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:p-6" aria-label="Ejemplo ilustrativo del tablero de órdenes">
          <div className="mb-5 flex items-center justify-between gap-2 border-b pb-4"><span className="flex items-center gap-2 font-semibold"><Wrench aria-hidden className="h-4 w-4 text-primary" />Órdenes del taller</span><span className="text-xs text-muted-foreground">Ejemplo ilustrativo</span></div>
          <div className="grid grid-cols-3 gap-2 text-xs sm:gap-3">
            {[
              { state: "Recibido", folio: "OT-0142", equipment: "Samsung A54", detail: "Patrón y fotos guardados", color: "bg-blue-500" },
              { state: "Reparación", folio: "OT-0140", equipment: "iPhone 13", detail: "Cambio de pantalla", color: "bg-amber-500" },
              { state: "Listo", folio: "OT-0138", equipment: "Moto G84", detail: "Aviso enviado al cliente", color: "bg-emerald-500" },
            ].map(order => <div key={order.state} className="min-w-0 rounded-xl bg-muted/50 p-2"><p className="mb-3 flex flex-wrap items-center gap-1 font-semibold"><span aria-hidden className={`h-2 w-2 rounded-full ${order.color}`} />{order.state}</p><div className="space-y-2 rounded-lg border bg-background p-2"><p className="font-mono text-primary">{order.folio}</p><p className="font-semibold">{order.equipment}</p><p className="leading-relaxed text-muted-foreground">{order.detail}</p></div></div>)}
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border bg-primary/5 p-4"><Send aria-hidden className="mt-1 h-5 w-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Telegram · Resumen de las 8 p. m.</p><p className="mt-1 text-sm text-muted-foreground">Tu día en resumen: vendiste $4,250, entregaste 3 equipos.</p><p className="mt-2 text-xs text-muted-foreground">Datos de ejemplo, no resultados de un negocio.</p></div></div>
        </div>
      </div>
    </section>
  )
}
