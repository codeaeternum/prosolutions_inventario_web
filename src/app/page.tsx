import Link from "next/link"

export const dynamic = 'force-dynamic'

import { auth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  LayoutDashboard, ArrowRight, Wrench, Smartphone, ShieldCheck, Zap,
  ClipboardList, Package, Store, CreditCard, QrCode, Users, Globe,
  ArrowLeftRight, Receipt, Search, Bell, CheckCircle2
} from "lucide-react"

const pipeline = ["Recepción", "Diagnóstico", "Presupuesto", "Autorización", "Reparación", "Listo", "Entregado"]

const pains = [
  { title: "“¿Y el patrón del equipo?”", desc: "Olvidar el PIN o patrón cuesta piezas y tiempo. Reficio lo captura al recibir — oculto hasta que lo necesitas." },
  { title: "Stock que “desaparece”", desc: "Si no sabes cuántas pantallas te quedan, no sabes cuánto estás perdiendo. Stock por sucursal, siempre exacto." },
  { title: "Cobros sin registrar", desc: "Anticipos en un cuaderno, saldos en la memoria. Aquí cada peso queda en caja y en la orden." },
]

const features = [
  {
    icon: ClipboardList,
    title: "Órdenes de reparación",
    desc: "Recibe cualquier electrónico con folio OT, condición de ingreso, accesorios y técnico asignado. Pipeline visual de recepción a entrega.",
  },
  {
    icon: Package,
    title: "Inventario por sucursal",
    desc: "Stock separado por local, traspasos atómicos entre sucursales, alertas de mínimos y compatibilidad por marca y modelo.",
  },
  {
    icon: Store,
    title: "Punto de venta y caja",
    desc: "Ventas con folio, pagos divididos (efectivo, tarjeta, transferencia, crédito), una caja por local y corte diario.",
  },
  {
    icon: CreditCard,
    title: "Crédito y fiado",
    desc: "Límite por cliente, saldo y abonos auditados. Vender a crédito deja de ser un volado.",
  },
  {
    icon: QrCode,
    title: "Rastreo público",
    desc: "Tu cliente consulta el estado de su equipo con folio — sin llamadas ni mensajes de '¿ya quedó?'.",
  },
  {
    icon: Users,
    title: "Mercado entre talleres",
    desc: "Tus talleres aliados piden refacciones a tu stock con precio mayoreo — tú decides qué productos ven.",
  },
]

const workflow = [
  { icon: Search, title: "Diagnostica", desc: "Registra la falla, adjunta evidencia y presupuesta con precio real." },
  { icon: ArrowLeftRight, title: "Conecta con inventario", desc: "Las refacciones usadas se descuentan del stock del local correcto." },
  { icon: Bell, title: "Avisa al cliente", desc: "Notificaciones al cambiar de estado; el cliente sigue su equipo en línea." },
  { icon: Receipt, title: "Cobra y documenta", desc: "Ticket imprimible, caja por sucursal y cierre con folio auditable." },
]

