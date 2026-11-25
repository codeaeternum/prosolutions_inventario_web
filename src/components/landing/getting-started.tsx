import { gettingStarted } from "./section-data"
import { LandingSection } from "./section"

export function GettingStarted() {
  return <LandingSection id="empieza" title="Cómo empiezas" muted><ol className="grid gap-6 md:grid-cols-3">{gettingStarted.map((step, index) => <li key={step.title}><span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-bold text-primary">{index + 1}</span><h3 className="text-lg font-semibold">{step.title}</h3><p className="mt-2 leading-relaxed text-muted-foreground">{step.description}</p></li>)}</ol></LandingSection>
}
