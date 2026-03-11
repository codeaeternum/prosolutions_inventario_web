"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BarcodeScanner } from "@/components/barcode-scanner"
import { QrCode, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * Extrae el código de reserva del contenido escaneado.
 * Acepta: "https://dominio.com/verificar/CODE" o solo "CODE" (id o qrCode de la reserva).
 */
function extractReservationCode(decodedText: string): string {
  const trimmed = decodedText.trim()
  try {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/verificar\/([^/]+)/)
    if (match) return match[1]
  } catch {
    // No es URL, usar como código directo
  }
  return trimmed
}

export default function AdminVerificarPage() {
  const router = useRouter()

  const handleScan = (decodedText: string) => {
    const code = extractReservationCode(decodedText)
    if (!code) return
    router.push(`/verificar/${encodeURIComponent(code)}`)
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/reservas" aria-label="Volver a Reservas">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <QrCode className="h-6 w-6" />
            Escanear QR de reserva
          </h1>
          <p className="text-muted-foreground text-sm">
            Apunta la cámara al QR que te mostró el cliente. Irás directo a verificar y marcar como entregado.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cámara</CardTitle>
          <CardDescription>
            Permite el acceso a la cámara cuando el navegador lo pida. Funciona en la PWA instalada en el móvil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BarcodeScanner onScan={handleScan} />
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/admin/reservas" className="underline hover:text-foreground">
          Ver lista de reservas
        </Link>
      </p>
    </div>
  )
}
