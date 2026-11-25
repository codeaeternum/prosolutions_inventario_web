import { Check } from "lucide-react"
import { comparison } from "./section-data"
import { LandingSection } from "./section"

export function ProblemComparison() {
  return <LandingSection id="comparativa" eyebrow="Del papel al control" title="Tu taller no debería depender de un cuaderno">
    <div className="mb-3 hidden grid-cols-2 gap-6 px-6 text-sm font-semibold md:grid"><p>Papel, Excel y mensajes de WhatsApp</p><p className="text-primary">Con Reficio</p></div>
    <ul className="space-y-3">{comparison.map(row => <li key={row.before} className="grid gap-4 rounded-2xl border p-5 md:grid-cols-2 md:gap-6"><div><p className="mb-1 text-xs font-semibold text-muted-foreground md:hidden">Papel, Excel y WhatsApp</p><p className="text-muted-foreground">{row.before}</p></div><div><p className="mb-1 text-xs font-semibold text-primary md:hidden">Con Reficio</p><p className="flex gap-2"><Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-primary" />{row.after}</p></div></li>)}</ul>
  </LandingSection>
}
