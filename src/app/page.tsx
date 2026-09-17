import Link from "next/link"

export const dynamic = 'force-dynamic'

import { auth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  ArrowRight,
  ArrowLeftRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileCheck,
  Globe,
  KeyRound,
  LayoutDashboard,
  Link2,
  Lock,
  Package,
  PackageSearch,
  QrCode,
  Receipt,
  Search,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react"

const pipeline = [
  "Recepción",
  "Diagnóstico",
  "Presupuesto",
  "Autorización",
  "Reparación",
  "Listo",
  "Entregado",
]

const pains = [
  {
    icon: KeyRound,
    title: "“¿Y el patrón del equipo?”",
    desc: "Olvidar el PIN o el patrón cuesta piezas, tiempo y discusiones. Reficio lo captura al recibir — oculto hasta que el técnico lo necesita.",
  },
  {
    icon: PackageSearch,
    title: "Stock que “desaparece”",
    desc: "Si no sabes cuántas pantallas te quedan ni en qué sucursal están, no sabes cuánto estás perdiendo. Inventario por local, siempre exacto.",
  },
  {
    icon: Wallet,
    title: "Cobros que no entran a caja",
    desc: "Anticipos en un cuaderno, saldos en la memoria, fiados sin folio. Aquí cada peso queda registrado en caja y ligado a su orden.",
  },
]

const features = [
  {
    icon: Lock,
    title: "Recepción blindada",
    desc: "Captura patrón, PIN, accesorios y evidencia fotográfica del estado físico al ingresar el equipo. Nadie discute cómo llegó ni cómo se desbloquea.",
    tags: ["Patrón y PIN", "Evidencia", "Accesorios"],
    wide: true,
  },
  {
    icon: ClipboardList,
    title: "Pipeline de órdenes (OT)",
    desc: "Cada reparación avanza por un pipeline visual de recepción a entrega, con técnico asignado e historial completo.",
    wide: false,
  },
  {
    icon: ArrowLeftRight,
    title: "Inventario por sucursal",
    desc: "Stock separado por local, traspasos auditados entre sucursales y alertas de mínimos para que nunca falte la refacción.",
    wide: false,
  },
  {
    icon: Store,
    title: "Punto de venta y caja",
    desc: "Ventas con folio, pagos divididos (efectivo, tarjeta, transferencia, crédito), una caja por local y corte diario sin mezclar efectivo.",
    wide: false,
  },
  {
    icon: CreditCard,
    title: "Crédito y fiado con folios",
    desc: "Límite por cliente, saldo vivo y abonos auditados. Vender a crédito deja de ser un volado.",
    wide: false,
  },
  {
    icon: Link2,
    title: "Cotizaciones que se autorizan solas",
    desc: "Envía el presupuesto por link y el cliente autoriza o rechaza desde su celular. Sin llamadas, sin malentendidos.",
    wide: true,
  },
  {
    icon: QrCode,
    title: "Rastreo público por folio",
    desc: "QR de mostrador y rastreo en línea: tu cliente consulta el estado de su equipo cuando quiera — cero mensajes de “¿ya quedó?”.",
    wide: false,
  },
  {
    icon: Users,
    title: "Mercado entre talleres",
    desc: "Tus talleres aliados compran refacciones de tu stock con precio de mayoreo. Tú decides qué productos ven.",
    wide: false,
  },
]

const workflow = [
  {
    icon: Search,
    title: "Diagnostica",
    desc: "Registra la falla, adjunta evidencia y presupuesta con precio real.",
  },
  {
    icon: FileCheck,
    title: "El cliente autoriza",
    desc: "Recibe la cotización por link y aprueba el trabajo desde su celular.",
  },
  {
    icon: ArrowLeftRight,
    title: "Descuenta del stock",
    desc: "Las refacciones usadas salen del inventario del local correcto.",
  },
  {
    icon: Receipt,
    title: "Cobra y documenta",
    desc: "Ticket imprimible, caja por sucursal y cierre con folio auditable.",
  },
]

const vitrinaPoints = [
  "Vitrina pública con tu logo, catálogo de servicios y refacciones",
  "Rastreo de reparaciones por folio para tus clientes",
  "QR de mostrador para que cualquiera llegue a tu vitrina",
  "Mercado B2B: tus talleres aliados compran a tu stock",
]

const navLinks = [
  { href: "#funciones", label: "Funciones" },
  { href: "#flujo", label: "Cómo funciona" },
  { href: "#vitrina", label: "Tu vitrina" },
  { href: "#precio", label: "Precio" },
]

export default async function HomePage() {
  const session = await auth()

  const isLoggedIn = !!session
  const canAccessAdmin =
    session?.user?.role === "ADMIN" || session?.user?.role === "EMPLOYEE"

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-clip">
      {/* ===================== Navbar ===================== */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md safe-area-sticky">
        <div className="container mx-auto max-w-6xl flex h-16 items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-sm shadow-primary/30">
              <Wrench className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <span className="font-bold text-lg tracking-tight block">Reficio</span>
              <span className="text-[10px] text-muted-foreground hidden sm:block -mt-0.5">reficio.app</span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="Secciones">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            {isLoggedIn && canAccessAdmin ? (
              <Button size="sm" asChild>
                <Link href="/admin">
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  Ir al panel
                </Link>
              </Button>
            ) : (
              <>
                {!isLoggedIn && (
                  <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                    <Link href="/login">Acceso interno</Link>
                  </Button>
                )}
                <Button size="sm" asChild className="shadow-sm shadow-primary/25">
                  <Link href="/registro">Crear mi negocio</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" role="main">
        {/* ===================== Hero ===================== */}
        <section className="relative border-b">
          {/* Fondo decorativo */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, color-mix(in oklab, var(--primary) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--primary) 7%, transparent) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage:
                "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 75%)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[420px] w-[720px] rounded-full bg-primary/15 blur-3xl"
          />

          <div className="container relative mx-auto max-w-6xl px-4 pt-14 pb-16 sm:pt-20 sm:pb-24">
            <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
              {/* Copy */}
              <div className="text-center lg:text-left space-y-7">
                <div className="inline-flex items-center gap-2 rounded-full border bg-card/80 backdrop-blur px-4 py-1.5 text-sm font-medium shadow-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  Software para talleres de reparación
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tighter leading-[1.08]">
                  El sistema operativo de tu{" "}
                  <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">
                    taller de reparación
                  </span>
                </h1>

                <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed">
                  Órdenes de reparación, inventario por sucursal, punto de venta,
                  crédito a tus clientes y una vitrina pública con tu marca — todo
                  en una sola herramienta, en español y pensado para México.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <Button size="lg" className="h-12 px-7 text-base gap-2 shadow-lg shadow-primary/25" asChild>
                    <Link href="/registro">
                      Crea tu negocio gratis
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="h-12 px-7 text-base gap-2 bg-card/60 backdrop-blur" asChild>
                    <Link href="/mercado">
                      <Store className="h-5 w-5" />
                      Explorar el mercado
                    </Link>
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Gratis durante el piloto · Sin tarjeta · Tu dirección reficio.app/tu-negocio
                </p>
              </div>

              {/* Mock: orden de reparación */}
              <div className="relative mx-auto w-full max-w-md">
                <div
                  aria-hidden
                  className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-primary/15 via-transparent to-indigo-500/15 blur-2xl"
                />
                <div className="relative rounded-2xl border bg-card shadow-2xl shadow-primary/10 overflow-hidden">
                  {/* Barra superior del mock */}
                  <div className="flex items-center justify-between border-b bg-muted/40 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
                        <Wrench className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <span className="text-sm font-semibold tracking-tight">OT-1024</span>
                    </div>
                    <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2.5 py-0.5 text-xs font-medium">
                      En reparación
                    </span>
                  </div>

                  <div className="p-5 space-y-5">
                    {/* Equipo */}
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Smartphone className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">iPhone 13 — Cambio de pantalla</p>
                        <p className="text-xs text-muted-foreground">Sucursal Centro · Téc. Mariana</p>
                      </div>
                      <div className="ml-auto text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                        <p className="text-sm font-bold">$1,850</p>
                      </div>
                    </div>

                    {/* Mini pipeline */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1">
                        {pipeline.map((stage, i) => (
                          <div
                            key={stage}
                            className={
                              i <= 4
                                ? "h-1.5 flex-1 rounded-full bg-gradient-to-r from-primary to-indigo-500"
                                : "h-1.5 flex-1 rounded-full bg-muted"
                            }
                          />
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Recepción</span>
                        <span className="font-medium text-foreground">Reparación</span>
                        <span>Entregado</span>
                      </div>
                    </div>

                    {/* Patrón + checklist */}
                    <div className="flex gap-4">
                      <div className="rounded-xl border bg-muted/30 p-3 shrink-0">
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" /> Patrón
                        </p>
                        <svg viewBox="0 0 60 60" className="h-14 w-14" aria-hidden>
                          <polyline
                            points="10,10 30,10 30,30 50,30 50,50"
                            fill="none"
                            className="stroke-primary"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity="0.55"
                          />
                          {[10, 30, 50].flatMap((y) =>
                            [10, 30, 50].map((x) => (
                              <circle
                                key={`${x}-${y}`}
                                cx={x}
                                cy={y}
                                r="3.5"
                                className={
                                  (x === 10 && y === 10) ||
                                  (x === 30 && (y === 10 || y === 30)) ||
                                  (x === 50 && (y === 30 || y === 50))
                                    ? "fill-primary"
                                    : "fill-muted-foreground/25"
                                }
                              />
                            ))
                          )}
                        </svg>
                      </div>
                      <ul className="flex-1 space-y-2 text-xs">
                        {[
                          "Refacción apartada del stock",
                          "Anticipo $500 registrado en caja",
                          "Cliente autorizó por link",
                        ].map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            <span className="text-muted-foreground leading-tight">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Chips flotantes */}
                <div className="absolute -right-3 -top-4 hidden sm:flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-xs font-medium shadow-lg">
                  <QrCode className="h-3.5 w-3.5 text-primary" />
                  QR de mostrador
                </div>
                <div className="absolute -left-4 -bottom-5 hidden sm:flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-xs font-medium shadow-lg">
                  <Bell className="h-3.5 w-3.5 text-primary" />
                  Cliente notificado
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===================== Pipeline ===================== */}
        <section id="flujo" className="scroll-mt-20">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <div className="text-center mb-10">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
                Flujo de trabajo
              </p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Del ingreso a la entrega, sin saltos
              </h2>
              <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
                Un pipeline claro que todo tu equipo entiende. Cada orden lleva su
                folio, su técnico y su historial.
              </p>
            </div>

            <div className="overflow-x-auto pb-2 -mx-4 px-4">
              <ol className="flex items-stretch gap-0 min-w-[640px] max-w-4xl mx-auto">
                {pipeline.map((stage, i) => (
                  <li key={stage} className="flex flex-1 items-center">
                    <div className="flex flex-col items-center gap-2.5 w-full">
                      <div
                        className={
                          i <= 4
                            ? "h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shadow-md shadow-primary/25"
                            : "h-10 w-10 rounded-full border-2 border-dashed border-muted-foreground/30 text-muted-foreground flex items-center justify-center text-sm font-bold"
                        }
                      >
                        {i + 1}
                      </div>
                      <span className="text-xs font-medium text-center leading-tight">
                        {stage}
                      </span>
                    </div>
                    {i < pipeline.length - 1 && (
                      <div
                        className={
                          i < 4
                            ? "h-0.5 w-full -mt-7 bg-gradient-to-r from-primary to-indigo-500"
                            : "h-0.5 w-full -mt-7 bg-border"
                        }
                        aria-hidden
                      />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ===================== Pains ===================== */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <div className="grid lg:grid-cols-2 gap-12 items-start">
              <div className="space-y-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-rose-500 mb-3">
                    Fugas de dinero
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                    ¿Papel, Excel{" "}
                    <span className="text-rose-500">o caos</span>?
                  </h2>
                  <p className="text-muted-foreground mt-3">
                    Los talleres no quiebran por falta de trabajo — pierden por
                    descuido. Estas son las fugas que Reficio tapa desde el día uno.
                  </p>
                </div>
                <div className="space-y-4">
                  {pains.map((pain) => (
                    <div
                      key={pain.title}
                      className="flex gap-4 rounded-xl border bg-card p-4 border-l-2 border-l-rose-500/60"
                    >
                      <div className="h-10 w-10 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0">
                        <pain.icon className="h-5 w-5 text-rose-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{pain.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          {pain.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border bg-card p-8 space-y-6 lg:sticky lg:top-24 shadow-lg shadow-primary/5">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-md shadow-primary/25">
                  <Zap className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">
                    El taller, bajo control
                  </h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    Cada movimiento deja rastro: quién recibió, qué se cobró, qué
                    refacción salió y de qué sucursal.
                  </p>
                </div>
                <ul className="space-y-3.5">
                  {[
                    "Recepción con patrón, PIN y evidencia del estado físico",
                    "Anticipos y abonos que entran directo a caja",
                    "Cotizaciones que el cliente autoriza por link",
                    "Corte de caja diario por sucursal, sin mezclar efectivo",
                    "Tu marca, no la nuestra: tickets y rastreo con tu nombre",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
                <Button size="lg" className="w-full gap-2" asChild>
                  <Link href="/registro">
                    Tomar el control
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ===================== Features (bento) ===================== */}
        <section id="funciones" className="border-t scroll-mt-20">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
                Funciones
              </p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Todo el mostrador en un solo lugar
              </h2>
              <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
                Diseñado para cómo trabaja un taller real: recepción, refacciones,
                cobro y seguimiento — no otro sistema genérico.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {features.map((f) => (
                <div
                  key={f.title}
                  className={
                    "group flex flex-col gap-3 rounded-2xl border bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5" +
                    (f.wide ? " lg:col-span-2" : "")
                  }
                >
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center transition-colors group-hover:bg-primary/15">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg tracking-tight">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                  {"tags" in f && f.tags && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {f.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===================== Workflow ===================== */}
        <section className="border-t bg-muted/30">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
                Día a día
              </p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Cada pieza conecta con la siguiente
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {workflow.map((step, i) => (
                <div
                  key={step.title}
                  className="relative flex flex-col items-center text-center gap-3"
                >
                  {i < workflow.length - 1 && (
                    <ChevronRight
                      className="hidden lg:block absolute top-5 -right-5 h-5 w-5 text-muted-foreground/40"
                      aria-hidden
                    />
                  )}
                  <div className="h-14 w-14 rounded-2xl bg-card border shadow-sm flex items-center justify-center relative">
                    <step.icon className="h-6 w-6 text-primary" />
                    <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center shadow-sm">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===================== Vitrina / tu-negocio ===================== */}
        <section id="vitrina" className="border-t scroll-mt-20">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6 order-2 lg:order-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Tu propia dirección
                </p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  reficio.app/
                  <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">
                    tu-negocio
                  </span>
                </h2>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  Al registrarte obtienes tu vitrina pública con tu logo y tu
                  nombre — sin dominios que configurar ni hosting que pagar.
                </p>
                <ul className="space-y-3">
                  {vitrinaPoints.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
                <Button size="lg" variant="outline" className="gap-2" asChild>
                  <Link href="/registro">
                    Reserva tu dirección
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>

              {/* Mock de navegador */}
              <div className="order-1 lg:order-2">
                <div className="rounded-2xl border bg-card shadow-2xl shadow-primary/10 overflow-hidden">
                  <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
                    <span className="h-3 w-3 rounded-full bg-rose-400/80" />
                    <span className="h-3 w-3 rounded-full bg-amber-400/80" />
                    <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
                    <div className="ml-3 flex flex-1 items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                      <Globe className="h-3 w-3 shrink-0" />
                      <span className="truncate">reficio.app/tu-taller</span>
                    </div>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center">
                        <Wrench className="h-5 w-5 text-primary-foreground" />
                      </div>
                      <div>
                        <p className="font-semibold leading-tight">Tu Taller</p>
                        <p className="text-xs text-muted-foreground">
                          Vitrina pública · reficio.app
                        </p>
                      </div>
                      <QrCode className="ml-auto h-5 w-5 text-muted-foreground/50" />
                    </div>

                    <div className="rounded-xl border bg-muted/30 p-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">Orden RF-1024</span>
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          Listo para entrega
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full w-[85%] rounded-full bg-gradient-to-r from-primary to-indigo-500" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Tu cliente sigue su equipo sin llamarte.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { name: "Pantalla A15", price: "$1,290" },
                        { name: "Batería X2", price: "$450" },
                        { name: "Mica + funda", price: "$199" },
                      ].map((p) => (
                        <div key={p.name} className="rounded-xl border bg-background p-2.5 space-y-1.5">
                          <div className="aspect-[4/3] rounded-lg bg-muted/60 flex items-center justify-center">
                            <Package className="h-4 w-4 text-muted-foreground/40" />
                          </div>
                          <p className="text-[10px] font-medium truncate leading-tight">{p.name}</p>
                          <p className="text-[10px] font-bold text-primary">{p.price}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===================== Precio ===================== */}
        <section id="precio" className="border-t bg-muted/30 scroll-mt-20">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <div className="mx-auto max-w-2xl">
              <div className="text-center mb-10">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">
                  Precio
                </p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  Empieza gratis
                </h2>
                <p className="text-muted-foreground mt-3">
                  Estamos en piloto con talleres reales. Entra hoy y crece con el
                  producto.
                </p>
              </div>

              <div className="rounded-2xl border bg-card p-8 sm:p-10 shadow-xl shadow-primary/10 relative overflow-hidden">
                <div
                  aria-hidden
                  className="absolute -top-20 -right-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
                />
                <div className="relative flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-10">
                  <div className="shrink-0">
                    <p className="text-sm font-medium text-muted-foreground">Piloto Reficio</p>
                    <p className="mt-1 text-5xl font-extrabold tracking-tighter">$0</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Gratis durante el piloto
                    </p>
                  </div>
                  <div className="h-px sm:h-24 sm:w-px bg-border" aria-hidden />
                  <ul className="flex-1 space-y-2.5">
                    {[
                      "Órdenes de reparación con pipeline completo",
                      "Inventario, caja y punto de venta por sucursal",
                      "Tu vitrina en reficio.app/tu-negocio",
                      "Crédito, cotizaciones y rastreo por folio",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm">
                        <CheckCircle2 className="h-[18px] w-[18px] text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="relative mt-8 flex flex-col sm:flex-row items-center gap-4">
                  <Button size="lg" className="w-full sm:w-auto gap-2 shadow-lg shadow-primary/25" asChild>
                    <Link href="/registro">
                      Crea tu negocio gratis
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Sin tarjeta · Sin compromiso · Tu feedback define el producto
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===================== CTA final ===================== */}
        <section className="border-t">
          <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary via-indigo-500 to-violet-600 px-6 py-14 sm:px-12 text-center text-primary-foreground">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4), transparent 45%), radial-gradient(circle at 85% 80%, rgba(0,0,0,0.35), transparent 50%)",
                }}
              />
              <div className="relative max-w-2xl mx-auto space-y-6">
                <ShieldCheck className="h-11 w-11 mx-auto opacity-90" />
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  Tu taller ya tiene sistema operativo
                </h2>
                <p className="text-base sm:text-lg opacity-90">
                  Registra tu negocio, recibe tu primera orden con patrón y folio,
                  y mira tu vitrina en línea hoy mismo.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                  <Button
                    size="lg"
                    variant="secondary"
                    className="h-12 px-8 text-base gap-2 shadow-lg"
                    asChild
                  >
                    <Link href="/registro">
                      Crea tu negocio gratis
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 px-8 text-base gap-2 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    asChild
                  >
                    <Link href="/mercado">Explorar el mercado</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ===================== Footer ===================== */}
      <footer className="border-t">
        <div className="container mx-auto max-w-6xl px-4 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
                <Wrench className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold tracking-tight">Reficio</span>
              <span className="text-sm text-muted-foreground">· reficio.app</span>
            </Link>

            <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-label="Pie de página">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="hover:text-foreground transition-colors">
                  {link.label}
                </Link>
              ))}
              <Link href="/seguimiento" className="hover:text-foreground transition-colors">
                Rastrea tu reparación
              </Link>
              <Link href="/login" className="hover:text-foreground transition-colors">
                Acceso interno
              </Link>
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t text-center sm:text-left text-xs text-muted-foreground">
            <p>
              © {new Date().getFullYear()} Reficio — del latín <em>reficere</em>,
              reparar. Software para talleres de reparación.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
