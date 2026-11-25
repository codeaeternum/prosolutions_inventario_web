import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { listLandingDirectoryBusinesses, type LandingDirectoryBusiness } from "@/lib/directory"
import { LandingHeader } from "@/components/landing/landing-header"
import { Hero } from "@/components/landing/hero"
import { ProofStrip } from "@/components/landing/proof-strip"
import { ProblemComparison } from "@/components/landing/problem-comparison"
import { FeaturePillars } from "@/components/landing/feature-pillars"
import { OrderLifecycle } from "@/components/landing/order-lifecycle"
import { Storefront } from "@/components/landing/storefront"
import { Audiences } from "@/components/landing/audiences"
import { GettingStarted } from "@/components/landing/getting-started"
import { PilotPricing } from "@/components/landing/pilot-pricing"
import { Faq } from "@/components/landing/faq"
import { FinalCta } from "@/components/landing/final-cta"
import { LandingFooter } from "@/components/landing/landing-footer"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Reficio — Controla reparaciones, refacciones y caja de tu taller",
  description:
    "Software para talleres y tiendas de refacciones: órdenes de reparación con evidencia, inventario por sucursal, punto de venta, caja y tu propia vitrina en reficio.app.",
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
}

export default async function HomePage() {
  const session = await auth()
  let directoryBusinesses: LandingDirectoryBusiness[] = []
  try {
    directoryBusinesses = await listLandingDirectoryBusinesses(6)
  } catch {
    // La landing sigue disponible si falla el directorio.
    directoryBusinesses = []
  }
  const storefrontHref = directoryBusinesses[0] ? `/${directoryBusinesses[0].slug}` : "/mercado"
  const canAccessAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "EMPLOYEE"

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingHeader isLoggedIn={!!session} canAccessAdmin={canAccessAdmin} />
      <main id="main-content" className="flex-1">
        <Hero storefrontHref={storefrontHref} />
        <ProofStrip businesses={directoryBusinesses} />
        <ProblemComparison />
        <FeaturePillars />
        <OrderLifecycle />
        <Storefront storefrontHref={storefrontHref} />
        <Audiences />
        <GettingStarted />
        <PilotPricing />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
