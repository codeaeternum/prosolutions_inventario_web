import type { Metadata } from "next"
import Link from "next/link"
import { Wrench } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getBusinessSetting } from "@/lib/settings"
import { repairFolio } from "@/lib/workshop-labels"
import { loadQuoteByToken } from "@/lib/public-quote"
import { QuoteDocument, QuoteNotFound } from "@/components/public/quote-view"
import { ThemeToggle } from "@/components/theme-toggle"

export const dynamic = "force-dynamic"

// Página global de cotización: fallback sin marca cuando el negocio no tiene
// slug público o el enlace se compartió como /cotizacion/<token>. La variante
// brandeada vive en /<slug>/cotizacion/[token] y reutiliza QuoteDocument.

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const order = await prisma.repairOrder.findUnique({ where: { quoteToken: token }, select: { number: true } })
  return {
    title: order ? `Cotización ${repairFolio(order.number)}` : "Cotización",
    description: "Consulta y autoriza la cotización de tu reparación.",
    // Enlace privado por WhatsApp: nunca indexable.
    robots: { index: false, follow: false },
  }
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 safe-area-sticky z-50">
        <div className="container mx-auto max-w-2xl flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Wrench className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">Reficio</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" className="flex-1" role="main">
        {children}
      </main>
      <footer className="border-t py-8">
        <div className="container mx-auto max-w-2xl px-4 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
              <Wrench className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Reficio</span>
            <span>· reficio.app</span>
          </div>
          <p>© {new Date().getFullYear()} Reficio. Software para talleres de reparación.</p>
        </div>
      </footer>
    </div>
  )
}

export default async function CotizacionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await loadQuoteByToken(token)

  // Igual que la API pública: una vez entregada o cancelada la cotización ya
  // no es un documento vigente — no debe seguir mostrando montos ni datos.
  if (!order || order.status === "DELIVERED" || order.status === "CANCELLED") {
    return (
      <PageShell>
        <QuoteNotFound trackingHref="/seguimiento" />
      </PageShell>
    )
  }

  // El branding sale del negocio DUEÑO de la orden, no del negocio por defecto.
  const businessName = await getBusinessSetting(order.businessId, "ticket_business_name")

  return (
    <PageShell>
      <QuoteDocument
        order={order}
        businessName={businessName || "PROSOLUTIONS"}
        token={token}
      />
    </PageShell>
  )
}
