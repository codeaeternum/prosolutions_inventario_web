import { ClipboardList, Package, Wallet, Users, Check } from "lucide-react"
import { extras, featurePillars } from "./section-data"
import { LandingSection } from "./section"

const icons = [ClipboardList, Package, Wallet, Users]
export function FeaturePillars() {
  return <LandingSection id="producto" eyebrow="Todo conectado" title="Cuatro cosas que tu negocio necesita tener en orden" muted>
    <div className="grid gap-4 md:grid-cols-2">{featurePillars.map((pillar, index) => { const Icon = icons[index]; return <article key={pillar.title} className="rounded-2xl border bg-card p-6"><Icon aria-hidden className="mb-4 h-7 w-7 text-primary" /><h3 className="text-xl font-semibold">{pillar.title}</h3><p className="mt-2 text-muted-foreground">{pillar.lead}</p><ul className="mt-5 space-y-3 text-sm">{pillar.items.map(item => <li key={item} className="flex gap-2"><Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{item}</li>)}</ul></article> })}</div>
    <aside className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5"><h3 className="font-semibold">Y además:</h3><ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">{extras.map(extra => <li key={extra} className="max-w-xl">{extra}</li>)}</ul></aside>
  </LandingSection>
}
