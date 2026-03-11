import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Smartphone, Share, QrCode, Camera } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Instalar app",
  description: "Cómo instalar Pro-Solutions en la pantalla de inicio del móvil (PWA)",
}

export default function InstalarPage() {
  return (
    <div className="min-h-screen bg-background p-4 pb-24">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Instalar Pro-Solutions</h1>
          <p className="text-muted-foreground mt-1">
            Úsala como app en el móvil: escanear QR de reservas, ventas, inventario y más.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              En el iPhone (Safari)
            </CardTitle>
            <CardDescription>Pasos para añadir a la pantalla de inicio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Abre <strong>Safari</strong> y entra a esta web.</li>
              <li>Inicia sesión si eres admin.</li>
              <li>
                Pulsa el botón <strong>Compartir</strong> <Share className="inline h-4 w-4" /> (cuadrado con flecha hacia arriba).
              </li>
              <li>Elige <strong>&quot;Añadir a la pantalla de inicio&quot;</strong>.</li>
              <li>Confirma el nombre y <strong>Añadir</strong>.</li>
            </ol>
            <p className="text-sm text-muted-foreground">
              Quedará un icono en la pantalla de inicio. Al abrirlo, se abre a pantalla completa como una app.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Escanear QR de reservas
            </CardTitle>
            <CardDescription>Desde la app instalada</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>En el menú admin (Operaciones) entra a <strong>Escanear reserva</strong>.</p>
            <p>Permite el acceso a la cámara cuando lo pida. Apunta al QR que enseñe el cliente y podrás verificar y marcar como entregado.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Cámara y permisos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Si la cámara no funciona: <strong>Ajustes → Safari → Cámara</strong> (o el nombre de la app) y déjalo en &quot;Preguntar&quot; o &quot;Permitir&quot;.</p>
            <p>Es mejor usar la app instalada (icono en la pantalla de inicio) que abrir la web desde Safari sin instalar.</p>
          </CardContent>
        </Card>

        <div className="flex justify-center gap-4">
          <Button asChild>
            <Link href="/">Ir al inicio</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin">Panel admin</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
