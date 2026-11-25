import { SignupCta } from "./signup-cta"

export function FinalCta() {
  return <section aria-labelledby="final-cta-title" className="border-b"><div className="mx-auto max-w-6xl px-4 py-14 sm:py-20"><div className="rounded-3xl border bg-primary/5 px-5 py-12 text-center"><h2 id="final-cta-title" className="text-3xl font-bold tracking-tight sm:text-4xl">Deja de perder patrones, piezas y cobros</h2><p className="mt-4 mb-7 text-muted-foreground">Pon a trabajar tus órdenes, inventario y caja en el mismo lugar.</p><SignupCta /><p className="mt-3 text-sm text-muted-foreground">Gratis durante el piloto · Sin tarjeta · En español</p></div></div></section>
}
