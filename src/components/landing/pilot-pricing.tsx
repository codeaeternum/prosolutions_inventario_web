import { LandingSection } from "./section"
import { SignupCta } from "./signup-cta"

export function PilotPricing() {
  return <LandingSection id="precio" eyebrow="Estamos en piloto" title="Empieza a poner orden, sin pagar durante el piloto"><div className="max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8"><p className="text-5xl font-bold">$0 <span className="text-base font-normal text-muted-foreground">durante el piloto</span></p><p className="mt-4 mb-6 text-muted-foreground">Sin tarjeta. Prueba el trabajo de tu mostrador con órdenes, inventario, caja y vitrina en el mismo lugar.</p><SignupCta /><p className="mt-5 text-sm text-muted-foreground">Cuando existan planes comerciales se publicarán aquí antes de cualquier cambio.</p></div></LandingSection>
}
