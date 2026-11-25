import { lifecycle } from "./section-data"
import { LandingSection } from "./section"

export function OrderLifecycle() {
  return <LandingSection id="flujo" eyebrow="De ingreso a entrega" title="Cada equipo tiene su camino, no se queda en el olvido">
    <p className="mb-8 max-w-2xl text-muted-foreground">Así se ve el recorrido principal. El tablero incluye 13 estados para dar seguimiento también a las excepciones del día a día.</p>
    <ol className="grid gap-0 md:grid-cols-7">{lifecycle.map((step, index) => <li key={step.title} className="relative flex gap-4 border-l-2 border-primary/20 pb-7 pl-5 last:pb-0 md:block md:border-t-2 md:border-l-0 md:px-2 md:pt-6 md:pb-0"><span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground md:-top-3 md:left-2">{index + 1}</span><div><h3 className="font-semibold md:text-sm">{step.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p></div></li>)}</ol>
  </LandingSection>
}
