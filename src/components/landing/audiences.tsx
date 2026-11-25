import { audiences } from "./section-data"
import { LandingSection } from "./section"

const descriptions = ["Recibe, diagnostica y repara. Del patrón al cobro, cada equipo con su folio.", "Recibe equipos y envíalos a tu taller asociado sin perder el seguimiento del cliente.", "Vende en mostrador, aparta piezas y surte a talleres aliados. No necesitas recibir reparaciones."]
export function Audiences() {
  return <LandingSection id="para-quien" title="Para quien vive del mostrador y las reparaciones"><div className="grid gap-4 md:grid-cols-3">{audiences.map((audience, index) => { const Icon = audience.icon; return <article key={audience.title} className="rounded-2xl border p-5"><Icon aria-hidden className="mb-3 h-6 w-6 text-primary" /><h3 className="text-lg font-semibold">{audience.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{descriptions[index]}</p></article> })}</div></LandingSection>
}
