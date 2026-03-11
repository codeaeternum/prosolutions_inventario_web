"use client"

import { useEffect, useRef, useState } from "react"
import { Html5Qrcode } from "html5-qrcode"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, CameraOff, Loader2 } from "lucide-react"

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose?: () => void
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState("")
  const [permissionDenied, setPermissionDenied] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const startScanner = async () => {
    setError("")
    setIsScanning(true)

    try {
      // Request camera permission
      await navigator.mediaDevices.getUserMedia({ video: true })

      if (!containerRef.current) return

      const scannerId = "barcode-scanner-container"

      // Create scanner instance
      const html5QrCode = new Html5Qrcode(scannerId)
      scannerRef.current = html5QrCode

      // Viewfinder cuadrado y responsive: ~70% del lado menor, sin recortes
      const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
        const size = Math.floor(Math.min(minEdge * 0.75, 400))
        return { width: size, height: size }
      }

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: qrboxFunction,
          aspectRatio: 1.0,
        },
        (decodedText) => {
          // On successful scan
          onScan(decodedText)
          stopScanner()
        },
        () => {
          // Ignore scan failures (normal when no barcode in view)
        }
      )
    } catch (err) {
      console.error("Scanner error:", err)
      setIsScanning(false)

      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          setPermissionDenied(true)
          setError("Permiso de cámara denegado. Por favor, permite el acceso a la cámara.")
        } else {
          setError("Error al iniciar el escáner: " + err.message)
        }
      }
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
        scannerRef.current = null
      } catch (err) {
        console.error("Error stopping scanner:", err)
      }
    }
    setIsScanning(false)
  }

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      stopScanner()
    }
  }, [])

  return (
    <Card className="w-full max-w-lg mx-auto overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Escanear Código de Barras
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
            {error}
          </div>
        )}

        {permissionDenied ? (
          <div className="text-center py-8">
            <CameraOff className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">
              Para escanear códigos de barras, necesitas permitir el acceso a la cámara
            </p>
            <Button onClick={() => window.location.reload()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            <div
              id="barcode-scanner-container"
              ref={containerRef}
              className={`w-full aspect-square max-h-[min(70vmin,400px)] bg-muted rounded-lg overflow-hidden ${
                isScanning ? "" : "hidden"
              }`}
            />

            {!isScanning && (
              <div className="text-center py-8">
                <Camera className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">
                  Apunta la cámara al código de barras del producto
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {!isScanning ? (
                <Button onClick={startScanner} className="flex-1">
                  <Camera className="mr-2 h-4 w-4" />
                  Iniciar Escáner
                </Button>
              ) : (
                <Button onClick={stopScanner} variant="outline" className="flex-1">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Escaneando...
                </Button>
              )}

              {onClose && (
                <Button variant="outline" onClick={onClose}>
                  Cerrar
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
