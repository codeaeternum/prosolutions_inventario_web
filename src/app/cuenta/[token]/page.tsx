import type { Metadata } from "next"
import Link from "next/link"
import { AlertCircle, ArrowDownRight, ArrowUpRight, CalendarCheck, TimerOff, Wallet, Wrench } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { loadStatementByToken, type PublicStatement } from "@/lib/customer-statement"
import { ThemeToggle } from "@/components/theme-toggle"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"

export const dynamic = "force-dynamic"

// Estado de cuenta público del cliente: llega por WhatsApp como
// /cuenta/<token>. Server component que consulta directo con el mismo loader
// de la API (/api/cuenta/[token]) — el documento sale renderizado sin login
// y con la misma selección de campos (nada de ids internos ni contacto).

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const user = await prisma.user.findUnique({
    where: { statementToken: token },
    select: { business: { select: { name: true } } },
  })
  return {
    title: user ? `Estado de cuenta · ${user.business.name}` : "Estado de cuenta",
    description: "Consulta tu saldo, movimientos de crédito y apartados.",
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 border-b border-neutral-300 pb-1 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
      {children}
    </h3>
  )
}

const MOVEMENT_LABELS: Record<PublicStatement["movements"][number]["type"], string> = {
  DEBT: "Cargo",
  PAYMENT: "Abono",
  REVERSAL: "Reversión",
}

/** Token sin cuenta detrás: enlace incompleto o negocio que lo retiró. */
function StatementNotFound() {
  return (
    <section className="container mx-auto max-w-2xl px-4 pt-16 pb-20">
      <div className="rounded-2xl border border-dashed bg-card p-10 text-center space-y-4 shadow-sm">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Estado de cuenta no encontrado</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          El enlace pudo escribirse incompleto o ya no estar vigente. Pide en la tienda que te lo reenvíen por WhatsApp.
        </p>
      </div>
    </section>
  )
}

/** El token existe pero su vigencia terminó: distinto de "no encontrado". */
function StatementExpired() {
  return (
    <section className="container mx-auto max-w-2xl px-4 pt-16 pb-20">
      <div className="rounded-2xl border border-dashed bg-card p-10 text-center space-y-4 shadow-sm">
        <TimerOff className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Este enlace venció</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Por seguridad los estados de cuenta caducan. Pide en la tienda un enlace nuevo para consultar tu saldo.
        </p>
      </div>
    </section>
  )
}

