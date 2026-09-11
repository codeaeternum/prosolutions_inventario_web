import Image from "next/image"
import Link from "next/link"

export const dynamic = 'force-dynamic'

import { auth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { LayoutDashboard, MessageCircle, ArrowRight, Smartphone, ShieldCheck, Zap } from "lucide-react"

export default async function HomePage() {
  const session = await auth()

  const isLoggedIn = !!session
  const canAccessAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "EMPLOYEE"

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      {/* Header Minimalista */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 safe-area-sticky z-50">
        <div className="container mx-auto max-w-5xl flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={36}
              height={36}
              className="rounded-lg"
            />
            <span className="font-bold text-lg">Pro-Solutions</span>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle />
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
                <Link href="/login">Acceso Interno</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main id="main-content" className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center" role="main">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Zap className="h-4 w-4" />
            Refacciones para Celular al Mejor Precio
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Cotiza y Reserva <br className="hidden sm:block" />
            <span className="text-primary">Vía Telegram</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Búsqueda instantánea de refacciones, precios en tiempo real y reservas sin complicaciones.
            Todo desde nuestro asistente inteligente.
          </p>

          {/* CTA Principal - Bot */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button size="lg" className="w-full sm:w-auto gap-2 text-lg h-14 px-8" asChild>
              <a href="https://t.me/ProSolutions_Bot" target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-5 w-5" />
                Abrir en Telegram
                <ArrowRight className="h-5 w-5 ml-1" />
              </a>
            </Button>
          </div>

          {/* Beneficios */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 text-left">
            <div className="flex flex-col items-center sm:items-start gap-2 p-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">Modelos Compatibles</h3>
              <p className="text-sm text-muted-foreground">iPhone, Samsung, Xiaomi y más.</p>
            </div>
            <div className="flex flex-col items-center sm:items-start gap-2 p-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">Precios al Instante</h3>
              <p className="text-sm text-muted-foreground">Consulta disponibilidad y costo en segundos.</p>
            </div>
            <div className="flex flex-col items-center sm:items-start gap-2 p-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold">Reserva Segura</h3>
              <p className="text-sm text-muted-foreground">Aparta tu producto hasta pasar por él.</p>
            </div>
          </div>
        </div>
      </main>

      {/* Floating Bot Reminder - Para usuarios que llegan de rutas legacy */}
      {!isLoggedIn && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-card border shadow-lg rounded-xl p-4 animate-in slide-in-from-bottom-4 z-40">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-sm">¿Buscas refacciones?</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cotiza al instante en nuestro Bot de Telegram
              </p>
              <a
                href="https://t.me/ProSolutions_Bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-2"
              >
                Abrir @ProSolutions_Bot
                <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} Pro-Solutions. Todos los derechos reservados.</p>
      </footer>
    </div>
  )
}
