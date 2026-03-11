import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Home, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <main className="text-center max-w-md" role="main">
        <p className="text-6xl font-bold text-primary/20">404</p>
        <h1 className="text-2xl font-bold mt-4">Página no encontrada</h1>
        <p className="text-muted-foreground mt-2">
          La ruta a la que intentas acceder no existe o fue movida.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Button asChild>
            <Link href="/">
              <Home className="h-4 w-4 mr-2" />
              Ir al inicio
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/catalogo">
              <Search className="h-4 w-4 mr-2" />
              Ver catálogo
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