function StatementDocument({ statement, linkExpiresAt }: { statement: PublicStatement; linkExpiresAt: Date | null }) {
  const owes = statement.creditBalance > 0
  const available =
    statement.creditLimit != null ? Math.max(0, statement.creditLimit - statement.creditBalance) : null

  return (
    <section className="container mx-auto max-w-2xl px-4 pt-8 pb-16 space-y-6">
      {/* Documento "papel": siempre claro aunque el tema del teléfono sea
          oscuro, igual que la cotización pública (quote-view). */}
      <article className="overflow-hidden rounded-2xl bg-white text-neutral-900 shadow-xl ring-1 ring-black/5">
        <div className="h-1.5 bg-gradient-to-r from-violet-700 via-violet-500 to-fuchsia-500" />
        <div className="space-y-6 p-6 sm:p-8 text-sm">

          {/* Membrete */}
          <div className="border-b-2 border-neutral-900 pb-4 text-center">
            <h1 className="text-xl font-extrabold uppercase leading-tight tracking-tight">
              {statement.businessName}
            </h1>
            <h2 className="mt-1.5 text-xs font-bold uppercase tracking-[0.25em] text-violet-700">
              Estado de cuenta
            </h2>
            <p className="mt-2 text-xs text-neutral-600">
              Cliente: <span className="font-bold text-neutral-900">{statement.customerName}</span>
            </p>
          </div>

          {/* Saldo */}
          <section>
            <SectionTitle>Tu saldo</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="rounded-xl bg-neutral-50 p-4 text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 flex items-center justify-center gap-1">
                  <Wallet className="h-3.5 w-3.5" /> Saldo actual
                </p>
                <p className={`mt-1 text-3xl font-extrabold ${owes ? "text-red-700" : "text-emerald-700"}`}>
                  {formatPrice(statement.creditBalance)}
                </p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {owes ? "Pendiente por pagar" : "Estás al corriente"}
                </p>
              </div>
              <div className="rounded-xl bg-neutral-50 p-4 text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                  Límite de crédito
                </p>
                <p className="mt-1 text-3xl font-extrabold">
                  {statement.creditLimit != null ? formatPrice(statement.creditLimit) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {statement.creditLimit != null
                    ? `Disponible: ${formatPrice(available ?? 0)}`
                    : "Sin línea de crédito configurada"}
                </p>
              </div>
            </div>
          </section>

          {/* Movimientos de crédito */}
          <section>
            <SectionTitle>Movimientos de crédito</SectionTitle>
            {statement.movements.length === 0 ? (
              <p className="py-2 text-neutral-600">Sin movimientos de crédito registrados.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {statement.movements.map((mov, idx) => {
                  const isDebt = mov.type === "DEBT"
                  return (
                    <li key={idx} className="flex items-center gap-3 py-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          isDebt ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {isDebt ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-tight">{MOVEMENT_LABELS[mov.type]}</p>
                        {mov.note && <p className="truncate text-xs text-neutral-500">{mov.note}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-bold whitespace-nowrap ${isDebt ? "text-red-700" : "text-emerald-700"}`}>
                          {isDebt ? "+" : "−"}{formatPrice(mov.amount)}
                        </p>
                        <p className="text-[11px] text-neutral-500">{formatDate(mov.createdAt)}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Apartados activos */}
          <section>
            <SectionTitle>Apartados activos</SectionTitle>
            {statement.layaways.length === 0 ? (
              <p className="py-2 text-neutral-600">No tienes apartados pendientes de liquidar.</p>
            ) : (
              <ul className="space-y-2 pt-1">
                {statement.layaways.map((layaway) => (
                  <li key={layaway.number} className="rounded-xl border border-neutral-200 p-3.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold">{layaway.folio}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                        <CalendarCheck className="h-3 w-3" /> Apartado
                      </span>
                      <span className="ml-auto text-[11px] text-neutral-500">{formatDay(layaway.createdAt)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                      <p className="text-xs text-neutral-600">
                        Total {formatPrice(layaway.total)} · abonado{" "}
                        <span className="font-semibold text-emerald-700">{formatPrice(layaway.paid)}</span>
                      </p>
                      <p className="text-sm">
                        Resta{" "}
                        <span className={`font-extrabold ${layaway.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>
                          {formatPrice(layaway.balance)}
                        </span>
                      </p>
                    </div>
                    {layaway.expiresAt && (
                      <p className="mt-1.5 text-[11px] text-neutral-500">
                        Vence el {formatDay(layaway.expiresAt)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="rounded-xl bg-neutral-50 p-4 text-[11px] leading-snug text-neutral-600">
            Este enlace es personal: muestra solo tu saldo y tus movimientos.
            {linkExpiresAt ? ` Deja de funcionar el ${formatDay(linkExpiresAt)}.` : ""}{" "}
            Si tienes dudas sobre un cargo o un abono, acércate a {statement.businessName}.
          </p>
        </div>
      </article>
    </section>
  )
}

export default async function CuentaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await loadStatementByToken(token)

  // Igual que la API pública: negocio suspendido o token inexistente responden
  // como "no encontrado"; el vencido muestra su propio mensaje.
  if (result.kind === "not_found") {
    return (
      <PageShell>
        <StatementNotFound />
      </PageShell>
    )
  }
  if (result.kind === "expired") {
    return (
      <PageShell>
        <StatementExpired />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <StatementDocument statement={result.statement} linkExpiresAt={result.expiresAt} />
    </PageShell>
  )
}
