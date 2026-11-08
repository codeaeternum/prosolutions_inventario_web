"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Html5Qrcode } from "html5-qrcode"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, CameraOff, CheckCircle2, Loader2 } from "lucide-react"
import { shouldAcceptScan, type ScanDedupState } from "@/lib/scan-dedup"

interface BarcodeScannerProps {
  onScan: (code: string) => void
  onClose?: () => void
  open?: boolean
  /**
   * Modo continuo (mostrador con muchos items): la cámara NO se detiene tras
   * una lectura — cada código aceptado llama `onScan` y el escáner sigue
   * hasta «Listo (N)». El mismo código se ignora ~1.8 s (re-lectura del
   * frame); uno distinto pasa al instante.
   */
  continuous?: boolean
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

export function BarcodeScanner({ onScan, onClose, open = true, continuous = false }: BarcodeScannerProps) {
  const scannerId = `barcode-scanner-${useId().replace(/:/g, "")}`
  const [isScanning, setIsScanning] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [error, setError] = useState("")
  const [permissionDenied, setPermissionDenied] = useState(false)
  // Feedback del modo continuo: último código aceptado (visible un momento
  // para confirmar) y cuántos lleva la sesión — «Listo (N)» cierra.
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const sessionRef = useRef<CaptureSession | null>(null)
  const mountedRef = useRef(true)
  // El callback de decode queda capturado al arrancar la cámara: sin refs,
  // en continuo cada lectura llamaría un onScan/continuous viejos.
  const onScanRef = useRef(onScan)
  const continuousRef = useRef(continuous)
  const lastAcceptedRef = useRef<ScanDedupState | null>(null)

  useEffect(() => { onScanRef.current = onScan }, [onScan])
  useEffect(() => { continuousRef.current = continuous }, [continuous])

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
    // Sesión nueva del modo continuo: contador y dedup arrancan en cero.
    lastAcceptedRef.current = null
    setLastCode(null)
    setScanCount(0)
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
            const size = Math.max(50, Math.floor(Math.min(Math.min(width, height) * 0.75, 400)))
            return { width: size, height: size }
          },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (session.cancelled) return
          if (!continuousRef.current) {
            if (session.handled) return
            session.handled = true
            void stopScanner()
            onScanRef.current(decodedText)
            return
          }
          // Continuo: dedup por último código+timestamp — la misma pieza
          // frente a la cámara no entra dos veces; la siguiente pieza sí.
          const now = Date.now()
          if (!shouldAcceptScan(lastAcceptedRef.current, decodedText, now)) return
          lastAcceptedRef.current = { code: decodedText, at: now }
          if (mountedRef.current) {
            setLastCode(decodedText)
            setScanCount(c => c + 1)
          }
          onScanRef.current(decodedText)
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

  useEffect(() => {
    if (!open) {
      void stopScanner()
      return
    }
    const timer = setTimeout(() => {
      if (mountedRef.current) void startScanner()
    }, 60)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
        {continuous && isScanning && (
          <div aria-live="polite" className="flex items-center gap-2 min-h-9">
            {lastCode ? (
              // key={lastCode+contador} remonta el chip en cada lectura:
              // la animación vuelve a correr como confirmación visual.
              <p key={`${lastCode}-${scanCount}`} className="flex-1 min-w-0 flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 motion-safe:animate-in motion-safe:fade-in dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate font-mono">{lastCode}</span>
              </p>
            ) : (
              <p className="flex-1 text-sm text-muted-foreground">Pasa los productos uno por uno frente a la cámara.</p>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">{scanCount} leído{scanCount === 1 ? "" : "s"}</span>
          </div>
        )}
        <div className="flex gap-2">
          {!isScanning ? (
            <Button onClick={() => void startScanner()} className="flex-1"><Camera className="mr-2 h-4 w-4" />{error ? "Reintentar cámara" : "Iniciar escáner"}</Button>
          ) : continuous ? (
            <Button onClick={() => { void stopScanner(); onClose?.() }} className="flex-1">
              Listo{scanCount > 0 ? ` (${scanCount})` : ""}
            </Button>
          ) : (
            <Button onClick={() => void stopScanner()} disabled={isStopping} variant="outline" className="flex-1"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isStopping ? "Deteniendo..." : "Detener escáner"}</Button>
          )}
          {/* En continuo «Listo» ya cierra mientras escanea; con la cámara
              apagada (error o sin iniciar) «Cerrar» sigue haciendo falta. */}
          {onClose && (!continuous || !isScanning) && <Button variant="outline" onClick={() => { void stopScanner(); onClose() }}>Cerrar</Button>}
        </div>
      </CardContent>
    </Card>
  )
}
