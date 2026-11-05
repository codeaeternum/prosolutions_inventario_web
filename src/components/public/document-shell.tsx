import Link from "next/link"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"

interface DocumentShellProps {
  children: React.ReactNode
  maxWidth?: "2xl" | "6xl"
  showHomeButton?: boolean
}

export function DocumentShell({
  children,
  maxWidth = "2xl",
  showHomeButton = false,
}: DocumentShellProps) {
  const widthClass = maxWidth === "6xl" ? "max-w-6xl" : "max-w-2xl"
  const footerLayoutClass =
    maxWidth === "6xl"
      ? "flex-col sm:flex-row items-center justify-between gap-4"
      : "flex-col items-center gap-2 text-center"

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 safe-area-sticky z-50">
        <div className={`container mx-auto ${widthClass} flex h-14 items-center justify-between px-4`}>
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Wrench className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">Reficio</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {showHomeButton && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/">Inicio</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" role="main">
        {children}
      </main>

      <footer className="border-t py-8">
        <div className={`container mx-auto ${widthClass} px-4 flex ${footerLayoutClass} text-sm text-muted-foreground`}>
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