export default async function HomePage() {
  const session = await auth()

  const isLoggedIn = !!session
  const canAccessAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "EMPLOYEE"

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 safe-area-sticky z-50">
        <div className="container mx-auto max-w-6xl flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Wrench className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">Reficio</span>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/seguimiento">Rastrea tu reparación</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/catalogo">Ver demo</Link>
            </Button>
            {isLoggedIn && canAccessAdmin && (
              <Button size="sm" asChild>
                <Link href="/admin">
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  Panel
                </Link>
              </Button>
            )}
            {!isLoggedIn && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/login">Acceso interno</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <main id="main-content" className="flex-1" role="main">
        <section className="container mx-auto max-w-6xl px-4 pt-16 pb-20 text-center">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Zap className="h-4 w-4" />
              Software para talleres de reparación
            </div>

            <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tighter leading-[1.05]">
              Tu taller, reparado<br />
              <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">por dentro.</span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
              Reficio — del latín <em>reficere</em>, reparar — es el sistema operativo de tu taller:
              órdenes de reparación, inventario por sucursal, punto de venta, crédito y catálogo web en una sola herramienta.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-2">
              <Button size="lg" className="w-full sm:w-auto gap-2 text-lg h-14 px-8" asChild>
                <Link href="/catalogo">
                  Ver demo en vivo
                  <ArrowRight className="h-5 w-5 ml-1" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full sm:w-auto gap-2 text-lg h-14 px-8" asChild>
                <Link href="/registro">
                  <Store className="h-5 w-5" />
                  Crea tu negocio
                </Link>
              </Button>
            </div>

            {/* Pipeline visual */}
            <div className="pt-8">
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Del ingreso a la entrega</p>
              <div className="flex flex-wrap justify-center gap-2">
                {pipeline.map((stage, i) => (
                  <div key={stage} className="flex items-center gap-2">
                    <span className="px-3 py-1.5 rounded-full border bg-card text-sm font-medium">{stage}</span>
                    {i < pipeline.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Pain → solution */}
        <section className="border-t">
          <div className="container mx-auto max-w-6xl px-4 py-20">
            <div className="grid lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-8">
                <p className="text-xs font-semibold uppercase tracking-widest text-rose-500">Fugas de dinero</p>
                <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tighter leading-tight">
                  ¿Papel, Excel<br />o <span className="text-rose-500">caos</span>?
                </h2>
                <div className="space-y-6">
                  {pains.map((pain) => (
                    <div key={pain.title} className="border-l-2 border-rose-500/40 pl-4">
                      <h3 className="font-semibold">{pain.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{pain.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border bg-card p-8 space-y-6 lg:sticky lg:top-24">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
                  <Zap className="h-6 w-6 text-primary-foreground" />
                </div>
                <h3 className="text-2xl font-bold tracking-tight">La transformación digital</h3>
                <ul className="space-y-4">
                  {[
                    "Recepción con patrón, PIN y evidencia del estado físico",
                    "Anticipos y abonos que entran directo a caja",
                    "Rastreo público por folio — cero llamadas de “¿ya quedó?”",
                    "Inventario por sucursal con alertas de stock bajo",
                    "Tu marca, no la nuestra: tickets y rastreo con tu nombre",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
                <Button size="lg" className="w-full gap-2" asChild>
                  <Link href="/registro">Tomar el control<ArrowRight className="h-4 w-4" /></Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight">Todo el mostrador en un solo lugar</h2>
              <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
                Diseñado para cómo trabaja un taller real: recepción, refacciones, cobro y seguimiento.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((f) => (
                <div key={f.title} className="flex flex-col gap-3 p-6 rounded-xl border bg-card transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section className="border-t">
          <div className="container mx-auto max-w-6xl px-4 py-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight">Hecho para el trabajo diario</h2>
              <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
                No otro sistema genérico: cada pieza conecta con la siguiente.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {workflow.map((step, i) => (
                <div key={step.title} className="relative flex flex-col items-center text-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center relative">
                    <step.icon className="h-6 w-6 text-primary" />
                    <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  </div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Multi-branch / highlights */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-20">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <h2 className="text-3xl font-bold tracking-tight">Multi-sucursal de verdad</h2>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  Dos locales, un sistema. Cada sucursal tiene su inventario, su caja y su equipo de trabajo — y tú ves todo desde el mismo panel.
                </p>
                <ul className="space-y-3">
                  {[
                    "Stock independiente por local con traspasos auditados",
                    "Una caja por sucursal; cortes sin mezclar efectivo",
                    "Técnicos y secretarias con sucursal asignada",
                    "Ventas, reservas y reparaciones ligadas a su local",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: Smartphone, label: "Celulares" },
                  { icon: Wrench, label: "Cómputo" },
                  { icon: Package, label: "Consolas" },
                  { icon: Zap, label: "Audio y más" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-3 p-8 rounded-xl border bg-card">
                    <item.icon className="h-8 w-8 text-primary" />
                    <span className="font-medium text-sm">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Tu propia dirección */}
        <section className="border-t">
          <div className="container mx-auto max-w-6xl px-4 py-20">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">Tu propia dirección</p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  reficio.app/<span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">tu-negocio</span>
                </h2>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  Cada negocio obtiene su propia dirección dentro de Reficio — con tu nombre, no el nuestro.
                  Sin dominios que configurar ni hosting que pagar.
                </p>
                <ul className="space-y-3">
                  {[
                    "Vitrina pública con tu catálogo, servicios y mercado",
                    "Rastreo de reparaciones por folio para tus clientes",
                    "Mercado entre talleres: tus aliados compran a tu stock",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
                <Button size="lg" variant="outline" className="gap-2" asChild>
                  <Link href="/registro">Reserva tu dirección<ArrowRight className="h-4 w-4" /></Link>
                </Button>
              </div>
              {/* Mock de navegador */}
              <div className="rounded-2xl border bg-card shadow-lg shadow-primary/5 overflow-hidden">
                <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-rose-400/80" />
                  <span className="h-3 w-3 rounded-full bg-amber-400/80" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
                  <div className="ml-3 flex flex-1 items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate">reficio.app/tu-taller/order-status</span>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                      <Wrench className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">Tu Taller</p>
                      <p className="text-xs text-muted-foreground">Vitrina pública · reficio.app</p>
                    </div>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">Orden #RF-1024</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Listo para entrega</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full w-[85%] rounded-full bg-gradient-to-r from-primary to-indigo-500" />
                    </div>
                    <p className="text-xs text-muted-foreground">Tu cliente sigue su equipo sin llamarte.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {["Vitrina", "Rastreo", "Mercado"].map((label) => (
                      <div key={label} className="rounded-lg border bg-background py-2 text-xs font-medium text-muted-foreground">
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t">
          <div className="container mx-auto max-w-6xl px-4 py-20 text-center">
            <div className="max-w-2xl mx-auto space-y-6">
              <ShieldCheck className="h-10 w-10 text-primary mx-auto" />
              <h2 className="text-3xl font-bold tracking-tight">Pruébalo con datos reales</h2>
              <p className="text-muted-foreground text-lg">
                El catálogo de esta instancia funciona como demo en vivo. Si tienes un taller, cuéntanos cómo trabajas y lo adaptamos a ti.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
                <Button size="lg" className="gap-2" asChild>
                  <Link href="/catalogo">
                    Explorar el demo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="gap-2" asChild>
                  <Link href="/registro">Crear cuenta de prueba</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
              <Wrench className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Reficio</span>
            <span>· reficio.app</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/seguimiento" className="hover:text-foreground transition-colors">Rastrea tu reparación</Link>
            <p>© {new Date().getFullYear()} Reficio. Software para talleres de reparación.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
