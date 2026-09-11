"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Html5Qrcode } from "html5-qrcode"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, CameraOff, Loader2 } from "lucide-react"

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose?: () => void
}

interface CaptureSession {
  scanner: Html5Qrcode
  started: Promise<unknown>
  cancelled: boolean
  handled: boolean
  release?: Promise<void>
}

function releaseCapture(session: CaptureSession): Promise<void> {
  session.cancelled = true
  if (!session.release) {
    session.release = (async () => {
      // Permission/start may still be pending when a dialog or page closes.
      await session.started.catch(() => undefined)
      if (session.scanner.isScanning) await session.scanner.stop()
      session.scanner.clear()
    })().catch(() => undefined)
  }
  return session.release
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const scannerId = `barcode-scanner-${useId().replace(/:/g, "")}`
  const [isScanning, setIsScanning] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [error, setError] = useState("")
  const [permissionDenied, setPermissionDenied] = useState(false)
  const sessionRef = useRef<CaptureSession | null>(null)
  const mountedRef = useRef(true)

  const stopScanner = async () => {
    const session = sessionRef.current
    if (!session) return
    if (mountedRef.current) setIsStopping(true)
    await releaseCapture(session)
    if (sessionRef.current === session) {
      sessionRef.current = null
      if (mountedRef.current) {
        setIsScanning(false)
        setIsStopping(false)
      }
    }
  }

  const startScanner = async () => {
    if (sessionRef.current) return
    setError("")
    setPermissionDenied(false)
    setIsScanning(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("La cámara requiere una conexión HTTPS y un navegador compatible.")
      }
      // Html5Qrcode owns the only camera stream and requests permission itself.
      const scanner = new Html5Qrcode(scannerId)
      const session: CaptureSession = { scanner, started: Promise.resolve(), cancelled: false, handled: false }
      sessionRef.current = session
      session.started = scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => {
            const size = Math.floor(Math.min(Math.min(width, height) * 0.75, 400))
            return { width: size, height: size }
          },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (session.cancelled || session.handled) return
          session.handled = true
          void stopScanner()
          onScan(decodedText)
        },
        () => undefined
      )
      await session.started
      if (session.cancelled || !mountedRef.current) await releaseCapture(session)
    } catch (err) {
      const session = sessionRef.current
      if (session) await releaseCapture(session)
      if (sessionRef.current === session) sessionRef.current = null
      if (!mountedRef.current || session?.cancelled && session.handled) return
      setIsScanning(false)
      setIsStopping(false)
      const message = err instanceof Error ? err.message : String(err)
      const denied = /NotAllowedError|Permission denied|PermissionDismissedError/i.test(message) || (err instanceof Error && err.name === "NotAllowedError")
      setPermissionDenied(denied)
      setError(denied ? "Permite el acceso a la cámara en los ajustes del navegador y vuelve a intentar." : `No se pudo iniciar la cámara. ${message}`)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const session = sessionRef.current
      if (session) void releaseCapture(session)
    }
  }, [])

  return (
    <Card className="w-full max-w-lg mx-auto overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Camera className="h-5 w-5" />Escanear código</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">{error}</p>}
        <div id={scannerId} className={`w-full aspect-square max-h-[min(70vmin,400px)] bg-muted rounded-lg overflow-hidden ${isScanning ? "" : "hidden"}`} />
        {!isScanning && (
          <div className="text-center py-8">
            {permissionDenied ? <CameraOff className="h-16 w-16 mx-auto mb-4 text-muted-foreground" /> : <Camera className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />}
            <p className="text-muted-foreground">Apunta la cámara al código de barras o QR.</p>
          </div>
        )}
        <div className="flex gap-2">
          {!isScanning ? (
            <Button onClick={() => void startScanner()} className="flex-1"><Camera className="mr-2 h-4 w-4" />{error ? "Reintentar cámara" : "Iniciar escáner"}</Button>
          ) : (
            <Button onClick={() => void stopScanner()} disabled={isStopping} variant="outline" className="flex-1"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isStopping ? "Deteniendo..." : "Detener escáner"}</Button>
          )}
          {onClose && <Button variant="outline" onClick={() => { void stopScanner(); onClose() }}>Cerrar</Button>}
        </div>
      </CardContent>
    </Card>
  )
}
