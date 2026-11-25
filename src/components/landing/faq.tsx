import { faqs } from "./section-data"
import { LandingSection } from "./section"

export function Faq() {
  return <LandingSection id="faq" title="Lo que te puedes estar preguntando" muted><div className="max-w-3xl divide-y rounded-2xl border bg-card px-5 sm:px-6">{faqs.map(faq => <details key={faq.question} className="group py-5"><summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{faq.question}</summary><p className="mt-4 leading-relaxed text-muted-foreground">{faq.answer}</p></details>)}</div></LandingSection>
}
