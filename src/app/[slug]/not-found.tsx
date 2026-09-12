import Link from "next/link"
import { Home, PackageSearch } from "lucide-react"
import { Button } from "@/components/ui/button"

// El slug no está reclamado por ningún negocio ni taller aliado (o el enlace
// está mal escrito). Card amable en vez del 404 genérico.
export default function SlugNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-primary/5">
      <main className="text-center max-w-md" role="main">
        <p className="text-6xl font-bold text-primary/20">404</p>
        <h1 className="text-2xl font-bold mt-4">Este enlace no está disponible</h1>
        <p className="text-muted-foreground mt-2">
          La dirección que buscas no corresponde a ningún negocio o taller registrado.
          Revisa el enlace o escríbenos por el canal habitual.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Button asChild>
            <Link href="/seguimiento">
              <PackageSearch className="h-4 w-4 mr-2" />
              Rastrea tu reparación
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <Home className="h-4 w-4 mr-2" />
              Ir al inicio
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
