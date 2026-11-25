import Link from "next/link"
import { Globe, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LandingSection } from "./section"

const benefits = ["Tu logo, servicios y refacciones con tus precios.", "Rastreo por folio y QR para el mostrador.", "Apartados de piezas y venta a talleres aliados."]
export function Storefront({ storefrontHref }: { storefrontHref: string }) {
  return <LandingSection id="vitrina" eyebrow="Tu negocio también se ve fuera del mostrador" title="Tu propia vitrina, sin dominio, alojamiento web ni diseñador" muted>
    <div className="grid items-center gap-8 md:grid-cols-2"><div><p className="text-lg text-muted-foreground">Comparte <span className="font-semibold text-foreground">reficio.app/tu-negocio</span>. Una dirección propia dentro de Reficio para que tus clientes vean lo que ofreces y sepan dónde encontrarte.</p><ul className="my-6 space-y-3">{benefits.map(benefit => <li key={benefit} className="flex gap-2"><Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-primary" />{benefit}</li>)}</ul><Button asChild variant="outline"><Link href={storefrontHref}>Ver una vitrina real</Link></Button></div><div className="rounded-2xl border bg-card p-6 shadow-sm"><div className="mb-6 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm"><Globe aria-hidden className="h-4 w-4 shrink-0" /><span className="break-all">reficio.app/tu-negocio</span></div><p className="text-xs text-muted-foreground">Ejemplo de tu vitrina</p><h3 className="mt-2 text-2xl font-bold">El nombre de tu negocio</h3><p className="mt-2 text-muted-foreground">Reparaciones · Refacciones · Atención en mostrador</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl border p-4"><p className="font-medium">Servicios</p><p className="mt-2 text-sm text-muted-foreground">Tu trabajo y tus precios</p></div><div className="rounded-xl border p-4"><p className="font-medium">Refacciones</p><p className="mt-2 text-sm text-muted-foreground">Tu catálogo público</p></div></div></div></div>
  </LandingSection>
}
